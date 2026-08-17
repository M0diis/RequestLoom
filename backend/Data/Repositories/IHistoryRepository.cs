using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public interface IHistoryRepository
{
    Task<IEnumerable<HistoryEntry>> GetByWorkspaceAsync(
        string workspaceId,
        int limit = 50,
        int offset = 0,
        string? method = null,
        int? status = null,
        string? requestId = null);
    Task<HistoryEntry?> GetByIdAsync(string id);
    Task<HistoryEntry> CreateAsync(HistoryEntry entry);
    Task<bool> DeleteAsync(string id);
    Task<int> CountAsync(string workspaceId, string? requestId = null);
    Task<int> ClearWorkspaceHistoryAsync(string workspaceId);
    Task<int> ClearRequestHistoryAsync(string requestId);
    Task<int> ClearAllAsync();
}