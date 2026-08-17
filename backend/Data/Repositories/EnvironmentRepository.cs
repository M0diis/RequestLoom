using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data.Entities;
using RequestLoom.Api.Models;
using Environment = RequestLoom.Api.Models.Environment;

namespace RequestLoom.Api.Data.Repositories;

public class EnvironmentRepository : IEnvironmentRepository
{
    private readonly AppDbContext _db;

    public EnvironmentRepository(AppDbContext db)
    {
        _db = db;
    }

    public async Task<IEnumerable<Environment>> GetByWorkspaceAsync(string workspaceId)
    {
        var rows = await _db.Environments
            .Where(e => e.WorkspaceId == workspaceId)
            .OrderBy(e => e.SortOrder)
            .ToListAsync();

        var result = new List<Environment>();
        foreach (var row in rows)
        {
            result.Add(await MapAsync(row));
        }

        return result;
    }

    public async Task<Environment?> GetByIdAsync(string id)
    {
        var row = await _db.Environments.FindAsync(id);
        return row == null ? null : await MapAsync(row);
    }

    public async Task<Environment> CreateAsync(string workspaceId, string name)
    {
        var hasExisting = await _db.Environments.AnyAsync(e => e.WorkspaceId == workspaceId);
        var maxSort = await _db.Environments
            .Where(e => e.WorkspaceId == workspaceId)
            .Select(e => (int?)e.SortOrder)
            .MaxAsync() ?? -1;

        var row = new EnvironmentRow
        {
            Id = Guid.NewGuid().ToString("N"),
            WorkspaceId = workspaceId,
            Name = name,
            IsActive = !hasExisting,
            SortOrder = maxSort + 1,
            CreatedAt = DateTime.UtcNow.ToString("o"),
        };
        _db.Environments.Add(row);
        await _db.SaveChangesAsync();

        return Map(row);
    }

    public async Task<Environment?> UpdateAsync(string id, string name)
    {
        var row = await _db.Environments.FindAsync(id);
        if (row == null)
        {
            return null;
        }

        row.Name = name;
        await _db.SaveChangesAsync();

        return Map(row);
    }

    public async Task SetActiveAsync(string workspaceId, string environmentId)
    {
        var target = await _db.Environments.FindAsync(environmentId);
        if (target == null || target.WorkspaceId != workspaceId)
        {
            return;
        }

        var envs = await _db.Environments
            .Where(e => e.WorkspaceId == workspaceId)
            .ToListAsync();

        foreach (var env in envs)
        {
            env.IsActive = env.Id == environmentId;
        }

        await _db.SaveChangesAsync();
    }

    public async Task<bool> DeleteAsync(string id)
    {
        var row = await _db.Environments.FindAsync(id);
        if (row == null)
        {
            return false;
        }

        var workspaceId = row.WorkspaceId;
        _db.Environments.Remove(row);
        await _db.SaveChangesAsync();

        var hasActive = await _db.Environments.AnyAsync(e => e.WorkspaceId == workspaceId && e.IsActive);
        if (!hasActive)
        {
            var fallback = await _db.Environments
                .Where(e => e.WorkspaceId == workspaceId)
                .OrderBy(e => e.SortOrder)
                .FirstOrDefaultAsync();

            if (fallback != null)
            {
                fallback.IsActive = true;
                await _db.SaveChangesAsync();
            }
        }

        return true;
    }

    public async Task<EnvironmentVariable> UpsertVariableAsync(string environmentId, string key, string value, bool isSecret, bool enabled)
    {
        var row = await _db.EnvironmentVariables
            .FirstOrDefaultAsync(v => v.EnvironmentId == environmentId && v.Key == key);

        if (row == null)
        {
            row = new EnvironmentVariableRow
            {
                Id = Guid.NewGuid().ToString("N"),
                EnvironmentId = environmentId,
                Key = key,
                Value = value,
                IsSecret = isSecret,
                Enabled = enabled,
            };
            _db.EnvironmentVariables.Add(row);
            await _db.SaveChangesAsync();
        }
        else
        {
            row.Value = value;
            row.IsSecret = isSecret;
            row.Enabled = enabled;
            await _db.SaveChangesAsync();
        }

        return new EnvironmentVariable
        {
            Id = row.Id,
            EnvironmentId = row.EnvironmentId,
            Key = row.Key,
            Value = row.Value,
            IsSecret = row.IsSecret,
            Enabled = row.Enabled,
        };
    }

    public async Task<bool> DeleteVariableAsync(string variableId)
    {
        var row = await _db.EnvironmentVariables.FindAsync(variableId);
        if (row == null)
        {
            return false;
        }

        _db.EnvironmentVariables.Remove(row);
        await _db.SaveChangesAsync();

        return true;
    }

    private async Task<Environment> MapAsync(EnvironmentRow row)
    {
        var result = Map(row);
        result.Variables = await _db.EnvironmentVariables
            .Where(v => v.EnvironmentId == row.Id)
            .OrderBy(v => v.Key)
            .Select(v => new EnvironmentVariable
            {
                Id = v.Id,
                EnvironmentId = v.EnvironmentId,
                Key = v.Key,
                Value = v.Value,
                IsSecret = v.IsSecret,
                Enabled = v.Enabled,
            })
            .ToListAsync();

        return result;
    }

    private static Environment Map(EnvironmentRow row)
    {
        return new Environment
        {
            Id = row.Id,
            WorkspaceId = row.WorkspaceId,
            Name = row.Name,
            IsActive = row.IsActive,
            SortOrder = row.SortOrder,
            CreatedAt = row.CreatedAt,
        };
    }
}