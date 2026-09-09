using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data.Entities;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public class HistoryRepository : IHistoryRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

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
            StatusText = entry.StatusText,
            ResponseHeadersJson = entry.ResponseHeadersJson,
            ResponseBody = entry.ResponseBody,
            ContentType = entry.ContentType,
            ResponseTimeMs = entry.ResponseTimeMs,
            ResponseSizeBytes = entry.ResponseSizeBytes,
            IsTruncated = entry.IsTruncated,
            Error = entry.Error,
            IsSoapFault = entry.IsSoapFault,
            SoapFaultJson = Serialize(entry.SoapFault),
            ScriptVariablesJson = Serialize(entry.ScriptVariables),
            ServiceScriptVariablesJson = Serialize(entry.ServiceScriptVariables),
            ScriptLogsJson = Serialize(entry.ScriptLogs),
            TestResultsJson = Serialize(entry.TestResults),
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
            StatusText = row.StatusText ?? "",
            ResponseHeadersJson = row.ResponseHeadersJson,
            ResponseBody = row.ResponseBody,
            ContentType = row.ContentType ?? "",
            ResponseTimeMs = row.ResponseTimeMs,
            ResponseSizeBytes = row.ResponseSizeBytes,
            IsTruncated = row.IsTruncated,
            Error = row.Error,
            IsSoapFault = row.IsSoapFault,
            SoapFault = Deserialize<SoapFaultInfo>(row.SoapFaultJson),
            ScriptVariables = Deserialize<Dictionary<string, RuntimeScriptVariable>>(row.ScriptVariablesJson) ?? [],
            ServiceScriptVariables = Deserialize<Dictionary<string, RuntimeScriptVariable>>(row.ServiceScriptVariablesJson) ?? [],
            ScriptLogs = Deserialize<List<string>>(row.ScriptLogsJson) ?? [],
            TestResults = Deserialize<List<TestResult>>(row.TestResultsJson) ?? [],
            ExecutedAt = row.ExecutedAt,
        };
    }

    private static string? Serialize<T>(T? value)
    {
        return value == null ? null : JsonSerializer.Serialize(value, JsonOptions);
    }

    private static T? Deserialize<T>(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return default;

        try
        {
            return JsonSerializer.Deserialize<T>(value, JsonOptions);
        }
        catch (JsonException)
        {
            return default;
        }
    }
}
