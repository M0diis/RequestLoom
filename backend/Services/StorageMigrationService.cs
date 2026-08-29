using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data;
using RequestLoom.Api.Data.Entities;
using RequestLoom.Api.Models;
using ModelEnvironment = RequestLoom.Api.Models.Environment;
using ModelKeyValuePair = RequestLoom.Api.Models.KeyValuePair;

namespace RequestLoom.Api.Services;

public sealed class StorageMigrationService
{
    private static readonly SemaphoreSlim MigrationGate = new(1, 1);

    private readonly SettingsService _settings;
    private readonly AppDbContext _activeDb;
    private readonly JsonDataStore _jsonStore;
    private readonly CookieJarService _cookieJar;
    private readonly RequestUploadService _uploadService;
    private readonly ILogger<StorageMigrationService> _logger;

    public StorageMigrationService(
        SettingsService settings,
        AppDbContext activeDb,
        JsonDataStore jsonStore,
        CookieJarService cookieJar,
        RequestUploadService uploadService,
        ILogger<StorageMigrationService> logger)
    {
        _settings = settings;
        _activeDb = activeDb;
        _jsonStore = jsonStore;
        _cookieJar = cookieJar;
        _uploadService = uploadService;
        _logger = logger;
    }

    public async Task<StorageMigrationResult> MigrateAsync(string targetMode, string targetStrategy)
    {
        var normalizedMode = NormalizeMode(targetMode);
        var normalizedStrategy = NormalizeStrategy(targetStrategy);
        var sourceMode = _settings.Mode;
        var sourceStrategy = _settings.JsonStorageStrategy;

        if (string.Equals(sourceMode, normalizedMode, StringComparison.OrdinalIgnoreCase) &&
            (normalizedMode != SettingsService.JsonMode ||
             string.Equals(sourceStrategy, normalizedStrategy, StringComparison.OrdinalIgnoreCase)))
        {
            return new StorageMigrationResult(sourceMode, normalizedMode, 0, 0, null, false);
        }

        await MigrationGate.WaitAsync();
        try
        {
            var source = sourceMode == SettingsService.JsonMode
                ? _jsonStore.Snapshot()
                : await ReadSqliteDocumentAsync(_activeDb);

            var targetHasData = await TargetHasDataAsync(normalizedMode);
            if (!HasUserData(source) && targetHasData)
            {
                // This also makes recovery from an earlier failed switch safe: an
                // empty source must not erase a populated target store.
                _logger.LogWarning(
                    "Skipping empty {SourceMode} to {TargetMode} migration because the target already contains data.",
                    sourceMode,
                    normalizedMode);
                return new StorageMigrationResult(sourceMode, normalizedMode, 0, 0, null, true);
            }

            var backupPath = BackupTarget(normalizedMode);
            if (normalizedMode == SettingsService.JsonMode)
            {
                foreach (var service in source.Services)
                    service.StoragePath = "";

                _jsonStore.WriteMigratedDocument(source, _settings.JsonDataPath, normalizedStrategy);
            }
            else
            {
                RemoveSqliteTargetAfterBackup(_settings.DatabasePath);
                await WriteSqliteDocumentAsync(source, _settings.DatabasePath);
            }

            MigrateAuxiliaryStorage(sourceMode, normalizedMode, backupPath);

            var requestCount = source.Requests.Count;
            var serviceCount = source.Services.Count;
            _logger.LogInformation(
                "Migrated {Services} services and {Requests} requests from {SourceMode} to {TargetMode}. Backup: {BackupPath}",
                serviceCount,
                requestCount,
                sourceMode,
                normalizedMode,
                backupPath ?? "none");
            return new StorageMigrationResult(sourceMode, normalizedMode, serviceCount, requestCount, backupPath, false);
        }
        finally
        {
            MigrationGate.Release();
        }
    }

    private async Task<bool> TargetHasDataAsync(string targetMode)
    {
        if (targetMode == SettingsService.JsonMode)
        {
            if (!File.Exists(_settings.JsonDataPath)) return false;

            try
            {
                var document = System.Text.Json.JsonSerializer.Deserialize<JsonDataDocument>(
                    await File.ReadAllTextAsync(_settings.JsonDataPath));
                return document != null && HasUserData(document);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not inspect the existing JSON migration target {Path}.", _settings.JsonDataPath);
                return true;
            }
        }

        if (!File.Exists(_settings.DatabasePath)) return false;

        try
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseSqlite(new SqliteConnectionStringBuilder { DataSource = _settings.DatabasePath }.ToString())
                .Options;
            await using var targetDb = new AppDbContext(options);
            return await targetDb.Services.AsNoTracking().AnyAsync() ||
                   await targetDb.Requests.AsNoTracking().AnyAsync() ||
                   await targetDb.Workspaces.AsNoTracking().AnyAsync(workspace => workspace.Id != "default");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not inspect the existing SQLite migration target {Path}.", _settings.DatabasePath);
            return true;
        }
    }

    private string? BackupTarget(string targetMode)
    {
        var targetPath = targetMode == SettingsService.JsonMode
            ? _settings.JsonDataPath
            : _settings.DatabasePath;
        var collectionsPath = targetMode == SettingsService.JsonMode
            ? Path.Combine(
                Path.GetDirectoryName(targetPath) ?? Directory.GetCurrentDirectory(),
                $"{Path.GetFileNameWithoutExtension(targetPath)}-collections")
            : null;
        var targetDirectory = Path.GetDirectoryName(targetPath) ?? Directory.GetCurrentDirectory();
        var requestloomCollectionsPath = Path.Combine(targetDirectory, "requestloom-collections");
        var cookiePath = Path.Combine(targetDirectory, "requestloom-cookie-jar.json");
        var uploadsPath = Path.Combine(targetDirectory, "request-uploads");

        if (!File.Exists(targetPath) &&
            (collectionsPath == null || !Directory.Exists(collectionsPath)) &&
            !Directory.Exists(requestloomCollectionsPath) &&
            !File.Exists(cookiePath) &&
            !Directory.Exists(uploadsPath))
            return null;

        var backupRoot = Path.Combine(
            Path.GetDirectoryName(targetPath) ?? Directory.GetCurrentDirectory(),
            ".requestloom-backups",
            $"{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(backupRoot);

        if (File.Exists(targetPath))
            File.Copy(targetPath, Path.Combine(backupRoot, Path.GetFileName(targetPath)), overwrite: false);

        foreach (var sidecar in new[] { $"{targetPath}-wal", $"{targetPath}-shm" })
        {
            if (File.Exists(sidecar))
                File.Copy(sidecar, Path.Combine(backupRoot, Path.GetFileName(sidecar)), overwrite: false);
        }

        if (collectionsPath != null && Directory.Exists(collectionsPath))
            CopyDirectory(collectionsPath, Path.Combine(backupRoot, Path.GetFileName(collectionsPath)));
        if (Directory.Exists(requestloomCollectionsPath))
            CopyDirectory(requestloomCollectionsPath, Path.Combine(backupRoot, Path.GetFileName(requestloomCollectionsPath)));
        if (File.Exists(cookiePath))
            File.Copy(cookiePath, Path.Combine(backupRoot, Path.GetFileName(cookiePath)), overwrite: false);
        if (Directory.Exists(uploadsPath))
            CopyDirectory(uploadsPath, Path.Combine(backupRoot, Path.GetFileName(uploadsPath)));

        return backupRoot;
    }

    private void MigrateAuxiliaryStorage(string sourceMode, string targetMode, string? backupPath)
    {
        var sourceRoot = Path.GetDirectoryName(
            sourceMode == SettingsService.JsonMode ? _settings.JsonDataPath : _settings.DatabasePath)
            ?? Directory.GetCurrentDirectory();
        var targetRoot = Path.GetDirectoryName(
            targetMode == SettingsService.JsonMode ? _settings.JsonDataPath : _settings.DatabasePath)
            ?? Directory.GetCurrentDirectory();
        if (string.Equals(Path.GetFullPath(sourceRoot), Path.GetFullPath(targetRoot), StringComparison.OrdinalIgnoreCase))
            return;

        var targetCookiePath = Path.Combine(targetRoot, "requestloom-cookie-jar.json");
        if (File.Exists(targetCookiePath)) File.Delete(targetCookiePath);
        if (File.Exists(_cookieJar.FilePath))
            File.Copy(_cookieJar.FilePath, targetCookiePath, overwrite: true);

        var targetUploadsPath = Path.Combine(targetRoot, "request-uploads");
        if (Directory.Exists(targetUploadsPath)) Directory.Delete(targetUploadsPath, recursive: true);
        if (Directory.Exists(_uploadService.RootDirectory))
            CopyDirectory(_uploadService.RootDirectory, targetUploadsPath);

        _logger.LogInformation(
            "Migrated auxiliary storage from {SourceRoot} to {TargetRoot}; backup: {BackupPath}",
            sourceRoot,
            targetRoot,
            backupPath ?? "none");
    }

    private static void RemoveSqliteTargetAfterBackup(string targetPath)
    {
        foreach (var path in new[] { targetPath, $"{targetPath}-wal", $"{targetPath}-shm" })
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    private async Task WriteSqliteDocumentAsync(JsonDataDocument document, string targetPath)
    {
        var directory = Path.GetDirectoryName(targetPath);
        if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(new SqliteConnectionStringBuilder { DataSource = targetPath }.ToString())
            .Options;
        await using var db = new AppDbContext(options);
        await db.Database.MigrateAsync();

        await using var transaction = await db.Database.BeginTransactionAsync();

        db.Workspaces.AddRange(document.Workspaces.Select(workspace => new WorkspaceRow
        {
            Id = EnsureId(workspace.Id),
            Name = workspace.Name,
            CreatedAt = workspace.CreatedAt,
            UpdatedAt = workspace.UpdatedAt,
        }));
        db.Environments.AddRange(document.Environments.Select(environment => new EnvironmentRow
        {
            Id = EnsureId(environment.Id),
            WorkspaceId = environment.WorkspaceId,
            Name = environment.Name,
            IsActive = environment.IsActive,
            SortOrder = environment.SortOrder,
            CreatedAt = environment.CreatedAt,
        }));
        db.EnvironmentVariables.AddRange(document.Environments
            .SelectMany(environment => environment.Variables)
            .Concat(document.EnvironmentVariables)
            .GroupBy(variable => variable.Id)
            .Select(group => group.First())
            .Select(variable => new EnvironmentVariableRow
            {
                Id = EnsureId(variable.Id),
                EnvironmentId = variable.EnvironmentId,
                Key = variable.Key,
                Value = variable.Value,
                IsSecret = variable.IsSecret,
                Enabled = variable.Enabled,
            }));
        db.Services.AddRange(document.Services.Select(service => new ServiceRow
        {
            Id = EnsureId(service.Id),
            WorkspaceId = service.WorkspaceId,
            Name = service.Name,
            Description = service.Description,
            SortOrder = service.SortOrder,
            CreatedAt = service.CreatedAt,
        }));
        db.RequestFolders.AddRange(document.RequestFolders.Select(folder => new RequestFolderRow
        {
            Id = EnsureId(folder.Id),
            ServiceId = folder.ServiceId,
            Name = folder.Name,
            SortOrder = folder.SortOrder,
            CreatedAt = folder.CreatedAt,
        }));

        var requests = document.Requests
            .GroupBy(request => request.Id)
            .Select(group => group.First())
            .ToList();
        db.Requests.AddRange(requests.Select(request => new ApiRequestRow
        {
            Id = EnsureId(request.Id),
            ServiceId = request.ServiceId,
            FolderId = request.FolderId,
            Name = request.Name,
            Method = request.Method,
            Url = request.Url,
            Body = request.Body,
            BodyType = request.BodyType,
            PreRequestScript = request.PreRequestScript,
            PostRequestScript = request.PostRequestScript,
            TestScript = request.TestScript,
            SortOrder = request.SortOrder,
            IsFavorite = request.IsFavorite,
            CreatedAt = request.CreatedAt,
            UpdatedAt = request.UpdatedAt,
        }));
        db.RequestHeaders.AddRange(requests.SelectMany(request => request.Headers.Select(header => new RequestHeaderRow
        {
            Id = EnsureId(header.Id), RequestId = request.Id, Key = header.Key, Value = header.Value, Enabled = header.Enabled,
        })));
        db.RequestParams.AddRange(requests.SelectMany(request => request.Params.Select(parameter => new RequestParamRow
        {
            Id = EnsureId(parameter.Id), RequestId = request.Id, Key = parameter.Key, Value = parameter.Value, Enabled = parameter.Enabled,
        })));
        db.RequestVariables.AddRange(requests.SelectMany(request => request.Variables.Select(variable => new RequestVariableRow
        {
            Id = EnsureId(variable.Id), RequestId = request.Id, Key = variable.Key, Value = variable.Value, Enabled = variable.Enabled,
        })));
        db.RequestAuths.AddRange(requests.Where(request => request.Auth != null).Select(request => new RequestAuthRow
        {
            Id = EnsureId(request.Auth!.Id),
            RequestId = request.Id,
            AuthType = request.Auth.AuthType,
            ConfigJson = request.Auth.ConfigJson,
        }));
        db.RequestSettings.AddRange(document.RequestSettings
            .Where(setting => requests.Any(request => request.Id == setting.RequestId))
            .GroupBy(setting => setting.RequestId)
            .Select(group => group.First())
            .Select(setting => new RequestSettingsRow
            {
                Id = Guid.NewGuid().ToString("N"),
                RequestId = setting.RequestId,
                FollowRedirects = setting.FollowRedirects,
                MaxRedirects = setting.MaxRedirects,
                IgnoreSslErrors = setting.IgnoreSslErrors,
                TimeoutSeconds = setting.TimeoutSeconds,
                ProxyMode = setting.ProxyMode,
                ProxyUrl = setting.ProxyUrl,
                ProxyUsername = setting.ProxyUsername,
                ProxyPassword = setting.ProxyPassword,
            }));

        db.ServiceHeaders.AddRange(document.Services.SelectMany(service => service.Headers.Select(header => new ServiceHeaderRow
        {
            Id = EnsureId(header.Id), ServiceId = service.Id, Key = header.Key, Value = header.Value, Enabled = header.Enabled,
        })));
        db.ServiceAuths.AddRange(document.Services.Where(service => service.Auth != null).Select(service => new ServiceAuthRow
        {
            Id = EnsureId(service.Auth!.Id), ServiceId = service.Id, AuthType = service.Auth.AuthType, ConfigJson = service.Auth.ConfigJson,
        }));
        db.WorkspaceVariables.AddRange(document.WorkspaceVariables.Select(variable => new WorkspaceVariableRow
        {
            Id = EnsureId(variable.Id), WorkspaceId = variable.WorkspaceId, EnvironmentId = variable.EnvironmentId,
            Key = variable.Key, Value = variable.Value, IsSecret = variable.IsSecret, Enabled = variable.Enabled,
        }));
        db.ServiceVariables.AddRange(document.ServiceVariables.Select(variable => new ServiceVariableRow
        {
            Id = EnsureId(variable.Id), ServiceId = variable.ServiceId, EnvironmentId = variable.EnvironmentId,
            Key = variable.Key, Value = variable.Value, IsSecret = variable.IsSecret, Enabled = variable.Enabled,
        }));
        db.History.AddRange(document.History.Select(entry => new HistoryRow
        {
            Id = EnsureId(entry.Id), RequestId = requests.Any(request => request.Id == entry.RequestId) ? entry.RequestId : null,
            WorkspaceId = entry.WorkspaceId, Method = entry.Method, Url = entry.Url,
            RequestHeadersJson = entry.RequestHeadersJson, RequestBody = entry.RequestBody, ResponseStatus = entry.ResponseStatus,
            ResponseHeadersJson = entry.ResponseHeadersJson, ResponseBody = entry.ResponseBody, ResponseTimeMs = entry.ResponseTimeMs,
            ResponseSizeBytes = entry.ResponseSizeBytes, ExecutedAt = entry.ExecutedAt,
        }));
        db.MockServers.AddRange(document.MockServers.Select(server => new MockServerRow
        {
            Id = EnsureId(server.Id), WorkspaceId = server.WorkspaceId, Name = server.Name, Description = server.Description, Slug = server.Slug,
            Port = server.Port, IsRunning = server.IsRunning, CreatedAt = server.CreatedAt, UpdatedAt = server.UpdatedAt,
        }));
        db.MockServerEndpoints.AddRange(document.MockServers.SelectMany(server => server.Endpoints.Select(endpoint => new MockServerEndpointRow
        {
            Id = EnsureId(endpoint.Id), MockServerId = server.Id, Method = endpoint.Method, Path = endpoint.Path, StatusCode = endpoint.StatusCode,
            ContentType = endpoint.ContentType, ResponseBody = endpoint.ResponseBody, ResponseHeadersJson = endpoint.ResponseHeadersJson,
            ScriptEnabled = endpoint.ScriptEnabled, Script = endpoint.Script, DelayMs = endpoint.DelayMs, SortOrder = endpoint.SortOrder,
            CreatedAt = endpoint.CreatedAt,
        })));

        await db.SaveChangesAsync();
        await transaction.CommitAsync();
    }

    private async Task<JsonDataDocument> ReadSqliteDocumentAsync(AppDbContext db)
    {
        var workspaces = await db.Workspaces.AsNoTracking().ToListAsync();
        var environments = await db.Environments.AsNoTracking().ToListAsync();
        var environmentVariables = await db.EnvironmentVariables.AsNoTracking().ToListAsync();
        var services = await db.Services.AsNoTracking().ToListAsync();
        var folders = await db.RequestFolders.AsNoTracking().ToListAsync();
        var requests = await db.Requests.AsNoTracking().ToListAsync();
        var requestHeaders = await db.RequestHeaders.AsNoTracking().ToListAsync();
        var requestParams = await db.RequestParams.AsNoTracking().ToListAsync();
        var requestVariables = await db.RequestVariables.AsNoTracking().ToListAsync();
        var requestSettings = await db.RequestSettings.AsNoTracking().ToListAsync();
        var requestAuths = await db.RequestAuths.AsNoTracking().ToListAsync();
        var serviceHeaders = await db.ServiceHeaders.AsNoTracking().ToListAsync();
        var serviceAuths = await db.ServiceAuths.AsNoTracking().ToListAsync();
        var workspaceVariables = await db.WorkspaceVariables.AsNoTracking().ToListAsync();
        var serviceVariables = await db.ServiceVariables.AsNoTracking().ToListAsync();
        var history = await db.History.AsNoTracking().ToListAsync();
        var mockServers = await db.MockServers.AsNoTracking().ToListAsync();
        var mockEndpoints = await db.MockServerEndpoints.AsNoTracking().ToListAsync();

        var document = new JsonDataDocument
        {
            Workspaces = workspaces.Select(workspace => new Workspace
            {
                Id = workspace.Id, Name = workspace.Name, CreatedAt = workspace.CreatedAt, UpdatedAt = workspace.UpdatedAt,
            }).ToList(),
            Environments = environments.Select(environment => new ModelEnvironment
            {
                Id = environment.Id, WorkspaceId = environment.WorkspaceId, Name = environment.Name,
                IsActive = environment.IsActive, SortOrder = environment.SortOrder, CreatedAt = environment.CreatedAt,
                Variables = environmentVariables.Where(variable => variable.EnvironmentId == environment.Id).Select(variable => new EnvironmentVariable
                {
                    Id = variable.Id, EnvironmentId = variable.EnvironmentId, Key = variable.Key, Value = variable.Value,
                    IsSecret = variable.IsSecret, Enabled = variable.Enabled,
                }).ToList(),
            }).ToList(),
            EnvironmentVariables = environmentVariables.Select(variable => new EnvironmentVariable
            {
                Id = variable.Id, EnvironmentId = variable.EnvironmentId, Key = variable.Key, Value = variable.Value,
                IsSecret = variable.IsSecret, Enabled = variable.Enabled,
            }).ToList(),
            Services = services.Select(service => new Service
            {
                Id = service.Id, WorkspaceId = service.WorkspaceId, Name = service.Name, Description = service.Description,
                SortOrder = service.SortOrder, CreatedAt = service.CreatedAt,
                Headers = serviceHeaders.Where(header => header.ServiceId == service.Id).Select(header => new ModelKeyValuePair
                {
                    Id = header.Id, Key = header.Key, Value = header.Value, Enabled = header.Enabled,
                }).ToList(),
                Auth = serviceAuths.Where(auth => auth.ServiceId == service.Id).Select(auth => new ServiceAuth
                {
                    Id = auth.Id, ServiceId = auth.ServiceId, AuthType = auth.AuthType, ConfigJson = auth.ConfigJson,
                }).FirstOrDefault(),
            }).ToList(),
            RequestFolders = folders.Select(folder => new RequestFolder
            {
                Id = folder.Id, ServiceId = folder.ServiceId, Name = folder.Name, SortOrder = folder.SortOrder, CreatedAt = folder.CreatedAt,
            }).ToList(),
            Requests = requests.Select(request => new ApiRequest
            {
                Id = request.Id, ServiceId = request.ServiceId, FolderId = request.FolderId, Name = request.Name, Method = request.Method,
                Url = request.Url, Body = request.Body, BodyType = request.BodyType, PreRequestScript = request.PreRequestScript,
                PostRequestScript = request.PostRequestScript, TestScript = request.TestScript, SortOrder = request.SortOrder,
                IsFavorite = request.IsFavorite, CreatedAt = request.CreatedAt, UpdatedAt = request.UpdatedAt,
                Headers = requestHeaders.Where(header => header.RequestId == request.Id).Select(header => new ModelKeyValuePair
                {
                    Id = header.Id, Key = header.Key, Value = header.Value, Enabled = header.Enabled,
                }).ToList(),
                Params = requestParams.Where(parameter => parameter.RequestId == request.Id).Select(parameter => new ModelKeyValuePair
                {
                    Id = parameter.Id, Key = parameter.Key, Value = parameter.Value, Enabled = parameter.Enabled,
                }).ToList(),
                Variables = requestVariables.Where(variable => variable.RequestId == request.Id).Select(variable => new RequestVariable
                {
                    Id = variable.Id, RequestId = variable.RequestId, Key = variable.Key, Value = variable.Value, Enabled = variable.Enabled,
                }).ToList(),
                Auth = requestAuths.Where(auth => auth.RequestId == request.Id).Select(auth => new RequestAuth
                {
                    Id = auth.Id, RequestId = auth.RequestId, AuthType = auth.AuthType, ConfigJson = auth.ConfigJson,
                }).FirstOrDefault(),
            }).ToList(),
            RequestSettings = requestSettings.Select(setting => new ApiRequestSettings
            {
                RequestId = setting.RequestId, FollowRedirects = setting.FollowRedirects, MaxRedirects = setting.MaxRedirects,
                IgnoreSslErrors = setting.IgnoreSslErrors, TimeoutSeconds = setting.TimeoutSeconds, ProxyMode = setting.ProxyMode,
                ProxyUrl = setting.ProxyUrl, ProxyUsername = setting.ProxyUsername, ProxyPassword = setting.ProxyPassword,
            }).ToList(),
            WorkspaceVariables = workspaceVariables.Select(variable => new WorkspaceVariable
            {
                Id = variable.Id, WorkspaceId = variable.WorkspaceId, EnvironmentId = variable.EnvironmentId, Key = variable.Key,
                Value = variable.Value, IsSecret = variable.IsSecret, Enabled = variable.Enabled,
            }).ToList(),
            ServiceVariables = serviceVariables.Select(variable => new ServiceVariable
            {
                Id = variable.Id, ServiceId = variable.ServiceId, EnvironmentId = variable.EnvironmentId, Key = variable.Key,
                Value = variable.Value, IsSecret = variable.IsSecret, Enabled = variable.Enabled,
            }).ToList(),
            History = history.Select(entry => new HistoryEntry
            {
                Id = entry.Id, RequestId = entry.RequestId, WorkspaceId = entry.WorkspaceId, Method = entry.Method, Url = entry.Url,
                RequestHeadersJson = entry.RequestHeadersJson, RequestBody = entry.RequestBody, ResponseStatus = entry.ResponseStatus,
                ResponseHeadersJson = entry.ResponseHeadersJson, ResponseBody = entry.ResponseBody, ResponseTimeMs = entry.ResponseTimeMs,
                ResponseSizeBytes = entry.ResponseSizeBytes, ExecutedAt = entry.ExecutedAt,
            }).ToList(),
            MockServers = mockServers.Select(server => new MockServer
            {
                Id = server.Id, WorkspaceId = server.WorkspaceId, Name = server.Name, Description = server.Description, Slug = server.Slug,
                Port = server.Port, IsRunning = server.IsRunning, CreatedAt = server.CreatedAt, UpdatedAt = server.UpdatedAt,
                Endpoints = mockEndpoints.Where(endpoint => endpoint.MockServerId == server.Id).Select(endpoint => new MockServerEndpoint
                {
                    Id = endpoint.Id, MockServerId = endpoint.MockServerId, Method = endpoint.Method, Path = endpoint.Path,
                    StatusCode = endpoint.StatusCode, ContentType = endpoint.ContentType, ResponseBody = endpoint.ResponseBody,
                    ResponseHeadersJson = endpoint.ResponseHeadersJson, ScriptEnabled = endpoint.ScriptEnabled, Script = endpoint.Script,
                    DelayMs = endpoint.DelayMs, SortOrder = endpoint.SortOrder, CreatedAt = endpoint.CreatedAt,
                }).ToList(),
            }).ToList(),
        };

        return document;
    }

    private static bool HasUserData(JsonDataDocument document)
    {
        return document.Services.Count > 0 ||
               document.Requests.Count > 0 ||
               document.RequestFolders.Count > 0 ||
               document.EnvironmentVariables.Count > 0 ||
               document.WorkspaceVariables.Count > 0 ||
               document.ServiceVariables.Count > 0 ||
               document.History.Count > 0 ||
               document.MockServers.Count > 0 ||
               document.Workspaces.Any(workspace => workspace.Id != "default");
    }

    private static string NormalizeMode(string value)
    {
        var normalized = value.Trim().ToLowerInvariant();
        if (normalized is not (SettingsService.SqliteMode or SettingsService.JsonMode))
            throw new ArgumentException("Invalid storage mode. Expected 'sqlite' or 'json'.");
        return normalized;
    }

    private static string NormalizeStrategy(string value)
    {
        var normalized = value.Trim();
        if (normalized.Equals(SettingsService.JsonSingleFile, StringComparison.OrdinalIgnoreCase))
            return SettingsService.JsonSingleFile;
        if (normalized.Equals(SettingsService.JsonPerCollection, StringComparison.OrdinalIgnoreCase))
            return SettingsService.JsonPerCollection;
        throw new ArgumentException("Invalid JSON storage strategy. Expected 'single' or 'perCollection'.");
    }

    private static string EnsureId(string id) => string.IsNullOrWhiteSpace(id) ? Guid.NewGuid().ToString("N") : id;

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.TopDirectoryOnly))
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), overwrite: false);
        foreach (var directory in Directory.EnumerateDirectories(source))
            CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
    }
}

public sealed record StorageMigrationResult(
    string SourceMode,
    string TargetMode,
    int Services,
    int Requests,
    string? BackupPath,
    bool PreservedExistingTarget);
