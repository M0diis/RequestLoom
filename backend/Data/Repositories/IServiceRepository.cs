using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public interface IServiceRepository
{
    Task<IEnumerable<Service>> GetByWorkspaceAsync(string workspaceId, bool includeRequests = false);
    Task<Service?> GetByIdAsync(string id);
    Task<Service> CreateAsync(string workspaceId, string name, string description, List<KeyValuePairRequest> headers, AuthRequest? auth);
    Task<Service?> UpdateAsync(string id, string name, string description, List<KeyValuePairRequest> headers, AuthRequest? auth);
    Task<bool> ReorderAsync(string workspaceId, List<string> serviceIds);
    Task<bool> DeleteAsync(string id);
}