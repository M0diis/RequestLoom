using System.Text.Json;
using RequestLoom.Api.Data;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public class JsonMockServerRepository : IMockServerRepository
{
    private readonly JsonDataStore _store;

    public JsonMockServerRepository(JsonDataStore store)
    {
        _store = store;
    }

    public Task<IEnumerable<MockServer>> GetByWorkspaceAsync(string workspaceId, bool includeEndpoints = false)
    {
        var result = _store.Read(doc => doc.MockServers
            .Where(m => m.WorkspaceId == workspaceId)
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => CloneServer(m, includeEndpoints))
            .ToList());
        return Task.FromResult<IEnumerable<MockServer>>(result);
    }

    public Task<MockServer?> GetByIdAsync(string id, bool includeEndpoints = false)
    {
        var result = _store.Read(doc =>
        {
            var server = doc.MockServers.FirstOrDefault(m => m.Id == id);
            return server == null ? null : CloneServer(server, includeEndpoints);
        });
        return Task.FromResult(result);
    }

    public Task<MockServer> CreateAsync(string workspaceId, string name, string description, string slug, int port)
    {
        MockServer? created = null;
        _store.Mutate(doc =>
        {
            var id = Guid.NewGuid().ToString("N");
            var now = JsonDataStore.Now();
            var server = new MockServer
            {
                Id = id,
                WorkspaceId = workspaceId,
                Name = name,
                Description = description,
                Slug = string.IsNullOrWhiteSpace(slug) ? id : slug.Trim().ToLowerInvariant(),
                Port = port,
                IsRunning = false,
                CreatedAt = now,
                UpdatedAt = now
            };
            doc.MockServers.Add(server);
            created = server;
        });

        return Task.FromResult(CloneServer(created!, true));
    }

    public Task<MockServer?> UpdateAsync(string id, string name, string description, string slug, int port)
    {
        MockServer? updated = null;
        _store.Mutate(doc =>
        {
            var server = doc.MockServers.FirstOrDefault(m => m.Id == id);
            if (server == null) return;

            server.Name = name;
            server.Description = description;
            server.Slug = string.IsNullOrWhiteSpace(slug) ? id : slug.Trim().ToLowerInvariant();
            server.Port = port;
            server.UpdatedAt = JsonDataStore.Now();
            updated = server;
        });

        return Task.FromResult(updated == null ? null : CloneServer(updated, true));
    }

    public Task<MockServer?> GetBySlugAsync(string slug, bool includeEndpoints = false)
    {
        var result = _store.Read(doc =>
        {
            var server = doc.MockServers.FirstOrDefault(m => m.Slug == slug);
            return server == null ? null : CloneServer(server, includeEndpoints);
        });
        return Task.FromResult(result);
    }

    public Task<bool> SetRunningAsync(string id, bool isRunning)
    {
        var updated = false;
        _store.Mutate(doc =>
        {
            var server = doc.MockServers.FirstOrDefault(m => m.Id == id);
            if (server != null)
            {
                server.IsRunning = isRunning;
                updated = true;
            }
        });

        return Task.FromResult(updated);
    }

    public Task<bool> DeleteAsync(string id)
    {
        var deleted = false;
        _store.Mutate(doc =>
        {
            deleted = doc.MockServers.RemoveAll(m => m.Id == id) > 0;
        });

        return Task.FromResult(deleted);
    }

    public Task<IEnumerable<MockServerEndpoint>> GetEndpointsAsync(string mockServerId)
    {
        var result = _store.Read(doc =>
        {
            var server = doc.MockServers.FirstOrDefault(m => m.Id == mockServerId);
            return server?.Endpoints
                .OrderBy(e => e.SortOrder)
                .Select(CloneEndpoint)
                .ToList() ?? [];
        });
        return Task.FromResult<IEnumerable<MockServerEndpoint>>(result);
    }

    public Task<MockServerEndpoint?> GetEndpointByIdAsync(string id)
    {
        var result = _store.Read(doc =>
        {
            foreach (var server in doc.MockServers)
            {
                var endpoint = server.Endpoints.FirstOrDefault(e => e.Id == id);
                if (endpoint != null)
                {
                    return CloneEndpoint(endpoint);
                }
            }

            return null;
        });
        return Task.FromResult(result);
    }

    public Task<MockServerEndpoint> CreateEndpointAsync(string mockServerId, CreateMockEndpointRequest request)
    {
        MockServerEndpoint? created = null;
        _store.Mutate(doc =>
        {
            var server = doc.MockServers.FirstOrDefault(m => m.Id == mockServerId);
            if (server == null) return;

            var maxOrder = server.Endpoints.Count == 0 ? -1 : server.Endpoints.Max(e => e.SortOrder);
            var endpoint = new MockServerEndpoint
            {
                Id = Guid.NewGuid().ToString("N"),
                MockServerId = mockServerId,
                Method = request.Method.ToUpperInvariant(),
                Path = NormalizePath(request.Path),
                StatusCode = request.StatusCode,
                ContentType = request.ContentType,
                ResponseBody = request.ResponseBody,
                ResponseHeadersJson = JsonSerializer.Serialize(request.ResponseHeaders),
                ScriptEnabled = request.ScriptEnabled,
                Script = request.Script,
                Behavior = MockEndpointBehaviors.Normalize(request.Behavior),
                BehaviorConfigJson = string.IsNullOrWhiteSpace(request.BehaviorConfigJson) ? "{}" : request.BehaviorConfigJson,
                DelayMs = request.DelayMs,
                SortOrder = maxOrder + 1,
                CreatedAt = JsonDataStore.Now()
            };
            server.Endpoints.Add(endpoint);
            created = endpoint;
        });

        return Task.FromResult(CloneEndpoint(created!));
    }

    public Task<MockServerEndpoint?> UpdateEndpointAsync(string id, UpdateMockEndpointRequest request)
    {
        MockServerEndpoint? updated = null;
        _store.Mutate(doc =>
        {
            foreach (var server in doc.MockServers)
            {
                var endpoint = server.Endpoints.FirstOrDefault(e => e.Id == id);
                if (endpoint == null) continue;

                endpoint.Method = request.Method.ToUpperInvariant();
                endpoint.Path = NormalizePath(request.Path);
                endpoint.StatusCode = request.StatusCode;
                endpoint.ContentType = request.ContentType;
                endpoint.ResponseBody = request.ResponseBody;
                endpoint.ResponseHeadersJson = JsonSerializer.Serialize(request.ResponseHeaders);
                endpoint.ScriptEnabled = request.ScriptEnabled;
                endpoint.Script = request.Script;
                endpoint.Behavior = MockEndpointBehaviors.Normalize(request.Behavior);
                endpoint.BehaviorConfigJson = string.IsNullOrWhiteSpace(request.BehaviorConfigJson) ? "{}" : request.BehaviorConfigJson;
                endpoint.DelayMs = request.DelayMs;
                updated = endpoint;
                break;
            }
        });

        return Task.FromResult(updated == null ? null : CloneEndpoint(updated));
    }

    public Task<bool> DeleteEndpointAsync(string id)
    {
        var deleted = false;
        _store.Mutate(doc =>
        {
            foreach (var server in doc.MockServers)
            {
                if (server.Endpoints.RemoveAll(e => e.Id == id) > 0)
                {
                    deleted = true;
                    break;
                }
            }
        });

        return Task.FromResult(deleted);
    }

    private static MockServer CloneServer(MockServer server, bool includeEndpoints)
    {
        var result = new MockServer
        {
            Id = server.Id,
            WorkspaceId = server.WorkspaceId,
            Name = server.Name,
            Description = server.Description,
            Slug = server.Slug,
            Port = server.Port,
            IsRunning = server.IsRunning,
            CreatedAt = server.CreatedAt,
            UpdatedAt = server.UpdatedAt
        };

        if (includeEndpoints)
        {
            result.Endpoints = server.Endpoints
                .OrderBy(e => e.SortOrder)
                .Select(CloneEndpoint)
                .ToList();
        }

        return result;
    }

    private static MockServerEndpoint CloneEndpoint(MockServerEndpoint endpoint)
    {
        return new MockServerEndpoint
        {
            Id = endpoint.Id,
            MockServerId = endpoint.MockServerId,
            Method = endpoint.Method,
            Path = endpoint.Path,
            StatusCode = endpoint.StatusCode,
            ContentType = endpoint.ContentType,
            ResponseBody = endpoint.ResponseBody,
            ResponseHeadersJson = endpoint.ResponseHeadersJson,
            ScriptEnabled = endpoint.ScriptEnabled,
            Script = endpoint.Script,
            Behavior = MockEndpointBehaviors.Normalize(endpoint.Behavior),
            BehaviorConfigJson = string.IsNullOrWhiteSpace(endpoint.BehaviorConfigJson) ? "{}" : endpoint.BehaviorConfigJson,
            DelayMs = endpoint.DelayMs,
            SortOrder = endpoint.SortOrder,
            CreatedAt = endpoint.CreatedAt
        };
    }

    private static string NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "/";
        var normalized = path.Trim();
        if (!normalized.StartsWith('/')) normalized = "/" + normalized;
        return normalized;
    }
}
