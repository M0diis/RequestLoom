using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data;
using RequestLoom.Api.Data.Entities;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;
using KeyValuePair = RequestLoom.Api.Models.KeyValuePair;
using EnvModel = RequestLoom.Api.Models.Environment;

namespace RequestLoom.Api.Services;

public class ExportImportService
{
    private readonly SettingsService _settings;
    private readonly IWorkspaceRepository _workspaces;
    private readonly IEnvironmentRepository _environments;
    private readonly IServiceRepository _services;
    private readonly IServiceVariableRepository _serviceVariables;
    private readonly IWorkspaceVariableRepository _workspaceVariables;
    private readonly IRequestRepository _requests;
    private readonly IHistoryRepository _history;
    private readonly AppDbContext _db;
    private readonly JsonDataStore _jsonStore;

    public ExportImportService(
        SettingsService settings,
        IWorkspaceRepository workspaces,
        IEnvironmentRepository environments,
        IServiceRepository services,
        IServiceVariableRepository serviceVariables,
        IWorkspaceVariableRepository workspaceVariables,
        IRequestRepository requests,
        IHistoryRepository history,
        AppDbContext db,
        JsonDataStore jsonStore)
    {
        _settings = settings;
        _workspaces = workspaces;
        _environments = environments;
        _services = services;
        _serviceVariables = serviceVariables;
        _workspaceVariables = workspaceVariables;
        _requests = requests;
        _history = history;
        _db = db;
        _jsonStore = jsonStore;
    }

    /// <summary>List of workspaces for the sidebar.</summary>
    public async Task<WorkspaceExport> ExportWorkspaceAsync(string workspaceId)
    {
        var workspace = await _workspaces.GetByIdAsync(workspaceId)
            ?? throw new InvalidOperationException("Workspace not found");

        var environments = (await _environments.GetByWorkspaceAsync(workspaceId)).ToList();

        var envExports = new List<EnvironmentExport>();
        foreach (var env in environments)
        {
            envExports.Add(new EnvironmentExport
            {
                Name = env.Name,
                IsActive = env.IsActive,
                SortOrder = env.SortOrder,
                Variables = env.Variables
                    .OrderBy(v => v.Key)
                    .Select(v => new EnvironmentVariableExport
                    {
                        Key = v.Key,
                        Value = v.Value,
                        IsSecret = v.IsSecret,
                        Enabled = v.Enabled,
                    }).ToList(),
            });
        }

        var workspaceVars = (await _workspaceVariables.GetByWorkspaceAsync(workspaceId)).ToList();

        var services = (await _services.GetByWorkspaceAsync(workspaceId)).ToList();

        var serviceExports = new List<ServiceExport>();
        foreach (var svc in services)
        {
            var requests = await _requests.GetByServiceIdAsync(svc.Id);
            var svcVars = (await _serviceVariables.GetByServiceAsync(svc.Id)).ToList();
            var folderNames = svc.Folders.ToDictionary(folder => folder.Id, folder => folder.Name);

            var requestExports = new List<RequestExport>();
            foreach (var request in requests)
            {
                requestExports.Add(await BuildRequestExportAsync(request, folderNames));
            }

            serviceExports.Add(new ServiceExport
            {
                Name = svc.Name,
                Description = svc.Description,
                SortOrder = svc.SortOrder,
                Headers = svc.Headers
                    .Select(h => new KeyValuePairRequest { Key = h.Key, Value = h.Value, Enabled = h.Enabled })
                    .ToList(),
                Auth = BuildServiceAuth(svc.Auth),
                Folders = svc.Folders
                    .OrderBy(folder => folder.SortOrder)
                    .Select(folder => new RequestFolderExport { Name = folder.Name, SortOrder = folder.SortOrder })
                    .ToList(),
                Variables = svcVars
                    .OrderBy(v => v.Key)
                    .Select(v => new ServiceVariableExport
                    {
                        EnvironmentId = v.EnvironmentId,
                        Key = v.Key,
                        Value = v.Value,
                        IsSecret = v.IsSecret,
                        Enabled = v.Enabled,
                    }).ToList(),
                Requests = requestExports,
            });
        }

        var history = (await _history.GetByWorkspaceAsync(workspaceId, limit: 500)).ToList();

        return new WorkspaceExport
        {
            Name = workspace.Name,
            Environments = envExports,
            WorkspaceVariables = workspaceVars,
            Services = serviceExports,
            History = history,
        };
    }

    /// <summary>
    /// Import data into an existing workspace. Merges services, variables, and requests.
    /// </summary>
    public async Task ImportIntoWorkspaceAsync(string workspaceId, WorkspaceExport data)
    {
        if (_settings.UseJson)
        {
            ImportIntoJson(data, workspaceId);
            return;
        }

        if (!await _db.Workspaces.AnyAsync(w => w.Id == workspaceId))
        {
            throw new InvalidOperationException("Workspace not found");
        }

        await using var tx = await _db.Database.BeginTransactionAsync();

        try
        {
            await ImportCoreAsync(workspaceId, data);
            await tx.CommitAsync();
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }

    public async Task<Workspace> ImportWorkspaceAsync(WorkspaceExport data)
    {
        var workspaceId = Guid.NewGuid().ToString("N");
        var name = string.IsNullOrWhiteSpace(data.Name) ? "Imported Workspace" : data.Name.Trim();

        if (_settings.UseJson)
        {
            ImportJson(data, workspaceId);
            return new Workspace
            {
                Id = workspaceId,
                Name = name,
                CreatedAt = DateTime.UtcNow.ToString("O"),
                UpdatedAt = DateTime.UtcNow.ToString("O"),
            };
        }

        await using var tx = await _db.Database.BeginTransactionAsync();

        try
        {
            _db.Workspaces.Add(new WorkspaceRow
            {
                Id = workspaceId,
                Name = name,
                CreatedAt = DateTime.UtcNow.ToString("O"),
                UpdatedAt = DateTime.UtcNow.ToString("O"),
            });

            await ImportCoreAsync(workspaceId, data);

            await tx.CommitAsync();

            return new Workspace
            {
                Id = workspaceId,
                Name = name,
                CreatedAt = DateTime.UtcNow.ToString("O"),
                UpdatedAt = DateTime.UtcNow.ToString("O"),
            };
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }

    /// <summary>Export a single service with all its requests, variables, headers, and auth.</summary>
    public async Task<ServiceExport> ExportServiceAsync(string serviceId)
    {
        var svc = await _services.GetByIdAsync(serviceId)
            ?? throw new InvalidOperationException("Service not found");

        var requests = await _requests.GetByServiceIdAsync(serviceId);
        var svcVars = (await _serviceVariables.GetByServiceAsync(serviceId)).ToList();
        var folderNames = svc.Folders.ToDictionary(folder => folder.Id, folder => folder.Name);

        var requestExports = new List<RequestExport>();
        foreach (var request in requests)
        {
            requestExports.Add(await BuildRequestExportAsync(request, folderNames));
        }

        return new ServiceExport
        {
            Name = svc.Name,
            Description = svc.Description,
            SortOrder = svc.SortOrder,
            Headers = svc.Headers
                .Select(h => new KeyValuePairRequest { Key = h.Key, Value = h.Value, Enabled = h.Enabled })
                .ToList(),
            Auth = BuildServiceAuth(svc.Auth),
            Folders = svc.Folders
                .OrderBy(folder => folder.SortOrder)
                .Select(folder => new RequestFolderExport { Name = folder.Name, SortOrder = folder.SortOrder })
                .ToList(),
            Variables = svcVars
                .OrderBy(v => v.Key)
                .Select(v => new ServiceVariableExport
                {
                    EnvironmentId = v.EnvironmentId,
                    Key = v.Key,
                    Value = v.Value,
                    IsSecret = v.IsSecret,
                    Enabled = v.Enabled,
                }).ToList(),
            Requests = requestExports,
        };
    }

    /// <summary>Export a single request with all its headers, params, variables, and auth.</summary>
    public async Task<RequestExport> ExportRequestAsync(string requestId)
    {
        var req = await _requests.GetByIdAsync(requestId)
            ?? throw new InvalidOperationException("Request not found");

        var service = await _services.GetByIdAsync(req.ServiceId);
        var folderNames = service?.Folders.ToDictionary(folder => folder.Id, folder => folder.Name)
            ?? new Dictionary<string, string>();
        return await BuildRequestExportAsync(req, folderNames);
    }

    private static AuthRequest? BuildServiceAuth(ServiceAuth? auth)
    {
        if (auth != null && !string.Equals(auth.AuthType, "none", StringComparison.OrdinalIgnoreCase))
            return new AuthRequest { AuthType = auth.AuthType, ConfigJson = auth.ConfigJson };

        return null;
    }

    private async Task<RequestExport> BuildRequestExportAsync(ApiRequest req, IReadOnlyDictionary<string, string>? folderNames = null)
    {
        var settings = await _requests.GetSettingsAsync(req.Id);

        return new RequestExport
        {
            Name = req.Name,
            Method = req.Method,
            Url = req.Url,
            Body = req.Body,
            BodyType = req.BodyType,
            PreRequestScript = req.PreRequestScript ?? "",
            PostRequestScript = req.PostRequestScript ?? "",
            SortOrder = req.SortOrder,
            IsFavorite = req.IsFavorite,
            FolderName = req.FolderId != null && folderNames != null && folderNames.TryGetValue(req.FolderId, out var folderName)
                ? folderName
                : null,
            Headers = req.Headers
                .Select(h => new KeyValuePairRequest { Key = h.Key, Value = h.Value, Enabled = h.Enabled })
                .ToList(),
            Params = req.Params
                .Select(p => new KeyValuePairRequest { Key = p.Key, Value = p.Value, Enabled = p.Enabled })
                .ToList(),
            Variables = req.Variables
                .Select(v => new RequestVariableRequest { Key = v.Key, Value = v.Value, Enabled = v.Enabled })
                .ToList(),
            Auth = BuildRequestAuth(req.Auth),
            Settings = settings,
        };
    }

    private static AuthRequest? BuildRequestAuth(RequestAuth? auth)
    {
        if (auth != null
            && !string.Equals(auth.AuthType, "none", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(auth.AuthType, "inherit", StringComparison.OrdinalIgnoreCase))
            return new AuthRequest { AuthType = auth.AuthType, ConfigJson = auth.ConfigJson };

        return null;
    }

    // ------------------------------------------------------------------
    // SQLite import
    // ------------------------------------------------------------------

    private async Task ImportCoreAsync(string workspaceId, WorkspaceExport data)
    {
        var name = string.IsNullOrWhiteSpace(data.Name) ? "Imported Workspace" : data.Name.Trim();
        var workspaceRow = await _db.Workspaces.FindAsync(workspaceId);
        if (workspaceRow != null)
        {
            workspaceRow.Name = name;
            workspaceRow.UpdatedAt = DateTime.UtcNow.ToString("o");
        }

        var existingEnvs = await _db.Environments
            .Where(e => e.WorkspaceId == workspaceId)
            .ToListAsync();

        var envNameToId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var lastSortOrder = existingEnvs.Count == 0 ? -1 : existingEnvs.Max(e => e.SortOrder);
        foreach (var e in existingEnvs)
        {
            if (!string.IsNullOrEmpty(e.Name))
                envNameToId[e.Name] = e.Id;
        }

        // Only create environments that don't already exist
        var firstCreated = true;
        foreach (var env in data.Environments)
        {
            if (envNameToId.ContainsKey(env.Name))
                continue;

            var envId = Guid.NewGuid().ToString("N");
            envNameToId[env.Name] = envId;

            _db.Environments.Add(new EnvironmentRow
            {
                Id = envId,
                WorkspaceId = workspaceId,
                Name = env.Name,
                IsActive = existingEnvs.Count == 0 && firstCreated,
                SortOrder = ++lastSortOrder,
                CreatedAt = DateTime.UtcNow.ToString("o"),
            });
            firstCreated = false;

            foreach (var v in env.Variables)
            {
                _db.EnvironmentVariables.Add(new EnvironmentVariableRow
                {
                    Id = Guid.NewGuid().ToString("N"),
                    EnvironmentId = envId,
                    Key = v.Key,
                    Value = v.Value,
                    IsSecret = v.IsSecret,
                    Enabled = v.Enabled,
                });
            }

            existingEnvs.Add(new EnvironmentRow { Id = envId, Name = env.Name });
        }

        // Workspace variables
        foreach (var v in data.WorkspaceVariables)
        {
            string? resolvedEnvId = null;
            if (!string.IsNullOrWhiteSpace(v.EnvironmentId))
                resolvedEnvId = ResolveEnvironmentId(v.EnvironmentId, envNameToId);

            _db.WorkspaceVariables.Add(new WorkspaceVariableRow
            {
                Id = Guid.NewGuid().ToString("N"),
                WorkspaceId = workspaceId,
                EnvironmentId = resolvedEnvId,
                Key = v.Key,
                Value = v.Value,
                IsSecret = v.IsSecret,
                Enabled = v.Enabled,
            });
        }

        // Services
        foreach (var svc in data.Services)
        {
            var serviceId = Guid.NewGuid().ToString("N");

            _db.Services.Add(new ServiceRow
            {
                Id = serviceId,
                WorkspaceId = workspaceId,
                Name = svc.Name,
                Description = svc.Description,
                SortOrder = svc.SortOrder,
                CreatedAt = DateTime.UtcNow.ToString("o"),
            });

            await ImportServiceDetailsAsync(serviceId, svc, envNameToId);
        }

        // History
        foreach (var h in data.History.Take(200))
        {
            _db.History.Add(new HistoryRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = h.RequestId,
                WorkspaceId = workspaceId,
                Method = h.Method,
                Url = h.Url,
                RequestHeadersJson = h.RequestHeadersJson,
                RequestBody = h.RequestBody,
                ResponseStatus = h.ResponseStatus,
                ResponseHeadersJson = h.ResponseHeadersJson,
                ResponseBody = h.ResponseBody,
                ResponseTimeMs = h.ResponseTimeMs,
                ResponseSizeBytes = h.ResponseSizeBytes,
                ExecutedAt = string.IsNullOrEmpty(h.ExecutedAt) ? DateTime.UtcNow.ToString("o") : h.ExecutedAt,
            });
        }

        await _db.SaveChangesAsync();
    }

    private async Task ImportServiceDetailsAsync(string serviceId, ServiceExport svc, Dictionary<string, string> envNameToId)
    {
        foreach (var h in svc.Headers.Where(h => !string.IsNullOrWhiteSpace(h.Key)))
        {
            _db.ServiceHeaders.Add(new ServiceHeaderRow
            {
                Id = Guid.NewGuid().ToString("N"),
                ServiceId = serviceId,
                Key = h.Key.Trim(),
                Value = h.Value ?? "",
                Enabled = h.Enabled,
            });
        }

        if (svc.Auth != null && !string.IsNullOrWhiteSpace(svc.Auth.AuthType)
            && !string.Equals(svc.Auth.AuthType, "none", StringComparison.OrdinalIgnoreCase))
        {
            _db.ServiceAuths.Add(new ServiceAuthRow
            {
                Id = Guid.NewGuid().ToString("N"),
                ServiceId = serviceId,
                AuthType = svc.Auth.AuthType,
                ConfigJson = svc.Auth.ConfigJson ?? "{}",
            });
        }

        foreach (var v in svc.Variables)
        {
            string? resolvedEnvId = null;
            if (!string.IsNullOrWhiteSpace(v.EnvironmentId))
                resolvedEnvId = ResolveEnvironmentId(v.EnvironmentId, envNameToId);

            _db.ServiceVariables.Add(new ServiceVariableRow
            {
                Id = Guid.NewGuid().ToString("N"),
                ServiceId = serviceId,
                EnvironmentId = resolvedEnvId,
                Key = v.Key,
                Value = v.Value,
                IsSecret = v.IsSecret,
                Enabled = v.Enabled,
            });
        }

        var folderNameToId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var folder in svc.Folders.OrderBy(folder => folder.SortOrder))
        {
            var folderName = folder.Name?.Trim() ?? "";
            if (string.IsNullOrWhiteSpace(folderName) || folderNameToId.ContainsKey(folderName)) continue;

            var folderId = Guid.NewGuid().ToString("N");
            folderNameToId[folderName] = folderId;
            _db.RequestFolders.Add(new RequestFolderRow
            {
                Id = folderId,
                ServiceId = serviceId,
                Name = folderName,
                SortOrder = folder.SortOrder,
                CreatedAt = DateTime.UtcNow.ToString("o"),
            });
        }

        foreach (var req in svc.Requests)
        {
            var requestId = Guid.NewGuid().ToString("N");
            var folderId = !string.IsNullOrWhiteSpace(req.FolderName) && folderNameToId.TryGetValue(req.FolderName.Trim(), out var resolvedFolderId)
                ? resolvedFolderId
                : null;

            _db.Requests.Add(new ApiRequestRow
            {
                Id = requestId,
                ServiceId = serviceId,
                FolderId = folderId,
                Name = req.Name,
                Method = req.Method,
                Url = req.Url,
                Body = req.Body,
                BodyType = req.BodyType,
                PreRequestScript = req.PreRequestScript,
                PostRequestScript = req.PostRequestScript,
                TestScript = "",
                SortOrder = req.SortOrder,
                IsFavorite = req.IsFavorite,
                CreatedAt = DateTime.UtcNow.ToString("o"),
                UpdatedAt = DateTime.UtcNow.ToString("o"),
            });

            ImportRequestDetailsAsync(requestId, req);
        }
    }

    private void ImportRequestDetailsAsync(string requestId, RequestExport req)
    {
        foreach (var h in req.Headers.Where(h => !string.IsNullOrWhiteSpace(h.Key)))
        {
            _db.RequestHeaders.Add(new RequestHeaderRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = requestId,
                Key = h.Key.Trim(),
                Value = h.Value ?? "",
                Enabled = h.Enabled,
            });
        }

        foreach (var p in req.Params.Where(p => !string.IsNullOrWhiteSpace(p.Key)))
        {
            _db.RequestParams.Add(new RequestParamRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = requestId,
                Key = p.Key.Trim(),
                Value = p.Value ?? "",
                Enabled = p.Enabled,
            });
        }

        foreach (var v in req.Variables)
        {
            _db.RequestVariables.Add(new RequestVariableRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = requestId,
                Key = v.Key,
                Value = v.Value,
                Enabled = v.Enabled,
            });
        }

        if (req.Auth != null && !string.IsNullOrWhiteSpace(req.Auth.AuthType)
            && !string.Equals(req.Auth.AuthType, "none", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(req.Auth.AuthType, "inherit", StringComparison.OrdinalIgnoreCase))
        {
            _db.RequestAuths.Add(new RequestAuthRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = requestId,
                AuthType = req.Auth.AuthType,
                ConfigJson = req.Auth.ConfigJson ?? "{}",
            });
        }

        if (req.Settings != null)
        {
            _db.RequestSettings.Add(new RequestSettingsRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = requestId,
                FollowRedirects = req.Settings.FollowRedirects,
                IgnoreSslErrors = req.Settings.IgnoreSslErrors,
                TimeoutSeconds = req.Settings.TimeoutSeconds,
            });
        }
    }

    /// <summary>
    /// Try to resolve an environment reference from the export.
    /// The environment ID might be an old hex ID; we try to match by name from the import.
    /// </summary>
    private static string? ResolveEnvironmentId(string envId, Dictionary<string, string> envNameToId)
    {
        foreach (var (name, id) in envNameToId)
        {
            if (string.Equals(name, envId, StringComparison.OrdinalIgnoreCase))
                return id;
        }

        return null;
    }

    // ------------------------------------------------------------------
    // JSON import
    // ------------------------------------------------------------------

    private void ImportJson(WorkspaceExport data, string workspaceId)
    {
        _jsonStore.Mutate(doc =>
        {
            var name = string.IsNullOrWhiteSpace(data.Name) ? "Imported Workspace" : data.Name.Trim();
            doc.Workspaces.Add(new Workspace
            {
                Id = workspaceId,
                Name = name,
                CreatedAt = JsonDataStore.Now(),
                UpdatedAt = JsonDataStore.Now(),
            });

            ImportJsonCore(doc, workspaceId, data);
        });
    }

    private void ImportIntoJson(WorkspaceExport data, string workspaceId)
    {
        _jsonStore.Mutate(doc =>
        {
            var workspace = doc.Workspaces.FirstOrDefault(w => w.Id == workspaceId)
                ?? throw new InvalidOperationException("Workspace not found");

            var name = string.IsNullOrWhiteSpace(data.Name) ? "Imported Workspace" : data.Name.Trim();
            workspace.Name = name;
            workspace.UpdatedAt = JsonDataStore.Now();

            ImportJsonCore(doc, workspaceId, data);
        });
    }

    private static void ImportJsonCore(JsonDataDocument doc, string workspaceId, WorkspaceExport data)
    {
        var existingEnvs = doc.Environments
            .Where(e => e.WorkspaceId == workspaceId)
            .ToList();

        var envNameToId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var lastSortOrder = existingEnvs.Count == 0 ? -1 : existingEnvs.Max(e => e.SortOrder);
        foreach (var e in existingEnvs)
        {
            if (!string.IsNullOrEmpty(e.Name))
                envNameToId[e.Name] = e.Id;
        }

        // Only create environments that don't already exist
        foreach (var env in data.Environments)
        {
            if (envNameToId.ContainsKey(env.Name))
                continue;

            var envId = Guid.NewGuid().ToString("N");
            envNameToId[env.Name] = envId;

            doc.Environments.Add(new EnvModel
            {
                Id = envId,
                WorkspaceId = workspaceId,
                Name = env.Name,
                IsActive = existingEnvs.Count == 0 && !doc.Environments.Any(e => e.WorkspaceId == workspaceId) ? true : env.IsActive && existingEnvs.Count == 0,
                SortOrder = ++lastSortOrder,
                CreatedAt = JsonDataStore.Now(),
            });

            foreach (var v in env.Variables)
            {
                doc.EnvironmentVariables.Add(new EnvironmentVariable
                {
                    Id = Guid.NewGuid().ToString("N"),
                    EnvironmentId = envId,
                    Key = v.Key,
                    Value = v.Value,
                    IsSecret = v.IsSecret,
                    Enabled = v.Enabled,
                });
            }

            existingEnvs.Add(doc.Environments[^1]);
        }

        // Workspace variables
        foreach (var v in data.WorkspaceVariables)
        {
            string? resolvedEnvId = null;
            if (!string.IsNullOrWhiteSpace(v.EnvironmentId))
                resolvedEnvId = ResolveEnvironmentId(v.EnvironmentId, envNameToId);

            doc.WorkspaceVariables.Add(new WorkspaceVariable
            {
                Id = Guid.NewGuid().ToString("N"),
                WorkspaceId = workspaceId,
                EnvironmentId = resolvedEnvId,
                Key = v.Key,
                Value = v.Value,
                IsSecret = v.IsSecret,
                Enabled = v.Enabled,
            });
        }

        // Services
        foreach (var svc in data.Services)
        {
            var serviceId = Guid.NewGuid().ToString("N");

            doc.Services.Add(new Service
            {
                Id = serviceId,
                WorkspaceId = workspaceId,
                Name = svc.Name,
                Description = svc.Description,
                SortOrder = svc.SortOrder,
                CreatedAt = JsonDataStore.Now(),
                Headers = svc.Headers
                    .Where(h => !string.IsNullOrWhiteSpace(h.Key))
                    .Select(h => new KeyValuePair
                    {
                        Id = Guid.NewGuid().ToString("N"),
                        Key = h.Key.Trim(),
                        Value = h.Value ?? "",
                        Enabled = h.Enabled,
                    }).ToList(),
            });

            var service = doc.Services[^1];
            var folderNameToId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var folder in svc.Folders.OrderBy(folder => folder.SortOrder))
            {
                var folderName = folder.Name?.Trim() ?? "";
                if (string.IsNullOrWhiteSpace(folderName) || folderNameToId.ContainsKey(folderName)) continue;

                var folderId = Guid.NewGuid().ToString("N");
                folderNameToId[folderName] = folderId;
                doc.RequestFolders.Add(new RequestFolder
                {
                    Id = folderId,
                    ServiceId = serviceId,
                    Name = folderName,
                    SortOrder = folder.SortOrder,
                    CreatedAt = JsonDataStore.Now(),
                });
            }

            if (svc.Auth != null && !string.IsNullOrWhiteSpace(svc.Auth.AuthType)
                && !string.Equals(svc.Auth.AuthType, "none", StringComparison.OrdinalIgnoreCase))
            {
                service.Auth = new ServiceAuth
                {
                    Id = Guid.NewGuid().ToString("N"),
                    ServiceId = serviceId,
                    AuthType = svc.Auth.AuthType,
                    ConfigJson = svc.Auth.ConfigJson ?? "{}",
                };
            }

            foreach (var v in svc.Variables)
            {
                string? resolvedEnvId = null;
                if (!string.IsNullOrWhiteSpace(v.EnvironmentId))
                    resolvedEnvId = ResolveEnvironmentId(v.EnvironmentId, envNameToId);

                doc.ServiceVariables.Add(new ServiceVariable
                {
                    Id = Guid.NewGuid().ToString("N"),
                    ServiceId = serviceId,
                    EnvironmentId = resolvedEnvId,
                    Key = v.Key,
                    Value = v.Value,
                    IsSecret = v.IsSecret,
                    Enabled = v.Enabled,
                });
            }

            foreach (var req in svc.Requests)
            {
                var requestId = Guid.NewGuid().ToString("N");
                var folderId = !string.IsNullOrWhiteSpace(req.FolderName) && folderNameToId.TryGetValue(req.FolderName.Trim(), out var resolvedFolderId)
                    ? resolvedFolderId
                    : null;

                doc.Requests.Add(new ApiRequest
                {
                    Id = requestId,
                    ServiceId = serviceId,
                    FolderId = folderId,
                    Name = req.Name,
                    Method = req.Method,
                    Url = req.Url,
                    Body = req.Body,
                    BodyType = req.BodyType,
                    PreRequestScript = req.PreRequestScript,
                    PostRequestScript = req.PostRequestScript,
                    TestScript = "",
                    SortOrder = req.SortOrder,
                    IsFavorite = req.IsFavorite,
                    CreatedAt = JsonDataStore.Now(),
                    UpdatedAt = JsonDataStore.Now(),
                    Headers = req.Headers
                        .Where(h => !string.IsNullOrWhiteSpace(h.Key))
                        .Select(h => new KeyValuePair
                        {
                            Id = Guid.NewGuid().ToString("N"),
                            Key = h.Key.Trim(),
                            Value = h.Value ?? "",
                            Enabled = h.Enabled,
                        }).ToList(),
                    Params = req.Params
                        .Where(p => !string.IsNullOrWhiteSpace(p.Key))
                        .Select(p => new KeyValuePair
                        {
                            Id = Guid.NewGuid().ToString("N"),
                            Key = p.Key.Trim(),
                            Value = p.Value ?? "",
                            Enabled = p.Enabled,
                        }).ToList(),
                    Variables = req.Variables
                        .Select(v => new RequestVariable
                        {
                            Id = Guid.NewGuid().ToString("N"),
                            RequestId = requestId,
                            Key = v.Key,
                            Value = v.Value,
                            Enabled = v.Enabled,
                        }).ToList(),
                });

                var request = doc.Requests[^1];

                if (req.Auth != null && !string.IsNullOrWhiteSpace(req.Auth.AuthType)
                    && !string.Equals(req.Auth.AuthType, "none", StringComparison.OrdinalIgnoreCase)
                    && !string.Equals(req.Auth.AuthType, "inherit", StringComparison.OrdinalIgnoreCase))
                {
                    request.Auth = new RequestAuth
                    {
                        Id = Guid.NewGuid().ToString("N"),
                        RequestId = requestId,
                        AuthType = req.Auth.AuthType,
                        ConfigJson = req.Auth.ConfigJson ?? "{}",
                    };
                }

                if (req.Settings != null)
                {
                    doc.RequestSettings.Add(new ApiRequestSettings
                    {
                        RequestId = requestId,
                        FollowRedirects = req.Settings.FollowRedirects,
                        IgnoreSslErrors = req.Settings.IgnoreSslErrors,
                        TimeoutSeconds = req.Settings.TimeoutSeconds,
                    });
                }
            }
        }

        // History
        foreach (var h in data.History.Take(200))
        {
            doc.History.Add(new HistoryEntry
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = h.RequestId,
                WorkspaceId = workspaceId,
                Method = h.Method,
                Url = h.Url,
                RequestHeadersJson = h.RequestHeadersJson,
                RequestBody = h.RequestBody,
                ResponseStatus = h.ResponseStatus,
                ResponseHeadersJson = h.ResponseHeadersJson,
                ResponseBody = h.ResponseBody,
                ResponseTimeMs = h.ResponseTimeMs,
                ResponseSizeBytes = h.ResponseSizeBytes,
                ExecutedAt = h.ExecutedAt,
            });
        }
    }
}
