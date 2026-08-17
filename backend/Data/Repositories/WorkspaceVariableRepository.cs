using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data.Entities;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Data.Repositories;

public class WorkspaceVariableRepository : IWorkspaceVariableRepository
{
    private readonly AppDbContext _db;

    public WorkspaceVariableRepository(AppDbContext db)
    {
        _db = db;
    }

    public async Task<IEnumerable<WorkspaceVariable>> GetByWorkspaceAsync(string workspaceId)
    {
        var rows = await _db.WorkspaceVariables
            .Where(v => v.WorkspaceId == workspaceId)
            .OrderBy(v => v.Key)
            .OrderBy(v => v.EnvironmentId == null ? 0 : 1)
            .OrderBy(v => v.EnvironmentId)
            .ToListAsync();

        return rows.Select(Map);
    }

    public async Task<IEnumerable<WorkspaceVariable>> GetByWorkspaceForEnvironmentAsync(string workspaceId, string? environmentId)
    {
        var query = _db.WorkspaceVariables.Where(v => v.WorkspaceId == workspaceId);

        if (string.IsNullOrEmpty(environmentId))
        {
            query = query.Where(v => v.EnvironmentId == null);
        }
        else
        {
            query = query.Where(v => v.EnvironmentId == null || v.EnvironmentId == environmentId);
        }

        var rows = await query
            .OrderBy(v => v.Key)
            .OrderBy(v => v.EnvironmentId == null ? 0 : 1)
            .OrderBy(v => v.EnvironmentId)
            .ToListAsync();

        return rows.Select(Map);
    }

    public async Task<WorkspaceVariable> UpsertAsync(string workspaceId, string? id, string key, string value, bool isSecret, bool enabled, string? environmentId)
    {
        var normalizedId = string.IsNullOrWhiteSpace(id) ? null : id.Trim();
        var normalizedEnvId = string.IsNullOrWhiteSpace(environmentId) ? null : environmentId.Trim();

        if (normalizedId != null)
        {
            var current = await _db.WorkspaceVariables.FindAsync(normalizedId);
            if (current != null)
            {
                var conflict = await _db.WorkspaceVariables
                    .FirstOrDefaultAsync(v =>
                        v.WorkspaceId == workspaceId &&
                        v.Key == key &&
                        v.Id != normalizedId &&
                        ((v.EnvironmentId == null && current.EnvironmentId == null) ||
                         (v.EnvironmentId != null && current.EnvironmentId != null && v.EnvironmentId == current.EnvironmentId)));

                if (conflict != null)
                {
                    conflict.Value = value;
                    conflict.IsSecret = isSecret;
                    conflict.Enabled = enabled;
                    _db.WorkspaceVariables.Remove(current);
                    await _db.SaveChangesAsync();
                    return Map(conflict);
                }

                current.Key = key;
                current.Value = value;
                current.IsSecret = isSecret;
                current.Enabled = enabled;
                current.EnvironmentId = normalizedEnvId;
                await _db.SaveChangesAsync();
                return Map(current);
            }
        }

        var existing = await _db.WorkspaceVariables
            .FirstOrDefaultAsync(v =>
                v.WorkspaceId == workspaceId &&
                v.Key == key &&
                ((v.EnvironmentId == null && normalizedEnvId == null) ||
                 (v.EnvironmentId != null && normalizedEnvId != null && v.EnvironmentId == normalizedEnvId)));

        if (existing != null)
        {
            existing.Value = value;
            existing.IsSecret = isSecret;
            existing.Enabled = enabled;
            await _db.SaveChangesAsync();
            return Map(existing);
        }

        var row = new WorkspaceVariableRow
        {
            Id = Guid.NewGuid().ToString("N"),
            WorkspaceId = workspaceId,
            EnvironmentId = normalizedEnvId,
            Key = key,
            Value = value,
            IsSecret = isSecret,
            Enabled = enabled,
        };
        _db.WorkspaceVariables.Add(row);
        await _db.SaveChangesAsync();

        return Map(row);
    }

    public async Task<bool> DeleteAsync(string id)
    {
        var row = await _db.WorkspaceVariables.FindAsync(id);
        if (row == null)
        {
            return false;
        }

        _db.WorkspaceVariables.Remove(row);
        await _db.SaveChangesAsync();

        return true;
    }

    internal static WorkspaceVariable Map(WorkspaceVariableRow row)
    {
        return new WorkspaceVariable
        {
            Id = row.Id,
            WorkspaceId = row.WorkspaceId,
            EnvironmentId = row.EnvironmentId,
            Key = row.Key,
            Value = row.Value,
            IsSecret = row.IsSecret,
            Enabled = row.Enabled,
        };
    }
}