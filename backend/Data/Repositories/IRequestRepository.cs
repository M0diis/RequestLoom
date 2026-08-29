using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public interface IRequestRepository
{
    Task<ApiRequest?> GetByIdAsync(string id);
    Task<ApiRequest> CreateAsync(string serviceId, CreateApiRequestRequest req);
    Task<ApiRequest?> UpdateAsync(string id, UpdateApiRequestRequest req);
    Task<ApiRequest?> DuplicateAsync(string id);
    Task<bool> ToggleFavoriteAsync(string id);
    Task<bool> DeleteAsync(string id);
    Task<List<ApiRequest>> GetByServiceIdAsync(string serviceId);
    Task<bool> MoveToServiceAsync(string id, string newServiceId);
    Task<bool> MoveToFolderAsync(string id, string? folderId);
    Task<bool> ReorderAsync(string id, string? folderId, string? beforeRequestId);
    Task<ApiRequestSettings?> GetSettingsAsync(string requestId);
    Task<ApiRequestSettings> SaveSettingsAsync(string requestId, ApiRequestSettings settings);
}
