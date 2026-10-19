using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Controllers;

/// <summary>Checks the complete parent/child identity before an action can read or mutate a resource.</summary>
public sealed class ResourceOwnershipFilter(
    IWorkspaceRepository workspaces, IServiceRepository services, IEnvironmentRepository environments,
    IRequestRepository requests, IMockServerRepository mocks, IHistoryRepository history,
    IWorkspaceVariableRepository workspaceVariables, IServiceVariableRepository serviceVariables) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!await MatchesAsync(context))
        {
            context.Result = new NotFoundResult();
            return;
        }
        await next();
    }

    private async Task<bool> MatchesAsync(ActionExecutingContext context)
    {
        string? Route(string key) => context.RouteData.Values.TryGetValue(key, out var value) ? value?.ToString() : null;
        var controller = Route("controller");
        var workspaceId = Route("workspaceId");
        if (workspaceId != null && await workspaces.GetByIdAsync(workspaceId) == null) return false;
        var id = Route("id");
        var serviceId = Route("serviceId") ?? (controller == "Services" ? id : null);
        if (controller == "WorkspaceVariables" && context.HttpContext.Request.Query.TryGetValue("serviceId", out var queryServiceId))
            serviceId = queryServiceId.ToString();
        if (!string.IsNullOrWhiteSpace(serviceId))
        {
            var service = await services.GetByIdAsync(serviceId);
            if (service == null || (workspaceId != null && service.WorkspaceId != workspaceId)) return false;
            workspaceId ??= service.WorkspaceId;
        }

        if (controller == "Environments")
        {
            var environmentId = Route("environmentId") ?? id;
            if (environmentId != null)
            {
                var environment = await environments.GetByIdAsync(environmentId);
                if (environment == null || environment.WorkspaceId != workspaceId) return false;
                var variableId = Route("variableId");
                if (variableId != null && !environment.Variables.Any(v => v.Id == variableId)) return false;
            }
        }
        if (controller == "WorkspaceVariables" && id != null &&
            !(await workspaceVariables.GetByWorkspaceAsync(workspaceId!)).Any(v => v.Id == id)) return false;
        if (controller == "ServiceVariables" && id != null &&
            !(await serviceVariables.GetByServiceAsync(serviceId!)).Any(v => v.Id == id)) return false;

        if (controller == "History")
        {
            if (id != null && (await history.GetByIdAsync(id))?.WorkspaceId != workspaceId) return false;
            var requestId = Route("requestId") ?? context.HttpContext.Request.Query["requestId"].FirstOrDefault()
                ?? context.HttpContext.Request.Query["request_id"].FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(requestId) && (await requests.GetByIdAsync(requestId))?.WorkspaceId != workspaceId) return false;
        }
        if (controller == "MockServers")
        {
            var serverId = Route("mockServerId") ?? id;
            if (serverId != null)
            {
                var server = await mocks.GetByIdAsync(serverId);
                if (server == null || server.WorkspaceId != workspaceId) return false;
                var endpointId = Route("endpointId");
                if (endpointId != null && (await mocks.GetEndpointByIdAsync(endpointId))?.MockServerId != serverId) return false;
            }
        }

        foreach (var argument in context.ActionArguments.Values)
        {
            var selectedEnvironment = argument switch
            {
                UpsertWorkspaceVariableRequest variable => variable.EnvironmentId,
                UpsertServiceVariableRequest variable => variable.EnvironmentId,
                _ => null,
            };
            if (!string.IsNullOrWhiteSpace(selectedEnvironment) &&
                (await environments.GetByIdAsync(selectedEnvironment))?.WorkspaceId != workspaceId) return false;
            if (argument is ExecuteRequestPayload payload &&
                !await MatchesExecutionAsync(payload.WorkspaceId ?? "default", payload.ServiceId, payload.RequestId, payload.EnvironmentId)) return false;
            if (argument is SnippetRequest snippet &&
                !await MatchesExecutionAsync(snippet.WorkspaceId ?? "default", snippet.ServiceId, snippet.RequestId, null)) return false;
        }
        return true;
    }

    private async Task<bool> MatchesExecutionAsync(string workspaceId, string? serviceId, string? requestId, string? environmentId)
    {
        if (await workspaces.GetByIdAsync(workspaceId) == null) return false;
        if (!string.IsNullOrWhiteSpace(serviceId) && (await services.GetByIdAsync(serviceId))?.WorkspaceId != workspaceId) return false;
        if (!string.IsNullOrWhiteSpace(environmentId) && (await environments.GetByIdAsync(environmentId))?.WorkspaceId != workspaceId) return false;
        if (!string.IsNullOrWhiteSpace(requestId))
        {
            var request = await requests.GetByIdAsync(requestId);
            if (request == null || request.WorkspaceId != workspaceId || (serviceId != null && request.ServiceId != serviceId)) return false;
        }
        return true;
    }
}
