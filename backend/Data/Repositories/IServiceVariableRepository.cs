using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public interface IServiceVariableRepository
{
    Task<IEnumerable<ServiceVariable>> GetByServiceAsync(string serviceId);
    Task<IEnumerable<ServiceVariable>> GetByServiceForEnvironmentAsync(string serviceId, string? environmentId);
    Task<ServiceVariable> UpsertAsync(
        string serviceId,
        string? id,
        string key,
        string value,
        bool isSecret,
        bool enabled,
        string? environmentId);
    Task<bool> DeleteAsync(string id);
}