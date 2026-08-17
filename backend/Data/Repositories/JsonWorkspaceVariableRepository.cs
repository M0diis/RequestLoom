using RequestLoom.Api.Data;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public class JsonWorkspaceVariableRepository : IWorkspaceVariableRepository
{
    private readonly JsonDataStore _store;

    public JsonWorkspaceVariableRepository(JsonDataStore store)
    {
        _store = store;
    }

    public Task<IEnumerable<WorkspaceVariable>> GetByWorkspaceAsync(string workspaceId)
    {
        var result = _store.Read(doc =>
            doc.WorkspaceVariables
                .Where(v => v.WorkspaceId == workspaceId)
                .OrderBy(v => v.Key)
                .ThenBy(v => v.EnvironmentId == null ? 0 : 1)
                .ThenBy(v => v.EnvironmentId ?? "")
                .Select(Clone)
                .ToList());
        return Task.FromResult<IEnumerable<WorkspaceVariable>>(result);
    }

    public Task<IEnumerable<WorkspaceVariable>> GetByWorkspaceForEnvironmentAsync(string workspaceId, string? environmentId)
    {
        var normalizedEnvironmentId = string.IsNullOrWhiteSpace(environmentId) ? null : environmentId.Trim();

        var result = _store.Read(doc =>
        {
            IEnumerable<WorkspaceVariable> query = doc.WorkspaceVariables.Where(v => v.WorkspaceId == workspaceId);

            if (normalizedEnvironmentId == null)
            {
                query = query.Where(v => v.EnvironmentId == null);
            }
            else
            {
                query = query.Where(v => v.EnvironmentId == null || v.EnvironmentId == normalizedEnvironmentId);
            }

            return query
                .OrderBy(v => v.Key)
                .ThenBy(v => v.EnvironmentId == null ? 0 : 1)
                .Select(Clone)
                .ToList();
        });
        return Task.FromResult<IEnumerable<WorkspaceVariable>>(result);
    }

    public Task<WorkspaceVariable> UpsertAsync(
        string workspaceId,
        string? id,
        string key,
        string value,
        bool isSecret,
        bool enabled,
        string? environmentId)
    {
        var normalizedId = string.IsNullOrWhiteSpace(id) ? null : id.Trim();
        var normalizedEnvironmentId = string.IsNullOrWhiteSpace(environmentId) ? null : environmentId.Trim();

        WorkspaceVariable? result = null;
        _store.Mutate(doc =>
        {
            if (normalizedId != null)
            {
                var current = doc.WorkspaceVariables.FirstOrDefault(v => v.Id == normalizedId && v.WorkspaceId == workspaceId);
                if (current != null)
                {
                    var conflicting = doc.WorkspaceVariables.FirstOrDefault(v =>
                        v.WorkspaceId == workspaceId &&
                        v.Key == key &&
                        v.Id != normalizedId &&
                        ((normalizedEnvironmentId == null && v.EnvironmentId == null) || v.EnvironmentId == normalizedEnvironmentId));

                    if (conflicting != null)
                    {
                        conflicting.Value = value;
                        conflicting.IsSecret = isSecret;
                        conflicting.Enabled = enabled;
                        doc.WorkspaceVariables.Remove(current);
                        result = conflicting;
                        return;
                    }

                    current.Key = key;
                    current.Value = value;
                    current.IsSecret = isSecret;
                    current.Enabled = enabled;
                    current.EnvironmentId = normalizedEnvironmentId;
                    result = current;
                    return;
                }
            }

            var existing = doc.WorkspaceVariables.FirstOrDefault(v =>
                v.WorkspaceId == workspaceId &&
                v.Key == key &&
                ((normalizedEnvironmentId == null && v.EnvironmentId == null) || v.EnvironmentId == normalizedEnvironmentId));

            if (existing != null)
            {
                existing.Value = value;
                existing.IsSecret = isSecret;
                existing.Enabled = enabled;
                result = existing;
                return;
            }

            var created = new WorkspaceVariable
            {
                Id = Guid.NewGuid().ToString("N"),
                WorkspaceId = workspaceId,
                EnvironmentId = normalizedEnvironmentId,
                Key = key,
                Value = value,
                IsSecret = isSecret,
                Enabled = enabled
            };
            doc.WorkspaceVariables.Add(created);
            result = created;
        });

        return Task.FromResult(Clone(result!));
    }

    public Task<bool> DeleteAsync(string id)
    {
        var deleted = false;
        _store.Mutate(doc =>
        {
            deleted = doc.WorkspaceVariables.RemoveAll(v => v.Id == id) > 0;
        });

        return Task.FromResult(deleted);
    }

    internal static WorkspaceVariable Clone(WorkspaceVariable variable)
    {
        return new WorkspaceVariable
        {
            Id = variable.Id,
            WorkspaceId = variable.WorkspaceId,
            EnvironmentId = variable.EnvironmentId,
            Key = variable.Key,
            Value = variable.Value,
            IsSecret = variable.IsSecret,
            Enabled = variable.Enabled
        };
    }
}