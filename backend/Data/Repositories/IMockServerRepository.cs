using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public interface IMockServerRepository
{
    Task<IEnumerable<MockServer>> GetByWorkspaceAsync(string workspaceId, bool includeEndpoints = false);
    Task<MockServer?> GetByIdAsync(string id, bool includeEndpoints = false);
    Task<MockServer> CreateAsync(string workspaceId, string name, string description, string slug, int port);
    Task<MockServer?> UpdateAsync(string id, string name, string description, string slug, int port);
    Task<MockServer?> GetBySlugAsync(string slug, bool includeEndpoints = false);
    Task<bool> SetRunningAsync(string id, bool isRunning);
    Task<bool> DeleteAsync(string id);
    Task<IEnumerable<MockServerEndpoint>> GetEndpointsAsync(string mockServerId);
    Task<MockServerEndpoint?> GetEndpointByIdAsync(string id);
    Task<MockServerEndpoint> CreateEndpointAsync(string mockServerId, CreateMockEndpointRequest request);
    Task<MockServerEndpoint?> UpdateEndpointAsync(string id, UpdateMockEndpointRequest request);
    Task<bool> DeleteEndpointAsync(string id);
}