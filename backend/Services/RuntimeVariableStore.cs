using System.Collections.Concurrent;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

public sealed class RuntimeVariableStore
{
    private readonly ConcurrentDictionary<string, Dictionary<string, RuntimeScriptVariable>> _variables =
        new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, RuntimeScriptVariable> Get(
        string workspaceId,
        string? serviceId,
        string? requestId = null)
    {
        var values = GetService(workspaceId, serviceId);
        foreach (var (key, value) in GetRequest(workspaceId, requestId))
            values[key] = value;

        return values;
    }

    public Dictionary<string, RuntimeScriptVariable> GetRequest(
        string workspaceId,
        string? requestId)
    {
        return GetByKey(BuildRequestKey(workspaceId, requestId));
    }

    public Dictionary<string, RuntimeScriptVariable> GetService(
        string workspaceId,
        string? serviceId)
    {
        return string.IsNullOrWhiteSpace(serviceId)
            ? new Dictionary<string, RuntimeScriptVariable>(StringComparer.OrdinalIgnoreCase)
            : GetByKey(BuildServiceKey(workspaceId, serviceId));
    }

    public void SetRequest(
        string workspaceId,
        string? requestId,
        Dictionary<string, RuntimeScriptVariable> values)
    {
        SetByKey(BuildRequestKey(workspaceId, requestId), values);
    }

    public void SetService(
        string workspaceId,
        string? serviceId,
        Dictionary<string, RuntimeScriptVariable> values)
    {
        if (!string.IsNullOrWhiteSpace(serviceId))
            SetByKey(BuildServiceKey(workspaceId, serviceId), values);
    }

    public void ClearService(string workspaceId, string? serviceId)
    {
        if (!string.IsNullOrWhiteSpace(serviceId))
            _variables.TryRemove(BuildServiceKey(workspaceId, serviceId), out _);
    }

    private Dictionary<string, RuntimeScriptVariable> GetByKey(string key)
    {
        return _variables.TryGetValue(key, out var values)
            ? Clone(values)
            : new Dictionary<string, RuntimeScriptVariable>(StringComparer.OrdinalIgnoreCase);
    }

    private void SetByKey(string key, Dictionary<string, RuntimeScriptVariable> values)
    {
        _variables[key] = Clone(values);
    }

    private static string BuildRequestKey(string workspaceId, string? requestId)
    {
        return string.IsNullOrWhiteSpace(requestId)
            ? $"{workspaceId}::adhoc"
            : $"{workspaceId}::request:{requestId.Trim()}";
    }

    private static string BuildServiceKey(string workspaceId, string serviceId)
    {
        return $"{workspaceId}::service:{serviceId.Trim()}";
    }

    private static Dictionary<string, RuntimeScriptVariable> Clone(
        Dictionary<string, RuntimeScriptVariable> values)
    {
        return values.ToDictionary(
            pair => pair.Key,
            pair => new RuntimeScriptVariable
            {
                Value = pair.Value.Value,
                Source = pair.Value.Source,
                Scope = pair.Value.Scope
            },
            StringComparer.OrdinalIgnoreCase);
    }
}
