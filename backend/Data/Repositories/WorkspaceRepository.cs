using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data.Entities;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public class WorkspaceRepository : IWorkspaceRepository
{
    private readonly AppDbContext _db;

    public WorkspaceRepository(AppDbContext db)
    {
        _db = db;
    }

    public async Task<IEnumerable<Workspace>> GetAllAsync()
    {
        var rows = await _db.Workspaces
            .OrderBy(w => w.CreatedAt)
            .ToListAsync();

        return rows.Select(Map);
    }

    public async Task<Workspace?> GetByIdAsync(string id)
    {
        var row = await _db.Workspaces.FindAsync(id);
        return row == null ? null : Map(row);
    }

    public async Task<Workspace> CreateAsync(string name)
    {
        var now = DateTime.UtcNow.ToString("o");
        var workspace = new WorkspaceRow
        {
            Id = Guid.NewGuid().ToString("N"),
            Name = name,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Workspaces.Add(workspace);

        _db.Environments.AddRange(
            new EnvironmentRow { Id = Guid.NewGuid().ToString("N"), WorkspaceId = workspace.Id, Name = "DEV", IsActive = true, SortOrder = 0, CreatedAt = now },
            new EnvironmentRow { Id = Guid.NewGuid().ToString("N"), WorkspaceId = workspace.Id, Name = "STG", IsActive = false, SortOrder = 1, CreatedAt = now },
            new EnvironmentRow { Id = Guid.NewGuid().ToString("N"), WorkspaceId = workspace.Id, Name = "PRD", IsActive = false, SortOrder = 2, CreatedAt = now });

        await _db.SaveChangesAsync();

        return Map(workspace);
    }

    public async Task<Workspace?> UpdateAsync(string id, string name)
    {
        var row = await _db.Workspaces.FindAsync(id);
        if (row == null)
        {
            return null;
        }

        row.Name = name;
        row.UpdatedAt = DateTime.UtcNow.ToString("o");
        await _db.SaveChangesAsync();

        return Map(row);
    }

    public async Task<bool> DeleteAsync(string id)
    {
        var row = await _db.Workspaces.FindAsync(id);
        if (row == null)
        {
            return false;
        }

        _db.Workspaces.Remove(row);
        await _db.SaveChangesAsync();

        return true;
    }

    private static Workspace Map(WorkspaceRow row)
    {
        return new Workspace
        {
            Id = row.Id,
            Name = row.Name,
            CreatedAt = row.CreatedAt,
            UpdatedAt = row.UpdatedAt,
        };
    }
}