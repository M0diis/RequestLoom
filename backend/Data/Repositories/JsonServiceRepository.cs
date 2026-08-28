using RequestLoom.Api.Data;
using RequestLoom.Api.Models;
using KeyValuePair = RequestLoom.Api.Models.KeyValuePair;

namespace RequestLoom.Api.Data.Repositories;

public class JsonServiceRepository : IServiceRepository
{
    private readonly JsonDataStore _store;

    public JsonServiceRepository(JsonDataStore store)
    {
        _store = store;
    }

    public Task<IEnumerable<Service>> GetByWorkspaceAsync(string workspaceId, bool includeRequests = false)
    {
        var result = _store.Read(doc =>
        {
            var services = doc.Services
                .Where(s => s.WorkspaceId == workspaceId)
                .OrderBy(s => s.SortOrder)
                .Select(s => PopulateDefaults(doc, s))
                .ToList();

            if (includeRequests)
            {
                foreach (var service in services)
                {
                    service.Requests = doc.Requests
                        .Where(r => r.ServiceId == service.Id)
                        .OrderBy(r => r.SortOrder)
                        .Select(r => JsonRequestRepository.Clone(r, doc))
                        .ToList();
                }
            }

            return services;
        });
        return Task.FromResult<IEnumerable<Service>>(result);
    }

    public Task<Service?> GetByIdAsync(string id)
    {
        var result = _store.Read(doc =>
        {
            var service = doc.Services.FirstOrDefault(s => s.Id == id);
            return service == null ? null : PopulateDefaults(doc, service);
        });
        return Task.FromResult(result);
    }

    public Task<Service> CreateAsync(string workspaceId, string name, string description, List<KeyValuePairRequest> headers, AuthRequest? auth, string? storagePath = null)
    {
        Service? created = null;
        _store.Mutate(doc =>
        {
            var maxOrder = doc.Services
                .Where(s => s.WorkspaceId == workspaceId)
                .Select(s => (int?)s.SortOrder)
                .Max() ?? -1;

            var serviceId = Guid.NewGuid().ToString("N");
            var service = new Service
            {
                Id = serviceId,
                WorkspaceId = workspaceId,
                Name = name,
                Description = description,
                StoragePath = _store.ResolveCollectionPath(serviceId, name, storagePath),
                SortOrder = maxOrder + 1,
                CreatedAt = JsonDataStore.Now()
            };
            ApplyHeaders(service, headers);
            ApplyAuth(service, auth);
            doc.Services.Add(service);
            created = service;
        });

        return Task.FromResult(Clone(created!));
    }

    public Task<Service?> UpdateAsync(string id, string name, string description, List<KeyValuePairRequest> headers, AuthRequest? auth)
    {
        Service? updated = null;
        _store.Mutate(doc =>
        {
            var service = doc.Services.FirstOrDefault(s => s.Id == id);
            if (service == null) return;

            service.Name = name;
            service.Description = description;
            ApplyHeaders(service, headers);
            ApplyAuth(service, auth);
            updated = service;
        });

        return Task.FromResult(updated == null ? null : Clone(updated));
    }

    public Task<bool> ReorderAsync(string workspaceId, List<string> serviceIds)
    {
        _store.Mutate(doc =>
        {
            for (var i = 0; i < serviceIds.Count; i++)
            {
                var service = doc.Services.FirstOrDefault(s => s.Id == serviceIds[i] && s.WorkspaceId == workspaceId);
                if (service != null)
                {
                    service.SortOrder = i;
                }
            }
        });

        return Task.FromResult(true);
    }

    public Task<bool> DeleteAsync(string id)
    {
        var deleted = false;
        _store.Mutate(doc =>
        {
            var service = doc.Services.FirstOrDefault(s => s.Id == id);
            if (service == null) return;

            doc.Services.Remove(service);
            doc.Requests.RemoveAll(r => r.ServiceId == id);
            doc.ServiceVariables.RemoveAll(v => v.ServiceId == id);
            deleted = true;
        });

        return Task.FromResult(deleted);
    }

    private static Service PopulateDefaults(JsonDataDocument doc, Service service)
    {
        var result = Clone(service);
        result.Headers = service.Headers
            .Select(h => new KeyValuePair
            {
                Id = h.Id,
                Key = h.Key,
                Value = h.Value,
                Enabled = h.Enabled
            })
            .ToList();
        result.Auth = service.Auth == null ? null : new ServiceAuth
        {
            Id = service.Auth.Id,
            ServiceId = service.Auth.ServiceId,
            AuthType = service.Auth.AuthType,
            ConfigJson = service.Auth.ConfigJson
        };
        return result;
    }

    private static void ApplyHeaders(Service service, IEnumerable<KeyValuePairRequest> headers)
    {
        service.Headers = headers
            .Where(h => !string.IsNullOrWhiteSpace(h.Key))
            .Select(h => new KeyValuePair
            {
                Id = Guid.NewGuid().ToString("N"),
                Key = h.Key.Trim(),
                Value = h.Value ?? "",
                Enabled = h.Enabled
            })
            .ToList();
    }

    private static void ApplyAuth(Service service, AuthRequest? auth)
    {
        var authType = auth?.AuthType?.Trim() ?? "none";
        if (string.Equals(authType, "none", StringComparison.OrdinalIgnoreCase))
        {
            service.Auth = null;
            return;
        }

        service.Auth = new ServiceAuth
        {
            Id = Guid.NewGuid().ToString("N"),
            ServiceId = service.Id,
            AuthType = authType,
            ConfigJson = string.IsNullOrWhiteSpace(auth?.ConfigJson) ? "{}" : auth.ConfigJson
        };
    }

    private static Service Clone(Service service)
    {
        return new Service
        {
            Id = service.Id,
            WorkspaceId = service.WorkspaceId,
            Name = service.Name,
            Description = service.Description,
            StoragePath = service.StoragePath,
            SortOrder = service.SortOrder,
            CreatedAt = service.CreatedAt
        };
    }
}
