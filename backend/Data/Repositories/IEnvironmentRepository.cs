using RequestLoom.Api.Models;
using Environment = RequestLoom.Api.Models.Environment;

namespace RequestLoom.Api.Data.Repositories;

public interface IEnvironmentRepository
{
    Task<IEnumerable<Environment>> GetByWorkspaceAsync(string workspaceId);
    Task<Environment?> GetByIdAsync(string id);
    Task<Environment> CreateAsync(string workspaceId, string name);
    Task<Environment?> UpdateAsync(string id, string name);
    Task SetActiveAsync(string workspaceId, string environmentId);
    Task<bool> DeleteAsync(string id);
    Task<EnvironmentVariable> UpsertVariableAsync(string environmentId, string key, string value, bool isSecret, bool enabled);
    Task<bool> DeleteVariableAsync(string variableId);
}