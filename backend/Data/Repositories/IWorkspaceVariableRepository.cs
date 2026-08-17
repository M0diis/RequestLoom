using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public interface IWorkspaceVariableRepository
{
    Task<IEnumerable<WorkspaceVariable>> GetByWorkspaceAsync(string workspaceId);
    Task<IEnumerable<WorkspaceVariable>> GetByWorkspaceForEnvironmentAsync(string workspaceId, string? environmentId);
    Task<WorkspaceVariable> UpsertAsync(
        string workspaceId,
        string? id,
        string key,
        string value,
        bool isSecret,
        bool enabled,
        string? environmentId);
    Task<bool> DeleteAsync(string id);
}