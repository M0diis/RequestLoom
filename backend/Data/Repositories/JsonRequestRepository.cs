using RequestLoom.Api.Data;
using RequestLoom.Api.Models;
using KeyValuePair = RequestLoom.Api.Models.KeyValuePair;

namespace RequestLoom.Api.Data.Repositories;

public class JsonRequestRepository : IRequestRepository
{
    private readonly JsonDataStore _store;

    public JsonRequestRepository(JsonDataStore store)
    {
        _store = store;
    }

    public Task<ApiRequest?> GetByIdAsync(string id)
    {
        var result = _store.Read(doc =>
        {
            var request = doc.Requests.FirstOrDefault(r => r.Id == id);
            return request == null ? null : Clone(request, doc);
        });
        return Task.FromResult(result);
    }

    public Task<ApiRequest> CreateAsync(string serviceId, CreateApiRequestRequest req)
    {
        ApiRequest? created = null;
        _store.Mutate(doc =>
        {
            var maxOrder = doc.Requests
                .Where(r => r.ServiceId == serviceId)
                .Select(r => (int?)r.SortOrder)
                .Max() ?? -1;

            var request = new ApiRequest
            {
                Id = Guid.NewGuid().ToString("N"),
                ServiceId = serviceId,
                Name = req.Name,
                Method = req.Method,
                Url = req.Url,
                Body = req.Body,
                BodyType = req.BodyType,
                SortOrder = maxOrder + 1,
                CreatedAt = JsonDataStore.Now(),
                UpdatedAt = JsonDataStore.Now()
            };
            doc.Requests.Add(request);
            created = request;
        });

        return Task.FromResult(Clone(created!, _store));
    }

    public Task<ApiRequest?> UpdateAsync(string id, UpdateApiRequestRequest req)
    {
        ApiRequest? updated = null;
        _store.Mutate(doc =>
        {
            var request = doc.Requests.FirstOrDefault(r => r.Id == id);
            if (request == null) return;

            request.Name = req.Name;
            request.Method = req.Method;
            request.Url = req.Url;
            request.Body = req.Body;
            request.BodyType = req.BodyType;
            request.PreRequestScript = req.PreRequestScript ?? "";
            request.PostRequestScript = req.PostRequestScript ?? "";
            request.TestScript = req.TestScript ?? "";
            request.UpdatedAt = JsonDataStore.Now();

            request.Headers = req.Headers
                .Select(h => new KeyValuePair
                {
                    Id = Guid.NewGuid().ToString("N"),
                    Key = h.Key,
                    Value = h.Value,
                    Enabled = h.Enabled
                })
                .ToList();

            request.Params = req.Params
                .Select(p => new KeyValuePair
                {
                    Id = Guid.NewGuid().ToString("N"),
                    Key = p.Key,
                    Value = p.Value,
                    Enabled = p.Enabled
                })
                .ToList();

            request.Variables = req.Variables
                .Select(v => new RequestVariable
                {
                    Id = Guid.NewGuid().ToString("N"),
                    RequestId = id,
                    Key = v.Key,
                    Value = v.Value,
                    Enabled = v.Enabled
                })
                .ToList();

            request.Auth = null;
            if (req.Auth != null)
            {
                var authType = req.Auth.AuthType?.Trim() ?? "inherit";
                if (!string.Equals(authType, "inherit", StringComparison.OrdinalIgnoreCase))
                {
                    request.Auth = new RequestAuth
                    {
                        Id = Guid.NewGuid().ToString("N"),
                        RequestId = id,
                        AuthType = authType,
                        ConfigJson = string.IsNullOrWhiteSpace(req.Auth.ConfigJson) ? "{}" : req.Auth.ConfigJson
                    };
                }
            }

            updated = request;
        });

        return Task.FromResult(updated == null ? null : Clone(updated, _store));
    }

    public Task<ApiRequest?> DuplicateAsync(string id)
    {
        ApiRequest? created = null;
        _store.Mutate(doc =>
        {
            var original = doc.Requests.FirstOrDefault(r => r.Id == id);
            if (original == null) return;

            var maxOrder = doc.Requests
                .Where(r => r.ServiceId == original.ServiceId)
                .Select(r => (int?)r.SortOrder)
                .Max() ?? -1;

            var copy = new ApiRequest
            {
                Id = Guid.NewGuid().ToString("N"),
                ServiceId = original.ServiceId,
                Name = original.Name + " (copy)",
                Method = original.Method,
                Url = original.Url,
                Body = original.Body,
                BodyType = original.BodyType,
                PreRequestScript = original.PreRequestScript ?? "",
                PostRequestScript = original.PostRequestScript ?? "",
                TestScript = original.TestScript ?? "",
                SortOrder = maxOrder + 1,
                IsFavorite = false,
                CreatedAt = JsonDataStore.Now(),
                UpdatedAt = JsonDataStore.Now(),
                Headers = original.Headers
                    .Select(h => new KeyValuePair { Id = Guid.NewGuid().ToString("N"), Key = h.Key, Value = h.Value, Enabled = h.Enabled })
                    .ToList(),
                Params = original.Params
                    .Select(p => new KeyValuePair { Id = Guid.NewGuid().ToString("N"), Key = p.Key, Value = p.Value, Enabled = p.Enabled })
                    .ToList(),
                Variables = original.Variables
                    .Select(v => new RequestVariable { Id = Guid.NewGuid().ToString("N"), RequestId = v.RequestId, Key = v.Key, Value = v.Value, Enabled = v.Enabled })
                    .ToList()
            };

            if (original.Auth != null)
            {
                copy.Auth = new RequestAuth
                {
                    Id = Guid.NewGuid().ToString("N"),
                    RequestId = copy.Id,
                    AuthType = original.Auth.AuthType,
                    ConfigJson = original.Auth.ConfigJson
                };
            }

            var originalSettings = doc.RequestSettings.FirstOrDefault(s => s.RequestId == original.Id);
            if (originalSettings != null)
            {
                doc.RequestSettings.Add(new ApiRequestSettings
                {
                    RequestId = copy.Id,
                    FollowRedirects = originalSettings.FollowRedirects,
                    MaxRedirects = originalSettings.MaxRedirects,
                    IgnoreSslErrors = originalSettings.IgnoreSslErrors,
                    TimeoutSeconds = originalSettings.TimeoutSeconds,
                    ProxyMode = originalSettings.ProxyMode,
                    ProxyUrl = originalSettings.ProxyUrl,
                    ProxyUsername = originalSettings.ProxyUsername,
                    ProxyPassword = originalSettings.ProxyPassword,
                });
            }

            doc.Requests.Add(copy);
            created = copy;
        });

        return Task.FromResult(created == null ? null : Clone(created, _store));
    }

    public Task<bool> ToggleFavoriteAsync(string id)
    {
        var toggled = false;
        _store.Mutate(doc =>
        {
            var request = doc.Requests.FirstOrDefault(r => r.Id == id);
            if (request != null)
            {
                request.IsFavorite = !request.IsFavorite;
                toggled = true;
            }
        });

        return Task.FromResult(toggled);
    }

    public Task<bool> DeleteAsync(string id)
    {
        var deleted = false;
        _store.Mutate(doc =>
        {
            deleted = doc.Requests.RemoveAll(r => r.Id == id) > 0;
            doc.RequestSettings.RemoveAll(s => s.RequestId == id);
        });

        return Task.FromResult(deleted);
    }

    public Task<List<ApiRequest>> GetByServiceIdAsync(string serviceId)
    {
        var result = _store.Read(doc =>
            doc.Requests
                .Where(r => r.ServiceId == serviceId)
                .OrderBy(r => r.SortOrder)
                .Select(r => Clone(r, doc))
                .ToList());
        return Task.FromResult(result);
    }

    public Task<bool> MoveToServiceAsync(string id, string newServiceId)
    {
        var moved = false;
        _store.Mutate(doc =>
        {
            var request = doc.Requests.FirstOrDefault(r => r.Id == id);
            if (request == null) return;

            var maxOrder = doc.Requests
                .Where(r => r.ServiceId == newServiceId)
                .Select(r => (int?)r.SortOrder)
                .Max() ?? -1;

            request.ServiceId = newServiceId;
            request.SortOrder = maxOrder + 1;
            moved = true;
        });

        return Task.FromResult(moved);
    }

    public Task<ApiRequestSettings?> GetSettingsAsync(string requestId)
    {
        var result = _store.Read(doc =>
        {
            var settings = doc.RequestSettings.FirstOrDefault(s => s.RequestId == requestId);
            return settings == null ? null : CloneSettings(settings);
        });
        return Task.FromResult(result);
    }

    public Task<ApiRequestSettings> SaveSettingsAsync(string requestId, ApiRequestSettings settings)
    {
        ApiRequestSettings? saved = null;
        _store.Mutate(doc =>
        {
            var existing = doc.RequestSettings.FirstOrDefault(s => s.RequestId == requestId);
            if (existing == null)
            {
                existing = new ApiRequestSettings { RequestId = requestId };
                doc.RequestSettings.Add(existing);
            }

            existing.FollowRedirects = settings.FollowRedirects;
            existing.MaxRedirects = Math.Clamp(settings.MaxRedirects, 1, 50);
            existing.IgnoreSslErrors = settings.IgnoreSslErrors;
            existing.TimeoutSeconds = settings.TimeoutSeconds is > 0 ? settings.TimeoutSeconds : null;
            existing.ProxyMode = settings.ProxyMode?.Trim().ToLowerInvariant() switch
            {
                "custom" => "custom",
                "disabled" => "disabled",
                _ => "inherit",
            };
            existing.ProxyUrl = settings.ProxyUrl?.Trim() ?? "";
            existing.ProxyUsername = settings.ProxyUsername ?? "";
            existing.ProxyPassword = settings.ProxyPassword ?? "";
            saved = existing;
        });

        return Task.FromResult(CloneSettings(saved!));
    }

    private static ApiRequestSettings CloneSettings(ApiRequestSettings settings)
    {
        return new ApiRequestSettings
        {
            RequestId = settings.RequestId,
            FollowRedirects = settings.FollowRedirects,
            MaxRedirects = settings.MaxRedirects is > 0 ? settings.MaxRedirects : 10,
            IgnoreSslErrors = settings.IgnoreSslErrors,
            TimeoutSeconds = settings.TimeoutSeconds,
            ProxyMode = settings.ProxyMode?.Trim().ToLowerInvariant() switch
            {
                "custom" => "custom",
                "disabled" => "disabled",
                _ => "inherit",
            },
            ProxyUrl = settings.ProxyUrl ?? "",
            ProxyUsername = settings.ProxyUsername ?? "",
            ProxyPassword = settings.ProxyPassword ?? "",
        };
    }

    internal static ApiRequest Clone(ApiRequest request, JsonDataStore store)
    {
        return store.Read(doc => Clone(request, doc));
    }

    internal static ApiRequest Clone(ApiRequest request, JsonDataDocument doc)
    {
        return new ApiRequest
        {
            Id = request.Id,
            ServiceId = request.ServiceId,
            Name = request.Name,
            Method = request.Method,
            Url = request.Url,
            Body = request.Body,
            BodyType = request.BodyType,
            PreRequestScript = request.PreRequestScript,
            PostRequestScript = request.PostRequestScript,
            TestScript = request.TestScript,
            SortOrder = request.SortOrder,
            IsFavorite = request.IsFavorite,
            CreatedAt = request.CreatedAt,
            UpdatedAt = request.UpdatedAt,
            Headers = request.Headers
                .Select(h => new KeyValuePair { Id = h.Id, Key = h.Key, Value = h.Value, Enabled = h.Enabled })
                .ToList(),
            Params = request.Params
                .Select(p => new KeyValuePair { Id = p.Id, Key = p.Key, Value = p.Value, Enabled = p.Enabled })
                .ToList(),
            Variables = request.Variables
                .Select(v => new RequestVariable { Id = v.Id, RequestId = v.RequestId, Key = v.Key, Value = v.Value, Enabled = v.Enabled })
                .ToList(),
            Auth = request.Auth == null ? null : new RequestAuth
            {
                Id = request.Auth.Id,
                RequestId = request.Auth.RequestId,
                AuthType = request.Auth.AuthType,
                ConfigJson = request.Auth.ConfigJson
            }
        };
    }
}
