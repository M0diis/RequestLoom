using RequestLoom.Api.Data;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public class JsonWorkspaceRepository : IWorkspaceRepository
{
    private readonly JsonDataStore _store;

    public JsonWorkspaceRepository(JsonDataStore store)
    {
        _store = store;
    }

    public Task<IEnumerable<Workspace>> GetAllAsync()
    {
        var result = _store.Read(doc => doc.Workspaces
            .OrderBy(w => w.CreatedAt)
            .Select(Clone)
            .ToList());
        return Task.FromResult<IEnumerable<Workspace>>(result);
    }

    public Task<Workspace?> GetByIdAsync(string id)
    {
        var result = _store.Read(doc => doc.Workspaces.FirstOrDefault(w => w.Id == id));
        return Task.FromResult(result == null ? null : Clone(result));
    }

    public Task<Workspace> CreateAsync(string name)
    {
        Workspace? created = null;
        _store.Mutate(doc =>
        {
            var workspace = new Workspace
            {
                Id = Guid.NewGuid().ToString("N"),
                Name = name,
                CreatedAt = JsonDataStore.Now(),
                UpdatedAt = JsonDataStore.Now()
            };
            doc.Workspaces.Add(workspace);
            JsonDataStore.SeedEnvironments(doc, workspace.Id);
            created = workspace;
        });

        return Task.FromResult(Clone(created!));
    }

    public Task<Workspace?> UpdateAsync(string id, string name)
    {
        Workspace? updated = null;
        _store.Mutate(doc =>
        {
            var workspace = doc.Workspaces.FirstOrDefault(w => w.Id == id);
            if (workspace != null)
            {
                workspace.Name = name;
                workspace.UpdatedAt = JsonDataStore.Now();
                updated = workspace;
            }
        });

        return Task.FromResult(updated == null ? null : Clone(updated));
    }

    public Task<bool> DeleteAsync(string id)
    {
        var deleted = false;
        _store.Mutate(doc =>
        {
            var workspace = doc.Workspaces.FirstOrDefault(w => w.Id == id);
            if (workspace == null) return;

            doc.Workspaces.Remove(workspace);
            doc.Environments.RemoveAll(e => e.WorkspaceId == id);
            doc.EnvironmentVariables.RemoveAll(v => doc.Environments.All(e => e.Id != v.EnvironmentId));
            doc.Services.RemoveAll(s => s.WorkspaceId == id);
            doc.Requests.RemoveAll(r => doc.Services.All(s => s.Id != r.ServiceId));
            doc.WorkspaceVariables.RemoveAll(v => v.WorkspaceId == id);
            doc.ServiceVariables.RemoveAll(v => doc.Services.All(s => s.Id != v.ServiceId));
            doc.History.RemoveAll(h => h.WorkspaceId == id);
            doc.MockServers.RemoveAll(m => m.WorkspaceId == id);
            deleted = true;
        });

        return Task.FromResult(deleted);
    }

    private static Workspace Clone(Workspace workspace)
    {
        return new Workspace
        {
            Id = workspace.Id,
            Name = workspace.Name,
            CreatedAt = workspace.CreatedAt,
            UpdatedAt = workspace.UpdatedAt
        };
    }
}