using System.Collections.Concurrent;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

public sealed class RuntimeVariableStore
{
    private readonly ConcurrentDictionary<string, Dictionary<string, RuntimeScriptVariable>> _variables =
        new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, RuntimeScriptVariable> Get(string workspaceId, string? requestId)
    {
        var scopeKey = BuildScopeKey(workspaceId, requestId);
        return _variables.TryGetValue(scopeKey, out var values)
            ? Clone(values)
            : new Dictionary<string, RuntimeScriptVariable>(StringComparer.OrdinalIgnoreCase);
    }

    public void Set(string workspaceId, string? requestId, Dictionary<string, RuntimeScriptVariable> values)
    {
        _variables[BuildScopeKey(workspaceId, requestId)] = Clone(values);
    }

    public static string BuildScopeKey(string workspaceId, string? requestId)
    {
        return string.IsNullOrWhiteSpace(requestId)
            ? $"{workspaceId}::adhoc"
            : $"{workspaceId}::{requestId.Trim()}";
    }

    private static Dictionary<string, RuntimeScriptVariable> Clone(
        Dictionary<string, RuntimeScriptVariable> values)
    {
        return values.ToDictionary(
            pair => pair.Key,
            pair => new RuntimeScriptVariable { Value = pair.Value.Value, Source = pair.Value.Source },
            StringComparer.OrdinalIgnoreCase);
    }
}
