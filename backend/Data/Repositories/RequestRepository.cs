using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data.Entities;
using RequestLoom.Api.Models;
using KeyValuePair = RequestLoom.Api.Models.KeyValuePair;

namespace RequestLoom.Api.Data.Repositories;

public class RequestRepository : IRequestRepository
{
    private readonly AppDbContext _db;

    public RequestRepository(AppDbContext db)
    {
        _db = db;
    }

    public async Task<ApiRequest?> GetByIdAsync(string id)
    {
        var row = await _db.Requests.FindAsync(id);
        return row == null ? null : await BuildAsync(_db, row);
    }

    public async Task<ApiRequest> CreateAsync(string serviceId, CreateApiRequestRequest request)
    {
        var maxSort = await _db.Requests
            .Where(r => r.ServiceId == serviceId)
            .Select(r => (int?)r.SortOrder)
            .MaxAsync() ?? -1;

        var now = DateTime.UtcNow.ToString("o");
        var row = new ApiRequestRow
        {
            Id = Guid.NewGuid().ToString("N"),
            ServiceId = serviceId,
            Name = request.Name,
            Method = request.Method,
            Url = request.Url,
            Body = request.Body,
            BodyType = request.BodyType,
            PreRequestScript = "",
            PostRequestScript = "",
            TestScript = "",
            SortOrder = maxSort + 1,
            IsFavorite = false,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Requests.Add(row);
        await _db.SaveChangesAsync();

        return await BuildAsync(_db, row);
    }

    public async Task<ApiRequest?> UpdateAsync(string id, UpdateApiRequestRequest request)
    {
        var row = await _db.Requests.FindAsync(id);
        if (row == null)
        {
            return null;
        }

        row.Name = request.Name;
        row.Method = request.Method;
        row.Url = request.Url;
        row.Body = request.Body;
        row.BodyType = request.BodyType;
        row.PreRequestScript = request.PreRequestScript ?? "";
        row.PostRequestScript = request.PostRequestScript ?? "";
        row.TestScript = request.TestScript ?? "";
        row.UpdatedAt = DateTime.UtcNow.ToString("o");

        await _db.RequestHeaders.Where(h => h.RequestId == id).ExecuteDeleteAsync();
        await _db.RequestParams.Where(p => p.RequestId == id).ExecuteDeleteAsync();
        await _db.RequestVariables.Where(v => v.RequestId == id).ExecuteDeleteAsync();

        foreach (var header in request.Headers)
        {
            var key = header.Key?.Trim() ?? "";
            if (string.IsNullOrEmpty(key))
            {
                continue;
            }

            _db.RequestHeaders.Add(new RequestHeaderRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = id,
                Key = key,
                Value = header.Value ?? "",
                Enabled = header.Enabled,
            });
        }

        foreach (var param in request.Params)
        {
            var key = param.Key?.Trim() ?? "";
            if (string.IsNullOrEmpty(key))
            {
                continue;
            }

            _db.RequestParams.Add(new RequestParamRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = id,
                Key = key,
                Value = param.Value ?? "",
                Enabled = param.Enabled,
            });
        }

        foreach (var variable in request.Variables)
        {
            _db.RequestVariables.Add(new RequestVariableRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = id,
                Key = variable.Key,
                Value = variable.Value,
                Enabled = variable.Enabled,
            });
        }

        await _db.RequestAuths.Where(a => a.RequestId == id).ExecuteDeleteAsync();

        if (request.Auth != null)
        {
            var authType = request.Auth.AuthType?.Trim() ?? "inherit";
            if (!string.Equals(authType, "inherit", StringComparison.OrdinalIgnoreCase))
            {
                _db.RequestAuths.Add(new RequestAuthRow
                {
                    Id = Guid.NewGuid().ToString("N"),
                    RequestId = id,
                    AuthType = authType,
                    ConfigJson = string.IsNullOrEmpty(request.Auth.ConfigJson) ? "{}" : request.Auth.ConfigJson,
                });
            }
        }

        await _db.SaveChangesAsync();

        return await BuildAsync(_db, row);
    }

    public async Task<ApiRequest?> DuplicateAsync(string id)
    {
        var row = await _db.Requests.FindAsync(id);
        if (row == null)
        {
            return null;
        }

        var maxSort = await _db.Requests
            .Where(r => r.ServiceId == row.ServiceId)
            .Select(r => (int?)r.SortOrder)
            .MaxAsync() ?? -1;

        var now = DateTime.UtcNow.ToString("o");
        var copy = new ApiRequestRow
        {
            Id = Guid.NewGuid().ToString("N"),
            ServiceId = row.ServiceId,
            Name = row.Name + " (copy)",
            Method = row.Method,
            Url = row.Url,
            Body = row.Body,
            BodyType = row.BodyType,
            PreRequestScript = row.PreRequestScript,
            PostRequestScript = row.PostRequestScript,
            TestScript = row.TestScript,
            SortOrder = maxSort + 1,
            IsFavorite = false,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Requests.Add(copy);

        await CopyChildrenAsync(id, copy.Id);
        await _db.SaveChangesAsync();

        return await BuildAsync(_db, copy);
    }

    public async Task<bool> ToggleFavoriteAsync(string id)
    {
        var row = await _db.Requests.FindAsync(id);
        if (row == null)
        {
            return false;
        }

        row.IsFavorite = !row.IsFavorite;
        await _db.SaveChangesAsync();

        return true;
    }

    public async Task<bool> DeleteAsync(string id)
    {
        var row = await _db.Requests.FindAsync(id);
        if (row == null)
        {
            return false;
        }

        _db.Requests.Remove(row);
        await _db.SaveChangesAsync();

        return true;
    }

    public async Task<List<ApiRequest>> GetByServiceIdAsync(string serviceId)
    {
        var rows = await _db.Requests
            .Where(r => r.ServiceId == serviceId)
            .OrderBy(r => r.SortOrder)
            .ToListAsync();

        var result = new List<ApiRequest>();
        foreach (var row in rows)
        {
            result.Add(await BuildAsync(_db, row));
        }

        return result;
    }

    public async Task<bool> MoveToServiceAsync(string id, string newServiceId)
    {
        var row = await _db.Requests.FindAsync(id);
        if (row == null)
        {
            return false;
        }

        var maxSort = await _db.Requests
            .Where(r => r.ServiceId == newServiceId)
            .Select(r => (int?)r.SortOrder)
            .MaxAsync() ?? -1;

        row.ServiceId = newServiceId;
        row.SortOrder = maxSort + 1;
        await _db.SaveChangesAsync();

        return true;
    }

    public async Task<ApiRequestSettings?> GetSettingsAsync(string requestId)
    {
        var row = await _db.RequestSettings.FirstOrDefaultAsync(s => s.RequestId == requestId);
        if (row == null) return null;

        return MapSettings(row);
    }

    public async Task<ApiRequestSettings> SaveSettingsAsync(string requestId, ApiRequestSettings settings)
    {
        var row = await _db.RequestSettings.FirstOrDefaultAsync(s => s.RequestId == requestId);
        if (row == null)
        {
            row = new RequestSettingsRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = requestId,
            };
            _db.RequestSettings.Add(row);
        }

        row.FollowRedirects = settings.FollowRedirects;
        row.MaxRedirects = Math.Clamp(settings.MaxRedirects, 1, 50);
        row.IgnoreSslErrors = settings.IgnoreSslErrors;
        row.TimeoutSeconds = settings.TimeoutSeconds is > 0 ? settings.TimeoutSeconds : null;
        row.ProxyMode = NormalizeProxyMode(settings.ProxyMode);
        row.ProxyUrl = settings.ProxyUrl?.Trim() ?? "";
        row.ProxyUsername = settings.ProxyUsername ?? "";
        row.ProxyPassword = settings.ProxyPassword ?? "";

        await _db.SaveChangesAsync();

        return MapSettings(row);
    }

    private static ApiRequestSettings MapSettings(RequestSettingsRow row)
    {
        return new ApiRequestSettings
        {
            RequestId = row.RequestId,
            FollowRedirects = row.FollowRedirects,
            MaxRedirects = row.MaxRedirects is > 0 ? row.MaxRedirects : 10,
            IgnoreSslErrors = row.IgnoreSslErrors,
            TimeoutSeconds = row.TimeoutSeconds,
            ProxyMode = NormalizeProxyMode(row.ProxyMode),
            ProxyUrl = row.ProxyUrl ?? "",
            ProxyUsername = row.ProxyUsername ?? "",
            ProxyPassword = row.ProxyPassword ?? "",
        };
    }

    private static string NormalizeProxyMode(string? mode) => mode?.Trim().ToLowerInvariant() switch
    {
        "custom" => "custom",
        "disabled" => "disabled",
        _ => "inherit",
    };

    private async Task CopyChildrenAsync(string sourceRequestId, string targetRequestId)
    {
        var headers = await _db.RequestHeaders.Where(h => h.RequestId == sourceRequestId).ToListAsync();
        _db.RequestHeaders.AddRange(headers.Select(h => new RequestHeaderRow
        {
            Id = Guid.NewGuid().ToString("N"),
            RequestId = targetRequestId,
            Key = h.Key,
            Value = h.Value,
            Enabled = h.Enabled,
        }));

        var params_ = await _db.RequestParams.Where(p => p.RequestId == sourceRequestId).ToListAsync();
        _db.RequestParams.AddRange(params_.Select(p => new RequestParamRow
        {
            Id = Guid.NewGuid().ToString("N"),
            RequestId = targetRequestId,
            Key = p.Key,
            Value = p.Value,
            Enabled = p.Enabled,
        }));

        var variables = await _db.RequestVariables.Where(v => v.RequestId == sourceRequestId).ToListAsync();
        _db.RequestVariables.AddRange(variables.Select(v => new RequestVariableRow
        {
            Id = Guid.NewGuid().ToString("N"),
            RequestId = targetRequestId,
            Key = v.Key,
            Value = v.Value,
            Enabled = v.Enabled,
        }));

        var auth = await _db.RequestAuths.FirstOrDefaultAsync(a => a.RequestId == sourceRequestId);
        if (auth != null)
        {
            _db.RequestAuths.Add(new RequestAuthRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = targetRequestId,
                AuthType = auth.AuthType,
                ConfigJson = auth.ConfigJson,
            });
        }

        var settings = await _db.RequestSettings.FirstOrDefaultAsync(s => s.RequestId == sourceRequestId);
        if (settings != null)
        {
            _db.RequestSettings.Add(new RequestSettingsRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = targetRequestId,
                FollowRedirects = settings.FollowRedirects,
                MaxRedirects = settings.MaxRedirects,
                IgnoreSslErrors = settings.IgnoreSslErrors,
                TimeoutSeconds = settings.TimeoutSeconds,
                ProxyMode = settings.ProxyMode,
                ProxyUrl = settings.ProxyUrl,
                ProxyUsername = settings.ProxyUsername,
                ProxyPassword = settings.ProxyPassword,
            });
        }
    }

    internal static async Task<ApiRequest> BuildAsync(AppDbContext db, ApiRequestRow row)
    {
        var result = new ApiRequest
        {
            Id = row.Id,
            ServiceId = row.ServiceId,
            Name = row.Name,
            Method = row.Method,
            Url = row.Url,
            Body = row.Body,
            BodyType = row.BodyType,
            PreRequestScript = row.PreRequestScript,
            PostRequestScript = row.PostRequestScript,
            TestScript = row.TestScript,
            SortOrder = row.SortOrder,
            IsFavorite = row.IsFavorite,
            CreatedAt = row.CreatedAt,
            UpdatedAt = row.UpdatedAt,
        };

        var headers = await db.RequestHeaders.Where(h => h.RequestId == row.Id).ToListAsync();
        result.Headers = headers
            .Select(h => new KeyValuePair { Id = h.Id, Key = h.Key, Value = h.Value, Enabled = h.Enabled })
            .ToList();

        var params_ = await db.RequestParams.Where(p => p.RequestId == row.Id).ToListAsync();
        result.Params = params_
            .Select(p => new KeyValuePair { Id = p.Id, Key = p.Key, Value = p.Value, Enabled = p.Enabled })
            .ToList();

        var variables = await db.RequestVariables.Where(v => v.RequestId == row.Id).ToListAsync();
        result.Variables = variables
            .Select(v => new RequestVariable { Id = v.Id, RequestId = v.RequestId, Key = v.Key, Value = v.Value, Enabled = v.Enabled })
            .ToList();

        var auth = await db.RequestAuths.FirstOrDefaultAsync(a => a.RequestId == row.Id);
        if (auth != null)
        {
            result.Auth = new RequestAuth
            {
                Id = auth.Id,
                RequestId = auth.RequestId,
                AuthType = auth.AuthType,
                ConfigJson = auth.ConfigJson,
            };
        }

        return result;
    }
}
