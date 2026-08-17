using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public interface IWorkspaceRepository
{
    Task<IEnumerable<Workspace>> GetAllAsync();
    Task<Workspace?> GetByIdAsync(string id);
    Task<Workspace> CreateAsync(string name);
    Task<Workspace?> UpdateAsync(string id, string name);
    Task<bool> DeleteAsync(string id);
}