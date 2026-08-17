using RequestLoom.Api.Data;
using RequestLoom.Api.Models;
using Environment = RequestLoom.Api.Models.Environment;

namespace RequestLoom.Api.Data.Repositories;

public class JsonEnvironmentRepository : IEnvironmentRepository
{
    private readonly JsonDataStore _store;

    public JsonEnvironmentRepository(JsonDataStore store)
    {
        _store = store;
    }

    public Task<IEnumerable<Environment>> GetByWorkspaceAsync(string workspaceId)
    {
        var result = _store.Read(doc =>
        {
            return doc.Environments
                .Where(e => e.WorkspaceId == workspaceId)
                .OrderBy(e => e.SortOrder)
                .Select(e => PopulateVariables(doc, e))
                .ToList();
        });
        return Task.FromResult<IEnumerable<Environment>>(result);
    }

    public Task<Environment?> GetByIdAsync(string id)
    {
        var result = _store.Read(doc =>
        {
            var env = doc.Environments.FirstOrDefault(e => e.Id == id);
            return env == null ? null : PopulateVariables(doc, env);
        });
        return Task.FromResult(result);
    }

    public Task<Environment> CreateAsync(string workspaceId, string name)
    {
        Environment? created = null;
        _store.Mutate(doc =>
        {
            var maxOrder = doc.Environments
                .Where(e => e.WorkspaceId == workspaceId)
                .Select(e => (int?)e.SortOrder)
                .Max() ?? -1;
            var hasExisting = doc.Environments.Any(e => e.WorkspaceId == workspaceId);

            var env = new Environment
            {
                Id = Guid.NewGuid().ToString("N"),
                WorkspaceId = workspaceId,
                Name = name,
                IsActive = !hasExisting,
                SortOrder = maxOrder + 1,
                CreatedAt = JsonDataStore.Now()
            };
            doc.Environments.Add(env);
            created = env;
        });

        return Task.FromResult(Clone(created!));
    }

    public Task<Environment?> UpdateAsync(string id, string name)
    {
        Environment? updated = null;
        _store.Mutate(doc =>
        {
            var env = doc.Environments.FirstOrDefault(e => e.Id == id);
            if (env != null)
            {
                env.Name = name;
                updated = env;
            }
        });

        return Task.FromResult(updated == null ? null : Clone(updated));
    }

    public Task SetActiveAsync(string workspaceId, string environmentId)
    {
        _store.Mutate(doc =>
        {
            var exists = doc.Environments.Any(e => e.Id == environmentId && e.WorkspaceId == workspaceId);
            if (!exists) return;

            foreach (var env in doc.Environments.Where(e => e.WorkspaceId == workspaceId))
            {
                env.IsActive = false;
            }

            var target = doc.Environments.First(e => e.Id == environmentId && e.WorkspaceId == workspaceId);
            target.IsActive = true;
        });

        return Task.CompletedTask;
    }

    public Task<bool> DeleteAsync(string id)
    {
        var deleted = false;
        _store.Mutate(doc =>
        {
            var env = doc.Environments.FirstOrDefault(e => e.Id == id);
            if (env == null) return;

            var workspaceId = env.WorkspaceId;
            doc.Environments.Remove(env);
            doc.EnvironmentVariables.RemoveAll(v => v.EnvironmentId == id);

            var hasActive = doc.Environments.Any(e => e.WorkspaceId == workspaceId && e.IsActive);
            if (!hasActive)
            {
                var fallback = doc.Environments
                    .Where(e => e.WorkspaceId == workspaceId)
                    .OrderBy(e => e.SortOrder)
                    .FirstOrDefault();
                if (fallback != null)
                {
                    fallback.IsActive = true;
                }
            }

            deleted = true;
        });

        return Task.FromResult(deleted);
    }

    public Task<EnvironmentVariable> UpsertVariableAsync(string environmentId, string key, string value, bool isSecret, bool enabled)
    {
        EnvironmentVariable? result = null;
        _store.Mutate(doc =>
        {
            var existing = doc.EnvironmentVariables.FirstOrDefault(v => v.EnvironmentId == environmentId && v.Key == key);
            if (existing != null)
            {
                existing.Value = value;
                existing.IsSecret = isSecret;
                existing.Enabled = enabled;
                result = existing;
                return;
            }

            var variable = new EnvironmentVariable
            {
                Id = Guid.NewGuid().ToString("N"),
                EnvironmentId = environmentId,
                Key = key,
                Value = value,
                IsSecret = isSecret,
                Enabled = enabled
            };
            doc.EnvironmentVariables.Add(variable);
            result = variable;
        });

        return Task.FromResult(Clone(result!));
    }

    public Task<bool> DeleteVariableAsync(string variableId)
    {
        var deleted = false;
        _store.Mutate(doc =>
        {
            deleted = doc.EnvironmentVariables.RemoveAll(v => v.Id == variableId) > 0;
        });

        return Task.FromResult(deleted);
    }

    private static Environment PopulateVariables(JsonDataDocument doc, Environment env)
    {
        var result = Clone(env);
        result.Variables = doc.EnvironmentVariables
            .Where(v => v.EnvironmentId == env.Id)
            .OrderBy(v => v.Key)
            .Select(v => new EnvironmentVariable
            {
                Id = v.Id,
                EnvironmentId = v.EnvironmentId,
                Key = v.Key,
                Value = v.Value,
                IsSecret = v.IsSecret,
                Enabled = v.Enabled
            })
            .ToList();
        return result;
    }

    private static Environment Clone(Environment env)
    {
        return new Environment
        {
            Id = env.Id,
            WorkspaceId = env.WorkspaceId,
            Name = env.Name,
            IsActive = env.IsActive,
            SortOrder = env.SortOrder,
            CreatedAt = env.CreatedAt
        };
    }

    private static EnvironmentVariable Clone(EnvironmentVariable variable)
    {
        return new EnvironmentVariable
        {
            Id = variable.Id,
            EnvironmentId = variable.EnvironmentId,
            Key = variable.Key,
            Value = variable.Value,
            IsSecret = variable.IsSecret,
            Enabled = variable.Enabled
        };
    }
}