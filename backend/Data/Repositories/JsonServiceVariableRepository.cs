using RequestLoom.Api.Data;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public class JsonServiceVariableRepository : IServiceVariableRepository
{
    private readonly JsonDataStore _store;

    public JsonServiceVariableRepository(JsonDataStore store)
    {
        _store = store;
    }

    public Task<IEnumerable<ServiceVariable>> GetByServiceAsync(string serviceId)
    {
        var result = _store.Read(doc =>
            doc.ServiceVariables
                .Where(v => v.ServiceId == serviceId)
                .OrderBy(v => v.Key)
                .ThenBy(v => v.EnvironmentId == null ? 0 : 1)
                .ThenBy(v => v.EnvironmentId ?? "")
                .Select(Clone)
                .ToList());
        return Task.FromResult<IEnumerable<ServiceVariable>>(result);
    }

    public Task<IEnumerable<ServiceVariable>> GetByServiceForEnvironmentAsync(string serviceId, string? environmentId)
    {
        var normalizedEnvironmentId = string.IsNullOrWhiteSpace(environmentId) ? null : environmentId.Trim();

        var result = _store.Read(doc =>
        {
            IEnumerable<ServiceVariable> query = doc.ServiceVariables.Where(v => v.ServiceId == serviceId);

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
        return Task.FromResult<IEnumerable<ServiceVariable>>(result);
    }

    public Task<ServiceVariable> UpsertAsync(
        string serviceId,
        string? id,
        string key,
        string value,
        bool isSecret,
        bool enabled,
        string? environmentId)
    {
        var normalizedId = string.IsNullOrWhiteSpace(id) ? null : id.Trim();
        var normalizedEnvironmentId = string.IsNullOrWhiteSpace(environmentId) ? null : environmentId.Trim();

        ServiceVariable? result = null;
        _store.Mutate(doc =>
        {
            if (normalizedId != null)
            {
                var current = doc.ServiceVariables.FirstOrDefault(v => v.Id == normalizedId && v.ServiceId == serviceId);
                if (current != null)
                {
                    var conflicting = doc.ServiceVariables.FirstOrDefault(v =>
                        v.ServiceId == serviceId &&
                        v.Key == key &&
                        v.Id != normalizedId &&
                        ((normalizedEnvironmentId == null && v.EnvironmentId == null) || v.EnvironmentId == normalizedEnvironmentId));

                    if (conflicting != null)
                    {
                        conflicting.Value = value;
                        conflicting.IsSecret = isSecret;
                        conflicting.Enabled = enabled;
                        doc.ServiceVariables.Remove(current);
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

            var existing = doc.ServiceVariables.FirstOrDefault(v =>
                v.ServiceId == serviceId &&
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

            var created = new ServiceVariable
            {
                Id = Guid.NewGuid().ToString("N"),
                ServiceId = serviceId,
                EnvironmentId = normalizedEnvironmentId,
                Key = key,
                Value = value,
                IsSecret = isSecret,
                Enabled = enabled
            };
            doc.ServiceVariables.Add(created);
            result = created;
        });

        return Task.FromResult(Clone(result!));
    }

    public Task<bool> DeleteAsync(string id)
    {
        var deleted = false;
        _store.Mutate(doc =>
        {
            deleted = doc.ServiceVariables.RemoveAll(v => v.Id == id) > 0;
        });

        return Task.FromResult(deleted);
    }

    internal static ServiceVariable Clone(ServiceVariable variable)
    {
        return new ServiceVariable
        {
            Id = variable.Id,
            ServiceId = variable.ServiceId,
            EnvironmentId = variable.EnvironmentId,
            Key = variable.Key,
            Value = variable.Value,
            IsSecret = variable.IsSecret,
            Enabled = variable.Enabled
        };
    }
}