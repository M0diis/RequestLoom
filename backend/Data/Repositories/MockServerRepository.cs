using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data.Entities;
using RequestLoom.Api.Models;
using KeyValuePair = RequestLoom.Api.Models.KeyValuePair;

namespace RequestLoom.Api.Data.Repositories;

public class MockServerRepository : IMockServerRepository
{
    private readonly AppDbContext _db;

    public MockServerRepository(AppDbContext db)
    {
        _db = db;
    }

    public async Task<IEnumerable<MockServer>> GetByWorkspaceAsync(string workspaceId, bool includeEndpoints = false)
    {
        var rows = await _db.MockServers
            .Where(m => m.WorkspaceId == workspaceId)
            .OrderByDescending(m => m.CreatedAt)
            .ToListAsync();

        var result = new List<MockServer>();
        foreach (var row in rows)
        {
            result.Add((await MapAsync(row, includeEndpoints))!);
        }

        return result;
    }

    public async Task<MockServer?> GetByIdAsync(string id, bool includeEndpoints = false)
    {
        var row = await _db.MockServers.FindAsync(id);
        return row == null ? null : await MapAsync(row, includeEndpoints);
    }

    public async Task<MockServer> CreateAsync(string workspaceId, string name, string description, string slug, int port)
    {
        var now = DateTime.UtcNow.ToString("o");
        var id = Guid.NewGuid().ToString("N");
        var row = new MockServerRow
        {
            Id = id,
            WorkspaceId = workspaceId,
            Name = name,
            Description = description,
            Slug = NormalizeSlug(slug, id),
            Port = port,
            IsRunning = false,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.MockServers.Add(row);
        await _db.SaveChangesAsync();

        return await MapAsync(row, includeEndpoints: true) ?? Map(row);
    }

    public async Task<MockServer?> UpdateAsync(string id, string name, string description, string slug, int port)
    {
        var row = await _db.MockServers.FindAsync(id);
        if (row == null)
        {
            return null;
        }

        row.Name = name;
        row.Description = description;
        row.Slug = NormalizeSlug(slug, id);
        row.Port = port;
        row.UpdatedAt = DateTime.UtcNow.ToString("o");
        await _db.SaveChangesAsync();

        return await MapAsync(row, includeEndpoints: true);
    }

    public async Task<MockServer?> GetBySlugAsync(string slug, bool includeEndpoints = false)
    {
        var row = await _db.MockServers.FirstOrDefaultAsync(m => m.Slug == slug);
        return row == null ? null : await MapAsync(row, includeEndpoints);
    }

    public async Task<bool> SetRunningAsync(string id, bool isRunning)
    {
        var count = await _db.MockServers
            .Where(m => m.Id == id)
            .ExecuteUpdateAsync(s => s
                .SetProperty(m => m.IsRunning, isRunning)
                .SetProperty(m => m.UpdatedAt, DateTime.UtcNow.ToString("o")));

        return count > 0;
    }

    public async Task<bool> DeleteAsync(string id)
    {
        var row = await _db.MockServers.FindAsync(id);
        if (row == null)
        {
            return false;
        }

        _db.MockServers.Remove(row);
        await _db.SaveChangesAsync();

        return true;
    }

    public async Task<IEnumerable<MockServerEndpoint>> GetEndpointsAsync(string mockServerId)
    {
        var rows = await _db.MockServerEndpoints
            .Where(e => e.MockServerId == mockServerId)
            .OrderBy(e => e.SortOrder)
            .ToListAsync();

        return rows.Select(Map);
    }

    public async Task<MockServerEndpoint?> GetEndpointByIdAsync(string id)
    {
        var row = await _db.MockServerEndpoints.FindAsync(id);
        return row == null ? null : Map(row);
    }

    public async Task<MockServerEndpoint> CreateEndpointAsync(string mockServerId, CreateMockEndpointRequest request)
    {
        var maxSort = await _db.MockServerEndpoints
            .Where(e => e.MockServerId == mockServerId)
            .Select(e => (int?)e.SortOrder)
            .MaxAsync() ?? -1;

        var row = new MockServerEndpointRow
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
            DelayMs = request.DelayMs,
            SortOrder = maxSort + 1,
            CreatedAt = DateTime.UtcNow.ToString("o"),
        };
        _db.MockServerEndpoints.Add(row);
        await _db.SaveChangesAsync();

        return Map(row);
    }

    public async Task<MockServerEndpoint?> UpdateEndpointAsync(string id, UpdateMockEndpointRequest request)
    {
        var row = await _db.MockServerEndpoints.FindAsync(id);
        if (row == null)
        {
            return null;
        }

        row.Method = request.Method.ToUpperInvariant();
        row.Path = NormalizePath(request.Path);
        row.StatusCode = request.StatusCode;
        row.ContentType = request.ContentType;
        row.ResponseBody = request.ResponseBody;
        row.ResponseHeadersJson = JsonSerializer.Serialize(request.ResponseHeaders);
        row.ScriptEnabled = request.ScriptEnabled;
        row.Script = request.Script;
        row.DelayMs = request.DelayMs;
        await _db.SaveChangesAsync();

        return Map(row);
    }

    public async Task<bool> DeleteEndpointAsync(string id)
    {
        var row = await _db.MockServerEndpoints.FindAsync(id);
        if (row == null)
        {
            return false;
        }

        _db.MockServerEndpoints.Remove(row);
        await _db.SaveChangesAsync();

        return true;
    }

    private async Task<MockServer?> MapAsync(MockServerRow row, bool includeEndpoints)
    {
        var result = Map(row);

        if (includeEndpoints)
        {
            result.Endpoints = (await _db.MockServerEndpoints
                    .Where(e => e.MockServerId == row.Id)
                    .OrderBy(e => e.SortOrder)
                    .ToListAsync())
                .Select(Map)
                .ToList();
        }

        return result;
    }

    private static MockServer Map(MockServerRow row)
    {
        return new MockServer
        {
            Id = row.Id,
            WorkspaceId = row.WorkspaceId,
            Name = row.Name,
            Description = row.Description,
            Slug = row.Slug,
            Port = row.Port,
            IsRunning = row.IsRunning,
            CreatedAt = row.CreatedAt,
            UpdatedAt = row.UpdatedAt,
        };
    }

    private static MockServerEndpoint Map(MockServerEndpointRow row)
    {
        return new MockServerEndpoint
        {
            Id = row.Id,
            MockServerId = row.MockServerId,
            Method = row.Method,
            Path = row.Path,
            StatusCode = row.StatusCode,
            ContentType = row.ContentType,
            ResponseBody = row.ResponseBody,
            ResponseHeadersJson = row.ResponseHeadersJson,
            ScriptEnabled = row.ScriptEnabled,
            Script = row.Script,
            DelayMs = row.DelayMs,
            SortOrder = row.SortOrder,
            CreatedAt = row.CreatedAt,
        };
    }

    private static string NormalizeSlug(string slug, string fallback)
    {
        return string.IsNullOrWhiteSpace(slug) ? fallback : slug.Trim().ToLowerInvariant();
    }

    private static string NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "/";
        var normalized = path.Trim();
        return normalized.StartsWith('/') ? normalized : "/" + normalized;
    }
}