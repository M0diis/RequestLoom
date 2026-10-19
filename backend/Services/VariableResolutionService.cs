using RequestLoom.Api.Data.Repositories;

namespace RequestLoom.Api.Services;

public class VariableResolutionService
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
        Dictionary<string, string>? requestVariables = null,
        bool includeDynamicValues = true)
    {
        if (string.IsNullOrEmpty(input)) return input;

        var session = await CreateSessionAsync(workspaceId, serviceId, requestVariables);
        return includeDynamicValues ? session.Resolve(input) : session.ResolveOrdinary(input);
    }

    public async Task<TemplateResolutionSession> CreateSessionAsync(
        string workspaceId,
        string? serviceId = null,
        Dictionary<string, string>? requestVariables = null,
        IReadOnlyDictionary<string, string>? runtimeVariables = null,
        string? environmentId = null)
    {
        var variables = await BuildVariableMapAsync(workspaceId, serviceId, requestVariables, environmentId);

        // Runtime variables have the highest precedence. Request-scoped
        // runtime values override service-scoped runtime values.
        if (runtimeVariables != null)
        {
            foreach (var (key, value) in runtimeVariables)
            {
                if (!string.IsNullOrWhiteSpace(key))
                {
                    variables[key.Trim()] = value ?? "";
                }
            }
        }

        return new TemplateResolutionSession(variables);
    }

    public async Task<Dictionary<string, string>> BuildVariableMapAsync(string workspaceId,
        string? serviceId = null,
        Dictionary<string, string>? requestVariables = null,
        string? environmentId = null)
    {
        var variables = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var environments = await _environmentRepo.GetByWorkspaceAsync(workspaceId);
        var activeEnv = string.IsNullOrWhiteSpace(environmentId)
            ? environments.FirstOrDefault(e => e.IsActive)
            : environments.FirstOrDefault(e => e.Id == environmentId)
                ?? throw new ArgumentException("The selected environment does not belong to this workspace.");
        var activeEnvironmentId = activeEnv?.Id;

        // Global variables: ALL scope first, then active-environment scope override.
        var workspaceVars = (await _workspaceVarRepo.GetByWorkspaceForEnvironmentAsync(workspaceId, activeEnvironmentId)).ToList();
        foreach (var v in workspaceVars.Where(v => v.Enabled && v.EnvironmentId == null))
            variables[v.Key] = v.Value;

        // Legacy environment variables override ALL, but scoped workspace values override legacy values.
        foreach (var v in activeEnv?.Variables.Where(v => v.Enabled) ?? [])
            variables[v.Key] = v.Value;
        foreach (var v in workspaceVars.Where(v => v.Enabled && v.EnvironmentId != null))
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
}
