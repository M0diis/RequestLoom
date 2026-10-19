using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data.Entities;
using RequestLoom.Api.Models;
using KeyValuePair = RequestLoom.Api.Models.KeyValuePair;

namespace RequestLoom.Api.Data.Repositories;

public class ServiceRepository : IServiceRepository
{
    private readonly AppDbContext _db;

    public ServiceRepository(AppDbContext db)
    {
        _db = db;
    }

    public async Task<IEnumerable<Service>> GetByWorkspaceAsync(string workspaceId, bool includeRequests = false)
    {   
        var rows = await _db.Services
            .Where(s => s.WorkspaceId == workspaceId)
            .OrderBy(s => s.SortOrder)
            .ToListAsync();

        var result = new List<Service>();
        foreach (var row in rows)
        {
            result.Add(await MapAsync(row, includeRequests));
        }

        return result;
    }

    public async Task<Service?> GetByIdAsync(string id)
    {
        var row = await _db.Services.FindAsync(id);
        return row == null ? null : await MapAsync(row, includeRequests: false);
    }

    public async Task<Service> CreateAsync(string workspaceId, string name, string description, List<KeyValuePairRequest> headers, AuthRequest? auth, string? storagePath = null)
    {
        var maxSort = await _db.Services
            .Where(s => s.WorkspaceId == workspaceId)
            .Select(s => (int?)s.SortOrder)
            .MaxAsync() ?? -1;

        var row = new ServiceRow
        {
            Id = Guid.NewGuid().ToString("N"),
            WorkspaceId = workspaceId,
            Name = name,
            Description = description,
            SortOrder = maxSort + 1,
            CreatedAt = DateTime.UtcNow.ToString("o"),
        };
        _db.Services.Add(row);

        ApplyHeaders(row.Id, headers);
        ApplyAuth(row.Id, auth);

        await _db.SaveChangesAsync();

        return await GetByIdAsync(row.Id) ?? Map(row);
    }

    public async Task<Service?> UpdateAsync(string id, string name, string description, List<KeyValuePairRequest> headers, AuthRequest? auth)
    {
        var row = await _db.Services.FindAsync(id);
        if (row == null)
        {
            return null;
        }

        await using var transaction = await _db.Database.BeginTransactionAsync();
        row.Name = name;
        row.Description = description;

        await _db.ServiceHeaders.Where(h => h.ServiceId == id).ExecuteDeleteAsync();
        ApplyHeaders(id, headers);

        await _db.ServiceAuths.Where(a => a.ServiceId == id).ExecuteDeleteAsync();
        ApplyAuth(id, auth);

        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        return await MapAsync(row, includeRequests: false);
    }

    public async Task<RequestFolder?> CreateFolderAsync(string workspaceId, string serviceId, string name, string? parentFolderId = null)
    {
        var serviceExists = await _db.Services.AnyAsync(s => s.Id == serviceId && s.WorkspaceId == workspaceId);
        if (!serviceExists) return null;

        parentFolderId = string.IsNullOrWhiteSpace(parentFolderId) ? null : parentFolderId;
        if (parentFolderId != null &&
            !await _db.RequestFolders.AnyAsync(f => f.Id == parentFolderId && f.ServiceId == serviceId))
            return null;

        var maxSort = await _db.RequestFolders
            .Where(f => f.ServiceId == serviceId && f.ParentFolderId == parentFolderId)
            .Select(f => (int?)f.SortOrder)
            .MaxAsync() ?? -1;

        var row = new RequestFolderRow
        {
            Id = Guid.NewGuid().ToString("N"),
            ServiceId = serviceId,
            ParentFolderId = parentFolderId,
            Name = name,
            SortOrder = maxSort + 1,
            CreatedAt = DateTime.UtcNow.ToString("o"),
        };
        _db.RequestFolders.Add(row);
        await _db.SaveChangesAsync();
        return MapFolder(row);
    }

    public async Task<RequestFolder?> UpdateFolderAsync(string workspaceId, string serviceId, string folderId, string name)
    {
        var row = await _db.RequestFolders
            .Join(_db.Services, folder => folder.ServiceId, service => service.Id, (folder, service) => new { folder, service })
            .Where(x => x.folder.Id == folderId && x.folder.ServiceId == serviceId && x.service.WorkspaceId == workspaceId)
            .Select(x => x.folder)
            .FirstOrDefaultAsync();
        if (row == null) return null;

        row.Name = name;
        await _db.SaveChangesAsync();
        return MapFolder(row);
    }

    public async Task<RequestFolder?> MoveFolderAsync(string workspaceId, string serviceId, string folderId, string? parentFolderId)
    {
        parentFolderId = string.IsNullOrWhiteSpace(parentFolderId) ? null : parentFolderId;
        var rows = await _db.RequestFolders
            .Join(_db.Services, folder => folder.ServiceId, service => service.Id, (folder, service) => new { folder, service })
            .Where(x => x.folder.ServiceId == serviceId && x.service.WorkspaceId == workspaceId)
            .Select(x => x.folder)
            .ToListAsync();
        var row = rows.FirstOrDefault(folder => folder.Id == folderId);
        if (row == null) return null;
        if (row.ParentFolderId == parentFolderId) return MapFolder(row);

        if (parentFolderId != null)
        {
            // The target must exist and must not be the folder itself or one of its descendants.
            var byId = rows.ToDictionary(folder => folder.Id);
            if (!byId.ContainsKey(parentFolderId)) return null;
            var seen = new HashSet<string>();
            for (var current = parentFolderId; current != null && seen.Add(current);
                 current = byId.TryGetValue(current, out var node) ? node.ParentFolderId : null)
            {
                if (current == folderId) return null;
            }
        }

        row.ParentFolderId = parentFolderId;
        row.SortOrder = rows.Where(folder => folder.ParentFolderId == parentFolderId && folder.Id != folderId)
            .Select(folder => folder.SortOrder).DefaultIfEmpty(-1).Max() + 1;
        await _db.SaveChangesAsync();
        return MapFolder(row);
    }

    public async Task<bool> DeleteFolderAsync(string workspaceId, string serviceId, string folderId, FolderContentsAction contents = FolderContentsAction.Parent, string? targetFolderId = null)
    {
        var row = await _db.RequestFolders
            .Join(_db.Services, folder => folder.ServiceId, service => service.Id, (folder, service) => new { folder, service })
            .Where(x => x.folder.Id == folderId && x.folder.ServiceId == serviceId && x.service.WorkspaceId == workspaceId)
            .Select(x => x.folder)
            .FirstOrDefaultAsync();
        if (row == null) return false;

        var serviceFolders = await _db.RequestFolders.Where(folder => folder.ServiceId == serviceId).ToListAsync();
        var subtree = FolderDeletion.CollectSubtree(serviceFolders, folderId);

        if (contents == FolderContentsAction.Delete)
        {
            var folderIds = subtree.Select(folder => folder.Id).ToList();
            var requests = await _db.Requests.Where(request => request.FolderId != null && folderIds.Contains(request.FolderId)).ToListAsync();
            _db.Requests.RemoveRange(requests);
            _db.RequestFolders.RemoveRange(subtree);
            await _db.SaveChangesAsync();
            return true;
        }

        string? destination = null;
        if (contents == FolderContentsAction.Parent) destination = row.ParentFolderId;
        else if (contents == FolderContentsAction.Folder)
        {
            destination = string.IsNullOrWhiteSpace(targetFolderId) ? null : targetFolderId;
            if (destination == null || subtree.Any(folder => folder.Id == destination)
                || !serviceFolders.Any(folder => folder.Id == destination)) return false;
        }

        var nextOrder = (await _db.Requests
            .Where(request => request.ServiceId == serviceId && request.FolderId == destination)
            .Select(request => (int?)request.SortOrder)
            .MaxAsync() ?? -1) + 1;
        var moving = await _db.Requests.Where(request => request.FolderId == folderId).OrderBy(request => request.SortOrder).ToListAsync();
        foreach (var request in moving)
        {
            request.FolderId = destination;
            request.SortOrder = nextOrder++;
        }
        foreach (var child in serviceFolders.Where(folder => folder.ParentFolderId == folderId))
            child.ParentFolderId = destination;
        _db.RequestFolders.Remove(row);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> ReorderFoldersAsync(string workspaceId, string serviceId, List<string> folderIds)
    {
        var validFolderIds = await _db.RequestFolders
            .Join(_db.Services, folder => folder.ServiceId, service => service.Id, (folder, service) => new { folder, service })
            .Where(x => x.folder.ServiceId == serviceId && x.service.WorkspaceId == workspaceId)
            .Select(x => x.folder)
            .ToListAsync();

        for (var i = 0; i < folderIds.Count; i++)
        {
            var row = validFolderIds.FirstOrDefault(folder => folder.Id == folderIds[i]);
            if (row != null) row.SortOrder = i;
        }

        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> ReorderAsync(string workspaceId, List<string> ids)
    {
        var rows = await _db.Services
            .Where(s => s.WorkspaceId == workspaceId)
            .ToListAsync();

        for (var i = 0; i < ids.Count; i++)
        {
            var row = rows.FirstOrDefault(s => s.Id == ids[i]);
            if (row != null)
            {
                row.SortOrder = i;
            }
        }

        await _db.SaveChangesAsync();

        return true;
    }

    public async Task<bool> DeleteAsync(string id)
    {
        var row = await _db.Services.FindAsync(id);
        if (row == null)
        {
            return false;
        }

        _db.Services.Remove(row);
        await _db.SaveChangesAsync();

        return true;
    }

    private async Task<Service> MapAsync(ServiceRow row, bool includeRequests)
    {
        var result = Map(row);

        result.Headers = (await _db.ServiceHeaders
                .Where(h => h.ServiceId == row.Id)
                .ToListAsync())
            .Select(h => new KeyValuePair { Id = h.Id, Key = h.Key, Value = h.Value, Enabled = h.Enabled })
            .ToList();

        var auth = await _db.ServiceAuths.FirstOrDefaultAsync(a => a.ServiceId == row.Id);
        if (auth != null)
        {
            result.Auth = new ServiceAuth
            {
                Id = auth.Id,
                ServiceId = auth.ServiceId,
                AuthType = auth.AuthType,
                ConfigJson = auth.ConfigJson,
            };
        }

        if (includeRequests)
        {
            var requests = await _db.Requests
                .Where(r => r.ServiceId == row.Id)
                .OrderBy(r => r.SortOrder)
                .ToListAsync();

            result.Requests = new List<ApiRequest>();
            foreach (var requestRow in requests)
            {
                result.Requests.Add(await RequestRepository.BuildAsync(_db, requestRow));
            }
        }

        result.Folders = (await _db.RequestFolders
                .Where(folder => folder.ServiceId == row.Id)
                .OrderBy(folder => folder.SortOrder)
                .ToListAsync())
            .Select(MapFolder)
            .ToList();

        return result;
    }

    private void ApplyHeaders(string serviceId, IEnumerable<KeyValuePairRequest> headers)
    {
        foreach (var header in headers)
        {
            var key = header.Key?.Trim() ?? "";
            if (string.IsNullOrEmpty(key))
            {
                continue;
            }

            _db.ServiceHeaders.Add(new ServiceHeaderRow
            {
                Id = Guid.NewGuid().ToString("N"),
                ServiceId = serviceId,
                Key = key,
                Value = header.Value ?? "",
                Enabled = header.Enabled,
            });
        }
    }

    private void ApplyAuth(string serviceId, AuthRequest? auth)
    {
        var authType = auth?.AuthType?.Trim() ?? "none";
        if (string.Equals(authType, "none", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        _db.ServiceAuths.Add(new ServiceAuthRow
        {
            Id = Guid.NewGuid().ToString("N"),
            ServiceId = serviceId,
            AuthType = authType,
            ConfigJson = string.IsNullOrEmpty(auth?.ConfigJson) ? "{}" : auth.ConfigJson,
        });
    }

    internal static Service Map(ServiceRow row)
    {
        return new Service
        {
            Id = row.Id,
            WorkspaceId = row.WorkspaceId,
            Name = row.Name,
            Description = row.Description,
            SortOrder = row.SortOrder,
            CreatedAt = row.CreatedAt,
        };
    }

    private static RequestFolder MapFolder(RequestFolderRow row)
    {
        return new RequestFolder
        {
            Id = row.Id,
            ServiceId = row.ServiceId,
            ParentFolderId = row.ParentFolderId,
            Name = row.Name,
            SortOrder = row.SortOrder,
            CreatedAt = row.CreatedAt,
        };
    }
}
