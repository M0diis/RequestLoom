using RequestLoom.Api.Data;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public class JsonHistoryRepository : IHistoryRepository
{
    private readonly JsonDataStore _store;

    public JsonHistoryRepository(JsonDataStore store)
    {
        _store = store;
    }

    public Task<IEnumerable<HistoryEntry>> GetByWorkspaceAsync(
        string workspaceId,
        int limit = 50,
        int offset = 0,
        string? method = null,
        int? status = null,
        string? requestId = null)
    {
        var normalizedRequestId = string.IsNullOrWhiteSpace(requestId) ? null : requestId.Trim();

        var result = _store.Read(doc =>
        {
            IEnumerable<HistoryEntry> query = doc.History.Where(h => h.WorkspaceId == workspaceId);

            if (method != null)
            {
                query = query.Where(h => h.Method == method);
            }

            if (status != null)
            {
                query = query.Where(h => h.ResponseStatus == status);
            }

            if (normalizedRequestId != null)
            {
                query = query.Where(h => h.RequestId == normalizedRequestId);
            }

            return query
                .OrderByDescending(h => h.ExecutedAt)
                .Skip(offset)
                .Take(limit)
                .Select(Clone)
                .ToList();
        });
        return Task.FromResult<IEnumerable<HistoryEntry>>(result);
    }

    public Task<HistoryEntry?> GetByIdAsync(string id)
    {
        var result = _store.Read(doc =>
        {
            var entry = doc.History.FirstOrDefault(h => h.Id == id);
            return entry == null ? null : Clone(entry);
        });
        return Task.FromResult(result);
    }

    public Task<HistoryEntry> CreateAsync(HistoryEntry entry)
    {
        HistoryEntry? created = null;
        _store.Mutate(doc =>
        {
            entry.Id = Guid.NewGuid().ToString("N");
            entry.ExecutedAt = JsonDataStore.Now();
            doc.History.Add(entry);
            created = entry;
        });

        return Task.FromResult(Clone(created!));
    }

    public Task<bool> DeleteAsync(string id)
    {
        var deleted = false;
        _store.Mutate(doc =>
        {
            deleted = doc.History.RemoveAll(h => h.Id == id) > 0;
        });

        return Task.FromResult(deleted);
    }

    public Task<int> ClearWorkspaceHistoryAsync(string workspaceId)
    {
        var cleared = 0;
        _store.Mutate(doc =>
        {
            cleared = doc.History.RemoveAll(h => h.WorkspaceId == workspaceId);
        });

        return Task.FromResult(cleared);
    }

    public Task<int> CountAsync(string workspaceId, string? requestId = null)
    {
        var result = _store.Read(doc =>
        {
            var query = doc.History.Where(h => h.WorkspaceId == workspaceId);

            var trimmedRequestId = requestId?.Trim();
            if (!string.IsNullOrEmpty(trimmedRequestId))
            {
                query = query.Where(h => h.RequestId == trimmedRequestId);
            }

            return query.Count();
        });
        return Task.FromResult(result);
    }

    public Task<int> ClearRequestHistoryAsync(string requestId)
    {
        var cleared = 0;
        _store.Mutate(doc =>
        {
            cleared = doc.History.RemoveAll(h => h.RequestId == requestId);
        });

        return Task.FromResult(cleared);
    }

    public Task<int> ClearAllAsync()
    {
        var cleared = 0;
        _store.Mutate(doc =>
        {
            cleared = doc.History.Count;
            doc.History.Clear();
        });

        return Task.FromResult(cleared);
    }

    private static HistoryEntry Clone(HistoryEntry entry)
    {
        return new HistoryEntry
        {
            Id = entry.Id,
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
            ExecutedAt = entry.ExecutedAt
        };
    }
}