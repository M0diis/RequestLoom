using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public interface IServiceRepository
{
    Task<IEnumerable<Service>> GetByWorkspaceAsync(string workspaceId, bool includeRequests = false);
    Task<Service?> GetByIdAsync(string id);
    Task<Service> CreateAsync(string workspaceId, string name, string description, List<KeyValuePairRequest> headers, AuthRequest? auth, string? storagePath = null);
    Task<Service?> UpdateAsync(string id, string name, string description, List<KeyValuePairRequest> headers, AuthRequest? auth);
    Task<RequestFolder?> CreateFolderAsync(string workspaceId, string serviceId, string name);
    Task<RequestFolder?> UpdateFolderAsync(string workspaceId, string serviceId, string folderId, string name);
    Task<bool> DeleteFolderAsync(string workspaceId, string serviceId, string folderId);
    Task<bool> ReorderFoldersAsync(string workspaceId, string serviceId, List<string> folderIds);
    Task<bool> ReorderAsync(string workspaceId, List<string> serviceIds);
    Task<bool> DeleteAsync(string id);
}
