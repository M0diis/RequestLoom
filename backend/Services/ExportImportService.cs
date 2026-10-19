using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
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
    private readonly IMockServerRepository _mocks;
    private readonly CookieJarService _cookies;
    private readonly RequestUploadService _uploads;

    public const int CurrentFormatVersion = 3;

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
        JsonDataStore jsonStore,
        IMockServerRepository mocks,
        CookieJarService cookies,
        RequestUploadService uploads)
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
        _mocks = mocks;
        _cookies = cookies;
        _uploads = uploads;
    }

    /// <summary>List of workspaces for the sidebar.</summary>
    public async Task<WorkspaceExport> ExportWorkspaceAsync(string workspaceId, WorkspaceExportOptions? options = null)
    {
        options ??= new WorkspaceExportOptions();
        var workspace = await _workspaces.GetByIdAsync(workspaceId)
            ?? throw new InvalidOperationException("Workspace not found");

        var environments = (await _environments.GetByWorkspaceAsync(workspaceId)).ToList();

        var envExports = new List<EnvironmentExport>();
        foreach (var env in environments)
        {
            envExports.Add(new EnvironmentExport
            {
                Id = env.Id,
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
        var topLevelRequests = await _requests.GetByWorkspaceIdAsync(workspaceId);

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
                ScriptFiles = _settings.UseJson
                    ? _jsonStore.GetServiceFiles(svc.Id, svc.Name, svc.StoragePath)
                        .Select(file => new ScriptFileExport { Name = file.Name, Content = file.Content ?? "" })
                        .ToList()
                    : [],
            });
        }

        var history = options.IncludeHistory
            ? (await _history.GetByWorkspaceAsync(workspaceId, limit: int.MaxValue)).ToList()
            : [];
        var topLevelExports = await BuildRequestExportsAsync(topLevelRequests);

        var mockServers = new List<MockServerExport>();
        foreach (var mock in await _mocks.GetByWorkspaceAsync(workspaceId, includeEndpoints: true))
        {
            mockServers.Add(new MockServerExport
            {
                Name = mock.Name,
                Description = mock.Description,
                Slug = mock.Slug,
                Port = mock.Port,
                Endpoints = mock.Endpoints.OrderBy(endpoint => endpoint.SortOrder).Select(endpoint => new MockEndpointExport
                {
                    Method = endpoint.Method,
                    Path = endpoint.Path,
                    StatusCode = endpoint.StatusCode,
                    ContentType = endpoint.ContentType,
                    ResponseBody = endpoint.ResponseBody,
                    ResponseHeadersJson = endpoint.ResponseHeadersJson,
                    ScriptEnabled = endpoint.ScriptEnabled,
                    Script = endpoint.Script,
                    Behavior = endpoint.Behavior,
                    BehaviorConfigJson = endpoint.BehaviorConfigJson,
                    DelayMs = endpoint.DelayMs,
                    SortOrder = endpoint.SortOrder,
                }).ToList(),
            });
        }

        var export = new WorkspaceExport
        {
            FormatVersion = CurrentFormatVersion,
            Name = workspace.Name,
            Environments = envExports,
            WorkspaceVariables = workspaceVars,
            Services = serviceExports,
            TopLevelRequests = topLevelExports,
            History = history,
            IncludesSecrets = options.IncludeSecrets,
            IncludesHistory = options.IncludeHistory,
            MockServers = mockServers,
            Cookies = options.IncludeSecrets ? _cookies.Export(workspaceId) : [],
            Files = CollectUploadFiles(serviceExports.SelectMany(service => service.Requests).Concat(topLevelExports)),
        };

        if (!options.IncludeSecrets) RedactSecrets(export);
        return export;
    }

    private List<ArchiveFileExport> CollectUploadFiles(IEnumerable<RequestExport> requests)
    {
        var files = new List<ArchiveFileExport>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var request in requests)
        {
            foreach (var storedPath in FindStoredUploadPaths(request.Body))
            {
                if (!seen.Add(storedPath)) continue;
                try
                {
                    var fullPath = _uploads.ResolvePath(storedPath);
                    if (File.Exists(fullPath))
                        files.Add(new ArchiveFileExport { Path = storedPath, ContentBase64 = Convert.ToBase64String(File.ReadAllBytes(fullPath)) });
                }
                catch (InvalidOperationException)
                {
                    // Path escapes the upload root; never archive it.
                }
            }
        }

        return files;
    }

    private static readonly Regex StoredUploadPattern = new("\"(request-uploads/(?:[^\"\\\\]|\\\\.)*)\"", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static IEnumerable<string> FindStoredUploadPaths(string? body)
    {
        if (string.IsNullOrEmpty(body)) yield break;
        foreach (Match match in StoredUploadPattern.Matches(body))
        {
            string? path;
            try { path = JsonSerializer.Deserialize<string>("\"" + match.Groups[1].Value + "\""); }
            catch (JsonException) { continue; }
            if (RequestUploadService.IsStoredPath(path)) yield return path!;
        }
    }

    private static readonly HashSet<string> SensitiveHeaderNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "api-key", "x-auth-token",
    };

    /// <summary>Blanks credentials, secret variable values, proxy passwords and sensitive history headers.</summary>
    private static void RedactSecrets(WorkspaceExport export)
    {
        foreach (var variable in export.Environments.Concat(export.Services.SelectMany(service => service.Environments)).SelectMany(env => env.Variables).Where(v => v.IsSecret))
            variable.Value = "";
        foreach (var variable in export.WorkspaceVariables.Where(v => v.IsSecret))
            variable.Value = "";

        foreach (var service in export.Services)
        {
            foreach (var variable in service.Variables.Where(v => v.IsSecret)) variable.Value = "";
            if (service.Auth != null) service.Auth.ConfigJson = "{}";
        }

        foreach (var request in export.Services.SelectMany(service => service.Requests).Concat(export.TopLevelRequests))
        {
            if (request.Auth != null) request.Auth.ConfigJson = "{}";
            if (request.Settings != null) request.Settings.ProxyPassword = "";
        }

        foreach (var entry in export.History)
        {
            entry.RequestHeadersJson = RedactHeadersJson(entry.RequestHeadersJson);
            entry.ResponseHeadersJson = RedactHeadersJson(entry.ResponseHeadersJson);
        }
    }

    private static string? RedactHeadersJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return json;
        try
        {
            var node = JsonNode.Parse(json);
            RedactHeaderNode(node);
            return node?.ToJsonString();
        }
        catch (JsonException)
        {
            return json;
        }
    }

    private static void RedactHeaderNode(JsonNode? node)
    {
        if (node is JsonArray array)
        {
            foreach (var item in array) RedactHeaderNode(item);
        }
        else if (node is JsonObject obj)
        {
            string? headerName = null;
            foreach (var property in obj)
            {
                if ((string.Equals(property.Key, "key", StringComparison.OrdinalIgnoreCase) || string.Equals(property.Key, "name", StringComparison.OrdinalIgnoreCase))
                    && property.Value is JsonValue nameValue && nameValue.TryGetValue<string>(out var text))
                    headerName = text;
            }

            if (headerName != null && SensitiveHeaderNames.Contains(headerName))
            {
                foreach (var property in obj.Where(p => string.Equals(p.Key, "value", StringComparison.OrdinalIgnoreCase)).ToList())
                    obj[property.Key] = "";
                return;
            }

            foreach (var property in obj.ToList())
            {
                if (SensitiveHeaderNames.Contains(property.Key) && property.Value is JsonValue) obj[property.Key] = "";
                else RedactHeaderNode(property.Value);
            }
        }
    }

    /// <summary>
    /// Import data into an existing workspace. Merges services, variables, and requests.
    /// </summary>
    public async Task<List<string>> ImportIntoWorkspaceAsync(string workspaceId, WorkspaceExport data)
    {
        ValidateFormat(data);
        var warnings = new List<string>();
        var createdServices = new List<(string Id, ServiceExport Export)>();
        var storedFiles = RestoreUploadedFiles(data, warnings);

        try
        {
            await ImportDataAsync(workspaceId, data, createdServices);
            await ImportExtrasAsync(workspaceId, data, createdServices, warnings);
        }
        catch
        {
            DeleteStoredFiles(storedFiles);
            throw;
        }

        return warnings;
    }

    private async Task ImportDataAsync(string workspaceId, WorkspaceExport data, List<(string Id, ServiceExport Export)> createdServices)
    {
        if (_settings.UseJson)
        {
            ImportIntoJson(data, workspaceId, createdServices);
            return;
        }

        if (!await _db.Workspaces.AnyAsync(w => w.Id == workspaceId))
        {
            throw new InvalidOperationException("Workspace not found");
        }

        await using var tx = await _db.Database.BeginTransactionAsync();

        try
        {
            await ImportCoreAsync(workspaceId, data, createdServices);
            await tx.CommitAsync();
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }

    public async Task<WorkspaceImportResult> ImportWorkspaceAsync(WorkspaceExport data)
    {
        ValidateFormat(data);
        var warnings = new List<string>();
        var createdServices = new List<(string Id, ServiceExport Export)>();
        var storedFiles = RestoreUploadedFiles(data, warnings);

        try
        {
            var workspace = await ImportNewWorkspaceAsync(data, createdServices);
            await ImportExtrasAsync(workspace.Id, data, createdServices, warnings);
            return new WorkspaceImportResult
            {
                Id = workspace.Id, Name = workspace.Name, CreatedAt = workspace.CreatedAt, UpdatedAt = workspace.UpdatedAt,
                Warnings = warnings,
            };
        }
        catch
        {
            DeleteStoredFiles(storedFiles);
            throw;
        }
    }

    private async Task<Workspace> ImportNewWorkspaceAsync(WorkspaceExport data, List<(string Id, ServiceExport Export)> createdServices)
    {
        var workspaceId = Guid.NewGuid().ToString("N");
        var name = string.IsNullOrWhiteSpace(data.Name) ? "Imported Workspace" : data.Name.Trim();

        if (_settings.UseJson)
        {
            ImportJson(data, workspaceId, createdServices);
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

            await ImportCoreAsync(workspaceId, data, createdServices);

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

        var environments = (await _environments.GetByWorkspaceAsync(svc.WorkspaceId)).ToList();
        return new ServiceExport
        {
            Environments = environments.Select(env => new EnvironmentExport
            {
                Id = env.Id, Name = env.Name, IsActive = env.IsActive, SortOrder = env.SortOrder,
            }).ToList(),
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

        var service = req.ServiceId == null ? null : await _services.GetByIdAsync(req.ServiceId);
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
            Id = req.Id,
            Name = req.Name,
            Method = req.Method,
            Url = req.Url,
            Body = req.Body,
            BodyType = req.BodyType,
            PreRequestScript = req.PreRequestScript ?? "",
            PostRequestScript = req.PostRequestScript ?? "",
            TestScript = req.TestScript ?? "",
            Notes = req.Notes ?? "",
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

    private async Task<List<RequestExport>> BuildRequestExportsAsync(IEnumerable<ApiRequest> requests)
    {
        var exports = new List<RequestExport>();
        foreach (var request in requests)
        {
            exports.Add(await BuildRequestExportAsync(request));
        }

        return exports;
    }

    private static AuthRequest? BuildRequestAuth(RequestAuth? auth)
    {
        if (auth != null
            && !string.Equals(auth.AuthType, "inherit", StringComparison.OrdinalIgnoreCase))
            return new AuthRequest { AuthType = auth.AuthType, ConfigJson = auth.ConfigJson };

        return null;
    }

    // ------------------------------------------------------------------
    // Archive extras: uploads, script files, mock servers, cookies
    // ------------------------------------------------------------------

    private static void ValidateFormat(WorkspaceExport data)
    {
        if (data.FormatVersion > CurrentFormatVersion)
            throw new ArgumentException($"This archive uses format version {data.FormatVersion}, which is newer than this version of RequestLoom supports ({CurrentFormatVersion}). Update RequestLoom and try again.");
    }

    /// <summary>Writes archived uploads to disk and rewrites request bodies to the new stored paths.</summary>
    private List<string> RestoreUploadedFiles(WorkspaceExport data, List<string> warnings)
    {
        var stored = new List<string>();
        var pathMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var file in data.Files)
            {
                if (!RequestUploadService.IsStoredPath(file.Path))
                {
                    warnings.Add($"Skipped an archived file with an invalid path: {file.Path}");
                    continue;
                }

                try
                {
                    var newPath = _uploads.StoreArchived(file.Path, Convert.FromBase64String(file.ContentBase64));
                    stored.Add(newPath);
                    pathMap[file.Path] = newPath;
                }
                catch (Exception ex) when (ex is FormatException or InvalidOperationException or IOException)
                {
                    warnings.Add($"Skipped archived file '{file.Path}': {ex.Message}");
                }
            }
        }
        catch
        {
            DeleteStoredFiles(stored);
            throw;
        }

        if (pathMap.Count == 0) return stored;

        foreach (var request in data.Services.SelectMany(service => service.Requests).Concat(data.TopLevelRequests))
        {
            foreach (var (oldPath, newPath) in pathMap)
            {
                var oldToken = JsonSerializer.Serialize(oldPath);
                if (request.Body.Contains(oldToken, StringComparison.Ordinal))
                    request.Body = request.Body.Replace(oldToken, JsonSerializer.Serialize(newPath), StringComparison.Ordinal);
            }
        }

        return stored;
    }

    private void DeleteStoredFiles(IEnumerable<string> storedPaths)
    {
        foreach (var storedPath in storedPaths)
        {
            try { File.Delete(_uploads.ResolvePath(storedPath)); }
            catch (Exception ex) when (ex is IOException or InvalidOperationException or UnauthorizedAccessException)
            {
                // Best-effort cleanup of files from a failed import.
            }
        }
    }

    private async Task ImportExtrasAsync(string workspaceId, WorkspaceExport data, List<(string Id, ServiceExport Export)> createdServices, List<string> warnings)
    {
        foreach (var (serviceId, export) in createdServices.Where(item => item.Export.ScriptFiles.Count > 0))
        {
            if (!_settings.UseJson)
            {
                warnings.Add($"Collection '{export.Name}' has JavaScript files, which are only supported with JSON storage. They were not imported.");
                continue;
            }

            var service = _jsonStore.Read(doc => doc.Services.FirstOrDefault(item => item.Id == serviceId));
            if (service == null) continue;
            foreach (var script in export.ScriptFiles.Where(script => !string.IsNullOrWhiteSpace(script.Name)))
            {
                try
                {
                    var file = _jsonStore.CreateServiceFile(service.Id, service.Name, service.StoragePath, script.Name, "js");
                    _jsonStore.SaveServiceFile(service.Id, service.Name, service.StoragePath, file.Name, script.Content);
                }
                catch (Exception ex) when (ex is IOException or ArgumentException or UnauthorizedAccessException)
                {
                    warnings.Add($"Could not import script '{script.Name}' for collection '{export.Name}': {ex.Message}");
                }
            }
        }

        foreach (var mock in data.MockServers)
        {
            var baseSlug = string.IsNullOrWhiteSpace(mock.Slug) ? "mock" : mock.Slug.Trim().ToLowerInvariant();
            var slug = baseSlug;
            for (var attempt = 2; await _mocks.GetBySlugAsync(slug) != null; attempt++)
                slug = $"{baseSlug}-{attempt}";
            if (slug != baseSlug) warnings.Add($"Mock server '{mock.Name}' already used the slug '{baseSlug}'; imported as '{slug}'.");

            var created = await _mocks.CreateAsync(workspaceId, string.IsNullOrWhiteSpace(mock.Name) ? slug : mock.Name.Trim(), mock.Description, slug, mock.Port);
            foreach (var endpoint in mock.Endpoints.OrderBy(endpoint => endpoint.SortOrder))
            {
                await _mocks.CreateEndpointAsync(created.Id, new CreateMockEndpointRequest
                {
                    Method = endpoint.Method,
                    Path = endpoint.Path,
                    StatusCode = endpoint.StatusCode,
                    ContentType = endpoint.ContentType,
                    ResponseBody = endpoint.ResponseBody,
                    ResponseHeaders = ParseHeaders(endpoint.ResponseHeadersJson),
                    ScriptEnabled = endpoint.ScriptEnabled,
                    Script = endpoint.Script,
                    Behavior = endpoint.Behavior,
                    BehaviorConfigJson = endpoint.BehaviorConfigJson,
                    DelayMs = endpoint.DelayMs,
                });
            }
        }

        if (data.Cookies.Count > 0) _cookies.Import(workspaceId, data.Cookies);
        if (!data.IncludesSecrets)
            warnings.Add("This archive was exported without secrets. Secret variable values, authentication settings, proxy passwords and cookies must be entered again.");
    }

    private static List<KeyValuePairRequest> ParseHeaders(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<KeyValuePairRequest>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    // ------------------------------------------------------------------
    // SQLite import
    // ------------------------------------------------------------------

    private async Task ImportCoreAsync(string workspaceId, WorkspaceExport data, List<(string Id, ServiceExport Export)> createdServices)
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

        var requestIdMap = new Dictionary<string, string>(StringComparer.Ordinal);
        var envNameToId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var lastSortOrder = existingEnvs.Count == 0 ? -1 : existingEnvs.Max(e => e.SortOrder);
        foreach (var e in existingEnvs)
        {
            if (!string.IsNullOrEmpty(e.Name))
                envNameToId[e.Name] = e.Id;
            envNameToId[e.Id] = e.Id;
        }

        var hasExistingEnvironments = existingEnvs.Count > 0;
        // Only create environments that don't already exist
        var importedActiveName = data.Environments.FirstOrDefault(env => env.IsActive)?.Name
            ?? data.Environments.Concat(data.Services.SelectMany(service => service.Environments)).FirstOrDefault()?.Name;
        foreach (var env in data.Environments.Concat(data.Services.SelectMany(service => service.Environments)))
        {
            if (envNameToId.TryGetValue(env.Name, out var existingEnvironmentId))
            {
                if (!string.IsNullOrWhiteSpace(env.Id)) envNameToId[env.Id] = existingEnvironmentId;
                continue;
            }

            var envId = Guid.NewGuid().ToString("N");
            envNameToId[env.Name] = envId;
            if (!string.IsNullOrWhiteSpace(env.Id)) envNameToId[env.Id] = envId;

            _db.Environments.Add(new EnvironmentRow
            {
                Id = envId,
                WorkspaceId = workspaceId,
                Name = env.Name,
                IsActive = !hasExistingEnvironments && env.Name == importedActiveName,
                SortOrder = ++lastSortOrder,
                CreatedAt = DateTime.UtcNow.ToString("o"),
            });

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

            createdServices.Add((serviceId, svc));
            await ImportServiceDetailsAsync(workspaceId, serviceId, svc, envNameToId, requestIdMap);
        }

        foreach (var req in data.TopLevelRequests)
        {
            var requestId = Guid.NewGuid().ToString("N");
            if (!string.IsNullOrWhiteSpace(req.Id) && !requestIdMap.TryAdd(req.Id, requestId))
                throw new ArgumentException($"Duplicate exported request ID: {req.Id}");
            _db.Requests.Add(new ApiRequestRow
            {
                Id = requestId,
                WorkspaceId = workspaceId,
                ServiceId = null,
                FolderId = null,
                Name = req.Name,
                Method = req.Method,
                Url = req.Url,
                Body = req.Body,
                BodyType = req.BodyType,
                PreRequestScript = req.PreRequestScript,
                PostRequestScript = req.PostRequestScript,
                Notes = req.Notes,
                TestScript = req.TestScript,
                SortOrder = req.SortOrder,
                IsFavorite = req.IsFavorite,
                CreatedAt = DateTime.UtcNow.ToString("o"),
                UpdatedAt = DateTime.UtcNow.ToString("o"),
            });
            ImportRequestDetailsAsync(requestId, req);
        }

        // History
        foreach (var h in data.History)
        {
            _db.History.Add(new HistoryRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = h.RequestId != null && requestIdMap.TryGetValue(h.RequestId, out var mappedRequestId) ? mappedRequestId : null,
                WorkspaceId = workspaceId,
                Method = h.Method,
                Url = h.Url,
                RequestHeadersJson = h.RequestHeadersJson,
                RequestBody = h.RequestBody,
                ResponseStatus = h.ResponseStatus,
                StatusText = h.StatusText,
                ResponseHeadersJson = h.ResponseHeadersJson,
                ResponseBody = h.ResponseBody,
                ContentType = h.ContentType,
                ResponseTimeMs = h.ResponseTimeMs,
                ResponseSizeBytes = h.ResponseSizeBytes,
                IsTruncated = h.IsTruncated,
                Error = h.Error,
                IsSoapFault = h.IsSoapFault,
                SoapFaultJson = JsonSerializer.Serialize(h.SoapFault),
                ScriptVariablesJson = JsonSerializer.Serialize(h.ScriptVariables),
                ServiceScriptVariablesJson = JsonSerializer.Serialize(h.ServiceScriptVariables),
                ScriptLogsJson = JsonSerializer.Serialize(h.ScriptLogs),
                TestResultsJson = JsonSerializer.Serialize(h.TestResults),
                ExecutedAt = string.IsNullOrEmpty(h.ExecutedAt) ? DateTime.UtcNow.ToString("o") : h.ExecutedAt,
            });
        }

        await _db.SaveChangesAsync();
    }

    private async Task ImportServiceDetailsAsync(string workspaceId, string serviceId, ServiceExport svc, Dictionary<string, string> envNameToId, Dictionary<string, string> requestIdMap)
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
            if (!string.IsNullOrWhiteSpace(req.Id) && !requestIdMap.TryAdd(req.Id, requestId))
                throw new ArgumentException($"Duplicate exported request ID: {req.Id}");
            var folderId = !string.IsNullOrWhiteSpace(req.FolderName) && folderNameToId.TryGetValue(req.FolderName.Trim(), out var resolvedFolderId)
                ? resolvedFolderId
                : null;

            _db.Requests.Add(new ApiRequestRow
            {
                Id = requestId,
                WorkspaceId = workspaceId,
                ServiceId = serviceId,
                FolderId = folderId,
                Name = req.Name,
                Method = req.Method,
                Url = req.Url,
                Body = req.Body,
                BodyType = req.BodyType,
                PreRequestScript = req.PreRequestScript,
                PostRequestScript = req.PostRequestScript,
                Notes = req.Notes,
                TestScript = req.TestScript,
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
                MaxRedirects = req.Settings.MaxRedirects,
                ProxyMode = req.Settings.ProxyMode,
                ProxyUrl = req.Settings.ProxyUrl,
                ProxyUsername = req.Settings.ProxyUsername,
                ProxyPassword = req.Settings.ProxyPassword,
                IgnoreSslErrors = req.Settings.IgnoreSslErrors,
                TimeoutSeconds = req.Settings.TimeoutSeconds,
            });
        }
    }

    private static string ResolveEnvironmentId(string reference, Dictionary<string, string> environmentIds)
    {
        if (environmentIds.TryGetValue(reference, out var id)) return id;
        throw new ArgumentException($"Cannot resolve environment reference '{reference}'. Import its environment metadata or re-export it with this version of RequestLoom. Its scope was not changed to ALL.");
    }

    // ------------------------------------------------------------------
    // JSON import
    // ------------------------------------------------------------------

    private void ImportJson(WorkspaceExport data, string workspaceId, List<(string Id, ServiceExport Export)> createdServices)
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

            ImportJsonCore(doc, workspaceId, data, createdServices);
        });
    }

    private void ImportIntoJson(WorkspaceExport data, string workspaceId, List<(string Id, ServiceExport Export)> createdServices)
    {
        _jsonStore.Mutate(doc =>
        {
            var workspace = doc.Workspaces.FirstOrDefault(w => w.Id == workspaceId)
                ?? throw new InvalidOperationException("Workspace not found");

            var name = string.IsNullOrWhiteSpace(data.Name) ? "Imported Workspace" : data.Name.Trim();
            workspace.Name = name;
            workspace.UpdatedAt = JsonDataStore.Now();

            ImportJsonCore(doc, workspaceId, data, createdServices);
        });
    }

    private static void ImportJsonCore(JsonDataDocument doc, string workspaceId, WorkspaceExport data, List<(string Id, ServiceExport Export)> createdServices)
    {
        var importedActiveName = data.Environments.FirstOrDefault(env => env.IsActive)?.Name
            ?? data.Environments.Concat(data.Services.SelectMany(service => service.Environments)).FirstOrDefault()?.Name;
        var existingEnvs = doc.Environments
            .Where(e => e.WorkspaceId == workspaceId)
            .ToList();

        var requestIdMap = new Dictionary<string, string>(StringComparer.Ordinal);
        var envNameToId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var lastSortOrder = existingEnvs.Count == 0 ? -1 : existingEnvs.Max(e => e.SortOrder);
        foreach (var e in existingEnvs)
        {
            if (!string.IsNullOrEmpty(e.Name))
                envNameToId[e.Name] = e.Id;
            envNameToId[e.Id] = e.Id;
        }

        var hasExistingEnvironments = existingEnvs.Count > 0;
        // Only create environments that don't already exist
        foreach (var env in data.Environments.Concat(data.Services.SelectMany(service => service.Environments)))
        {
            if (envNameToId.TryGetValue(env.Name, out var existingEnvironmentId))
            {
                if (!string.IsNullOrWhiteSpace(env.Id)) envNameToId[env.Id] = existingEnvironmentId;
                continue;
            }

            var envId = Guid.NewGuid().ToString("N");
            envNameToId[env.Name] = envId;
            if (!string.IsNullOrWhiteSpace(env.Id)) envNameToId[env.Id] = envId;

            doc.Environments.Add(new EnvModel
            {
                Id = envId,
                WorkspaceId = workspaceId,
                Name = env.Name,
                IsActive = !hasExistingEnvironments && env.Name == importedActiveName,
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
            createdServices.Add((serviceId, svc));

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
                if (!string.IsNullOrWhiteSpace(req.Id) && !requestIdMap.TryAdd(req.Id, requestId))
                    throw new ArgumentException($"Duplicate exported request ID: {req.Id}");
                var folderId = !string.IsNullOrWhiteSpace(req.FolderName) && folderNameToId.TryGetValue(req.FolderName.Trim(), out var resolvedFolderId)
                    ? resolvedFolderId
                    : null;

                doc.Requests.Add(new ApiRequest
                {
                    Id = requestId,
                    WorkspaceId = workspaceId,
                    ServiceId = serviceId,
                    FolderId = folderId,
                    Name = req.Name,
                    Method = req.Method,
                    Url = req.Url,
                    Body = req.Body,
                    BodyType = req.BodyType,
                    PreRequestScript = req.PreRequestScript,
                    PostRequestScript = req.PostRequestScript,
                    Notes = req.Notes,
                    TestScript = req.TestScript,
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
                        MaxRedirects = req.Settings.MaxRedirects,
                        ProxyMode = req.Settings.ProxyMode,
                        ProxyUrl = req.Settings.ProxyUrl,
                        ProxyUsername = req.Settings.ProxyUsername,
                        ProxyPassword = req.Settings.ProxyPassword,
                        IgnoreSslErrors = req.Settings.IgnoreSslErrors,
                        TimeoutSeconds = req.Settings.TimeoutSeconds,
                    });
                }
            }
        }

        foreach (var req in data.TopLevelRequests)
        {
            var requestId = Guid.NewGuid().ToString("N");
            if (!string.IsNullOrWhiteSpace(req.Id) && !requestIdMap.TryAdd(req.Id, requestId))
                throw new ArgumentException($"Duplicate exported request ID: {req.Id}");
            var request = new ApiRequest
            {
                Id = requestId,
                WorkspaceId = workspaceId,
                ServiceId = null,
                FolderId = null,
                Name = req.Name,
                Method = req.Method,
                Url = req.Url,
                Body = req.Body,
                BodyType = req.BodyType,
                PreRequestScript = req.PreRequestScript,
                PostRequestScript = req.PostRequestScript,
                Notes = req.Notes,
                TestScript = req.TestScript,
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
                Variables = req.Variables.Select(v => new RequestVariable
                {
                    Id = Guid.NewGuid().ToString("N"),
                    RequestId = requestId,
                    Key = v.Key,
                    Value = v.Value,
                    Enabled = v.Enabled,
                }).ToList(),
            };

            if (req.Auth != null && !string.IsNullOrWhiteSpace(req.Auth.AuthType)
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

            doc.Requests.Add(request);
            if (req.Settings != null)
            {
                doc.RequestSettings.Add(new ApiRequestSettings
                {
                    RequestId = requestId,
                    FollowRedirects = req.Settings.FollowRedirects,
                    MaxRedirects = req.Settings.MaxRedirects,
                    ProxyMode = req.Settings.ProxyMode,
                    ProxyUrl = req.Settings.ProxyUrl,
                    ProxyUsername = req.Settings.ProxyUsername,
                    ProxyPassword = req.Settings.ProxyPassword,
                    IgnoreSslErrors = req.Settings.IgnoreSslErrors,
                    TimeoutSeconds = req.Settings.TimeoutSeconds,
                });
            }
        }

        // History
        foreach (var h in data.History)
        {
            doc.History.Add(new HistoryEntry
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = h.RequestId != null && requestIdMap.TryGetValue(h.RequestId, out var mappedRequestId) ? mappedRequestId : null,
                WorkspaceId = workspaceId,
                Method = h.Method,
                Url = h.Url,
                RequestHeadersJson = h.RequestHeadersJson,
                RequestBody = h.RequestBody,
                ResponseStatus = h.ResponseStatus,
                StatusText = h.StatusText,
                ResponseHeadersJson = h.ResponseHeadersJson,
                ResponseBody = h.ResponseBody,
                ContentType = h.ContentType,
                ResponseTimeMs = h.ResponseTimeMs,
                ResponseSizeBytes = h.ResponseSizeBytes,
                IsTruncated = h.IsTruncated,
                Error = h.Error,
                IsSoapFault = h.IsSoapFault,
                SoapFault = h.SoapFault,
                ScriptVariables = h.ScriptVariables,
                ServiceScriptVariables = h.ServiceScriptVariables,
                ScriptLogs = h.ScriptLogs,
                TestResults = h.TestResults,
                ExecutedAt = h.ExecutedAt,
            });
        }
    }
}
