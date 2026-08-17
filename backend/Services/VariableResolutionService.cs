using System.Text.RegularExpressions;
using RequestLoom.Api.Data.Repositories;

namespace RequestLoom.Api.Services;

public partial class VariableResolutionService
{
    private readonly IEnvironmentRepository _environmentRepo;
    private readonly IWorkspaceVariableRepository _workspaceVarRepo;
    private readonly IServiceVariableRepository _serviceVarRepo;

    public VariableResolutionService(
        IEnvironmentRepository environmentRepo,
        IWorkspaceVariableRepository workspaceVarRepo,
        IServiceVariableRepository serviceVarRepo)
    {
        _environmentRepo = environmentRepo;
        _workspaceVarRepo = workspaceVarRepo;
        _serviceVarRepo = serviceVarRepo;
    }

    public async Task<string> ResolveAsync(string input, string workspaceId,
        string? serviceId = null,
        Dictionary<string, string>? requestVariables = null)
    {
        if (string.IsNullOrEmpty(input)) return input;

        var variables = await BuildVariableMapAsync(workspaceId, serviceId, requestVariables);
        return VariablePattern().Replace(input, match =>
        {
            var key = match.Groups[1].Value;
            return variables.TryGetValue(key, out var value) ? value : match.Value;
        });
    }

    public async Task<Dictionary<string, string>> BuildVariableMapAsync(string workspaceId,
        string? serviceId = null,
        Dictionary<string, string>? requestVariables = null)
    {
        var variables = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var environments = await _environmentRepo.GetByWorkspaceAsync(workspaceId);
        var activeEnv = environments.FirstOrDefault(e => e.IsActive);
        var activeEnvironmentId = activeEnv?.Id;

        // Global variables: ALL scope first, then active-environment scope override.
        var workspaceVars = await _workspaceVarRepo.GetByWorkspaceForEnvironmentAsync(workspaceId, activeEnvironmentId);
        foreach (var v in workspaceVars.Where(v => v.Enabled))
            variables[v.Key] = v.Value;

        // Service variables (override global variables)
        if (!string.IsNullOrWhiteSpace(serviceId))
        {
            var serviceVars = await _serviceVarRepo.GetByServiceForEnvironmentAsync(serviceId, activeEnvironmentId);

            // Repository ordering applies ALL scope first, then active-environment scope.
            foreach (var v in serviceVars.Where(v => v.Enabled))
                variables[v.Key] = v.Value;
        }

        // Request variables (highest priority)
        if (requestVariables != null)
        {
            foreach (var (key, value) in requestVariables)
                variables[key] = value;
        }

        return variables;
    }

    [GeneratedRegex(@"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")]
    private static partial Regex VariablePattern();
}
