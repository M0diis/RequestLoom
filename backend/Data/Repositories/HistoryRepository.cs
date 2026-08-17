using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data.Entities;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public class HistoryRepository : IHistoryRepository
{
    private readonly AppDbContext _db;

    public HistoryRepository(AppDbContext db)
    {
        _db = db;
    }

    public async Task<IEnumerable<HistoryEntry>> GetByWorkspaceAsync(
        string workspaceId,
        int limit = 50,
        int offset = 0,
        string? method = null,
        int? status = null,
        string? requestId = null)
    {
        var query = _db.History.Where(h => h.WorkspaceId == workspaceId);

        if (!string.IsNullOrWhiteSpace(method))
        {
            query = query.Where(h => h.Method == method);
        }

        if (status.HasValue)
        {
            query = query.Where(h => h.ResponseStatus == status.Value);
        }

        var trimmedRequestId = requestId?.Trim();
        if (!string.IsNullOrEmpty(trimmedRequestId))
        {
            query = query.Where(h => h.RequestId == trimmedRequestId);
        }

        var rows = await query
            .OrderByDescending(h => h.ExecutedAt)
            .Skip(offset)
            .Take(limit)
            .ToListAsync();

        return rows.Select(Map);
    }

    public async Task<HistoryEntry?> GetByIdAsync(string id)
    {
        var row = await _db.History.FindAsync(id);
        return row == null ? null : Map(row);
    }

    public async Task<HistoryEntry> CreateAsync(HistoryEntry entry)
    {
        var row = new HistoryRow
        {
            Id = Guid.NewGuid().ToString("N"),
            RequestId = entry.RequestId,
            WorkspaceId = entry.WorkspaceId,
            Method = entry.Method,
            Url = entry.Url,
            RequestHeadersJson = entry.RequestHeadersJson,
            RequestBody = entry.RequestBody,
            ResponseStatus = entry.ResponseStatus,
            ResponseHeadersJson = entry.ResponseHeadersJson,
            ResponseBody = entry.ResponseBody,
            ResponseTimeMs = entry.ResponseTimeMs,
            ResponseSizeBytes = entry.ResponseSizeBytes,
            ExecutedAt = string.IsNullOrEmpty(entry.ExecutedAt) ? DateTime.UtcNow.ToString("o") : entry.ExecutedAt,
        };
        _db.History.Add(row);
        await _db.SaveChangesAsync();

        entry.Id = row.Id;
        return entry;
    }

    public async Task<bool> DeleteAsync(string id)
    {
        var row = await _db.History.FindAsync(id);
        if (row == null)
        {
            return false;
        }

        _db.History.Remove(row);
        await _db.SaveChangesAsync();

        return true;
    }

    public async Task<int> ClearWorkspaceHistoryAsync(string workspaceId)
    {
        return await _db.History
            .Where(h => h.WorkspaceId == workspaceId)
            .ExecuteDeleteAsync();
    }

    public async Task<int> CountAsync(string workspaceId, string? requestId = null)
    {
        var query = _db.History.Where(h => h.WorkspaceId == workspaceId);

        var trimmedRequestId = requestId?.Trim();
        if (!string.IsNullOrEmpty(trimmedRequestId))
        {
            query = query.Where(h => h.RequestId == trimmedRequestId);
        }

        return await query.CountAsync();
    }

    public async Task<int> ClearRequestHistoryAsync(string requestId)
    {
        return await _db.History
            .Where(h => h.RequestId == requestId)
            .ExecuteDeleteAsync();
    }

    public async Task<int> ClearAllAsync()
    {
        return await _db.History
            .ExecuteDeleteAsync();
    }

    private static HistoryEntry Map(HistoryRow row)
    {
        return new HistoryEntry
        {
            Id = row.Id,
            RequestId = row.RequestId,
            WorkspaceId = row.WorkspaceId,
            Method = row.Method,
            Url = row.Url,
            RequestHeadersJson = row.RequestHeadersJson,
            RequestBody = row.RequestBody,
            ResponseStatus = row.ResponseStatus,
            ResponseHeadersJson = row.ResponseHeadersJson,
            ResponseBody = row.ResponseBody,
            ResponseTimeMs = row.ResponseTimeMs,
            ResponseSizeBytes = row.ResponseSizeBytes,
            ExecutedAt = row.ExecutedAt,
        };
    }
}