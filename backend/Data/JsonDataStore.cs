using System.Text.Json;
using System.Text.Json.Serialization;
using RequestLoom.Api.Models;
using RequestLoom.Api.Services;
using Environment = RequestLoom.Api.Models.Environment;

namespace RequestLoom.Api.Data;

/// <summary>
/// In-memory JSON storage with either one workspace document or one document
/// per collection. The root document keeps workspace-wide data; collection
/// documents keep requests, request settings, and service variables together.
/// </summary>
public class JsonDataStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly SettingsService _settings;
    private readonly string _filePath;
    private readonly object _lock = new();
    private readonly ILogger<JsonDataStore> _logger;
    private JsonDataDocument _doc = new();

    public JsonDataStore(SettingsService settings, ILogger<JsonDataStore> logger)
    {
        _settings = settings;
        _logger = logger;
        _filePath = settings.JsonDataPath;
    }

    public bool IsPerCollection => string.Equals(
        _settings.JsonStorageStrategy,
        SettingsService.JsonPerCollection,
        StringComparison.OrdinalIgnoreCase);

    public bool IsJsonStorage => _settings.UseJson;

    public void Initialize()
    {
        lock (_lock)
        {
            JsonFileTransaction.Recover(_filePath);
            LoadRootLocked();

            if (IsPerCollection)
            {
                LoadCollectionFilesLocked();
            }

            if (_doc.Workspaces.Count == 0)
            {
                _logger.LogInformation("Creating default workspace in JSON store...");
                _doc.Workspaces.Add(new Workspace
                {
                    Id = "default",
                    Name = "Default Workspace",
                    CreatedAt = Now(),
                    UpdatedAt = Now()
                });

                SeedEnvironments(_doc, "default");
            }

            if (IsPerCollection)
            {
                foreach (var service in _doc.Services)
                {
                    service.StoragePath = ResolveCollectionPath(service.Id, service.Name, service.StoragePath);
                }
            }

            // Older single-file JSON data did not persist request workspace IDs.
            // Fill them from the owning collection before SQLite migration or export.
            foreach (var request in _doc.Requests.Where(row => row.ServiceId != null && string.IsNullOrWhiteSpace(row.WorkspaceId)))
            {
                var service = _doc.Services.FirstOrDefault(row => row.Id == request.ServiceId);
                if (service != null)
                {
                    request.WorkspaceId = service.WorkspaceId;
                }
            }

            SaveLocked();
            _logger.LogInformation("JSON store ready at {Path} ({Strategy})", _filePath, IsPerCollection ? "per collection" : "single file");
        }
    }

    public string FilePath => _filePath;

    public string ResolveCollectionPath(string serviceId, string name, string? requestedPath)
    {
        return ResolveCollectionPathFor(
            serviceId,
            name,
            requestedPath,
            _filePath,
            IsPerCollection);
    }

    public JsonDataDocument Snapshot()
    {
        lock (_lock)
        {
            return CloneDocument(_doc);
        }
    }

    public void WriteMigratedDocument(JsonDataDocument document, string targetPath, string strategy)
    {
        lock (_lock)
        {
            SaveDocumentLocked(
                document,
                Path.GetFullPath(targetPath),
                string.Equals(strategy, SettingsService.JsonPerCollection, StringComparison.OrdinalIgnoreCase));
        }
    }

    public void EnsureRequestFolderDirectory(
        string serviceId,
        string serviceName,
        string? storagePath,
        string folderName)
    {
        lock (_lock)
        {
            Directory.CreateDirectory(ResolveRequestFolderPath(
                serviceId,
                serviceName,
                storagePath,
                folderName));
        }
    }

    public void RenameRequestFolderDirectory(
        string serviceId,
        string serviceName,
        string? storagePath,
        string oldName,
        string newName)
    {
        lock (_lock)
        {
            var oldPath = ResolveRequestFolderPath(serviceId, serviceName, storagePath, oldName);
            var newPath = ResolveRequestFolderPath(serviceId, serviceName, storagePath, newName);
            if (string.Equals(oldPath, newPath, StringComparison.OrdinalIgnoreCase))
            {
                Directory.CreateDirectory(newPath);
                return;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(newPath)!);
            if (Directory.Exists(oldPath) && !Directory.Exists(newPath))
            {
                Directory.Move(oldPath, newPath);
            }
            else
            {
                Directory.CreateDirectory(newPath);
            }
        }
    }

    public void DeleteRequestFolderDirectory(
        string serviceId,
        string serviceName,
        string? storagePath,
        string folderName)
    {
        lock (_lock)
        {
            var path = ResolveRequestFolderPath(serviceId, serviceName, storagePath, folderName);
            if (!Directory.Exists(path)) return;

            try
            {
                // Request folders are metadata containers. Never remove user files
                // accidentally if somebody placed files in the directory.
                Directory.Delete(path);
            }
            catch (IOException)
            {
                // Keep a non-empty directory; its request-folder metadata is gone.
            }
            catch (UnauthorizedAccessException)
            {
                // Keep an inaccessible directory; its request-folder metadata is gone.
            }
        }
    }

    public void Mutate(Action<JsonDataDocument> action)
    {
        lock (_lock)
        {
            var working = CloneDocument(_doc);
            action(working);
            SaveDocumentLocked(working, _filePath, IsPerCollection);
            _doc = working;
        }
    }

    public T Read<T>(Func<JsonDataDocument, T> selector)
    {
        lock (_lock)
        {
            return selector(_doc);
        }
    }

    public StoredRequestFile? GetRequestFile(string requestId)
    {
        return Read(doc =>
        {
            var request = doc.Requests.FirstOrDefault(row => row.Id == requestId);
            if (request == null)
            {
                return null;
            }

            var service = doc.Services.FirstOrDefault(row => row.Id == request.ServiceId);
            var filePath = IsPerCollection && service != null && !string.IsNullOrWhiteSpace(service.StoragePath)
                ? service.StoragePath
                : _filePath;

            return new StoredRequestFile
            {
                RequestId = requestId,
                FilePath = filePath,
                Content = JsonSerializer.Serialize(request, JsonOptions),
                IsJsonStorage = true,
            };
        });
    }

    public ServiceFileResponse CreateServiceFile(string serviceId, string serviceName, string? storagePath, string name, string kind)
    {
        if (!string.Equals(kind, "folder", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(kind, "js", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Asset kind must be 'folder' or 'js'.");
        }

        lock (_lock)
        {
            var parent = GetServiceFilesDirectory(serviceId, serviceName, storagePath);
            Directory.CreateDirectory(parent);
            var safeName = SanitizeFileName(name);

            if (string.Equals(kind, "folder", StringComparison.OrdinalIgnoreCase))
            {
                var folderPath = Path.Combine(parent, safeName);
                Directory.CreateDirectory(folderPath);
                return new ServiceFileResponse
                {
                    Path = folderPath,
                    Name = safeName,
                };
            }

            var fileName = NormalizeScriptFileName(safeName);
            var filePath = Path.Combine(parent, fileName);
            if (!File.Exists(filePath))
            {
                File.WriteAllText(filePath, DefaultScriptContent(fileName));
            }

            return new ServiceFileResponse
            {
                Path = filePath,
                Name = fileName,
                Content = File.ReadAllText(filePath),
            };
        }
    }

    public void SaveServiceFile(string serviceId, string serviceName, string? storagePath, string name, string content)
    {
        lock (_lock)
        {
            var filePath = ResolveServiceScriptPath(serviceId, serviceName, storagePath, name);
            if (!File.Exists(filePath))
            {
                throw new FileNotFoundException("Collection JavaScript file was not found.", filePath);
            }

            File.WriteAllText(filePath, content ?? "");
        }
    }

    public IReadOnlyList<ServiceFileResponse> GetServiceFiles(string serviceId, string serviceName, string? storagePath)
    {
        lock (_lock)
        {
            var parent = GetServiceFilesDirectory(serviceId, serviceName, storagePath);
            if (!Directory.Exists(parent))
            {
                return [];
            }

            return Directory.EnumerateFiles(parent, "*.js", SearchOption.TopDirectoryOnly)
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                .Select(path => new ServiceFileResponse
                {
                    Path = path,
                    Name = Path.GetFileName(path),
                    Content = File.ReadAllText(path),
                })
                .ToList();
        }
    }

    public void DeleteServiceFile(string serviceId, string serviceName, string? storagePath, string name)
    {
        lock (_lock)
        {
            var filePath = ResolveServiceScriptPath(serviceId, serviceName, storagePath, name);
            if (!File.Exists(filePath))
            {
                throw new FileNotFoundException("Collection JavaScript file was not found.", filePath);
            }

            File.Delete(filePath);
        }
    }

    private string ResolveServiceScriptPath(string serviceId, string serviceName, string? storagePath, string name)
    {
        var parent = GetServiceFilesDirectory(serviceId, serviceName, storagePath);
        var fileName = NormalizeScriptFileName(SanitizeFileName(name));
        return Path.Combine(parent, fileName);
    }

    private string GetServiceFilesDirectory(string serviceId, string serviceName, string? storagePath)
    {
        if (IsPerCollection && !string.IsNullOrWhiteSpace(storagePath))
        {
            var collectionDirectory = Path.GetDirectoryName(Path.GetFullPath(storagePath));
            if (!string.IsNullOrWhiteSpace(collectionDirectory))
            {
                return collectionDirectory;
            }
        }

        var storageDirectory = Path.GetDirectoryName(Path.GetFullPath(_settings.StoragePath))
            ?? Directory.GetCurrentDirectory();
        var collectionsDirectory = Path.Combine(storageDirectory, "requestloom-collections");
        var safeName = SanitizeFileName(serviceName);
        var suffix = serviceId.Length > 8 ? serviceId[..8] : serviceId;
        var legacyDirectory = Path.Combine(collectionsDirectory, $"{safeName}-{suffix}");
        return Directory.Exists(legacyDirectory)
            ? legacyDirectory
            : Path.Combine(collectionsDirectory, $"collection-{suffix}");
    }

    private static string NormalizeScriptFileName(string name)
    {
        return name.EndsWith(".js", StringComparison.OrdinalIgnoreCase) ? name : $"{name}.js";
    }

    private static string DefaultScriptContent(string fileName)
    {
        return $"// Shared collection script: {fileName}\n// Use module.exports to expose reusable helpers to request scripts.\n\nmodule.exports = {{}};\n";
    }

    private string ResolveRequestFolderPath(
        string serviceId,
        string serviceName,
        string? storagePath,
        string folderName)
    {
        return ResolveRequestFolderPathFor(
            serviceId,
            serviceName,
            storagePath,
            _filePath,
            _settings.JsonStorageStrategy,
            folderName);
    }

    private void LoadRootLocked()
    {
        if (!File.Exists(_filePath))
        {
            _doc = new JsonDataDocument();
            return;
        }

        try
        {
            _doc = JsonSerializer.Deserialize<JsonDataDocument>(File.ReadAllText(_filePath), JsonOptions)
                ?? throw new JsonException("Storage document is null.");
        }
        catch (Exception ex)
        {
            throw new InvalidDataException($"Cannot read JSON storage '{_filePath}'. The file was preserved. Restore a valid backup from '{_filePath}.bak' before restarting.", ex);
        }
    }

    private void LoadCollectionFilesLocked()
    {
        var legacyRequests = _doc.Requests.ToList();
        var legacyFolders = _doc.RequestFolders.ToList();
        var legacySettings = _doc.RequestSettings.ToList();
        var legacyVariables = _doc.ServiceVariables.ToList();
        _doc.Requests = legacyRequests.Where(row => row.ServiceId == null).ToList();
        _doc.RequestFolders = [];
        _doc.RequestSettings = legacySettings
            .Where(row => legacyRequests.Any(request => request.Id == row.RequestId && request.ServiceId == null))
            .ToList();
        _doc.ServiceVariables = [];

        foreach (var service in _doc.Services)
        {
            service.Requests = [];
            var hasFileReference = !string.IsNullOrWhiteSpace(service.StoragePath);
            service.StoragePath = ResolveCollectionPath(service.Id, service.Name, service.StoragePath);

            if (File.Exists(service.StoragePath))
            {
                try
                {
                    var collection = JsonSerializer.Deserialize<JsonCollectionDocument>(
                        File.ReadAllText(service.StoragePath), JsonOptions)
                        ?? throw new JsonException("Collection document is null.");
                    if (collection != null)
                    {
                        var serviceRequests = collection.Requests.Where(row => row.ServiceId == service.Id).ToList();
                        foreach (var request in serviceRequests)
                        {
                            if (string.IsNullOrWhiteSpace(request.WorkspaceId)) request.WorkspaceId = service.WorkspaceId;
                        }
                        _doc.Requests.AddRange(serviceRequests);
                        _doc.RequestFolders.AddRange(collection.RequestFolders.Where(row => row.ServiceId == service.Id));
                        _doc.RequestSettings.AddRange(collection.RequestSettings.Where(row => row.RequestId != ""));
                        _doc.ServiceVariables.AddRange(collection.ServiceVariables.Where(row => row.ServiceId == service.Id));
                        continue;
                    }
                }
                catch (Exception ex)
                {
                    throw new InvalidDataException($"Cannot read collection '{service.StoragePath}'. The file was preserved. Restore its .bak backup before restarting.", ex);
                }
            }
            else if (hasFileReference && !legacyRequests.Any(row => row.ServiceId == service.Id))
            {
                throw new FileNotFoundException("A referenced collection file is missing; storage was preserved.", service.StoragePath);
            }

            var legacyServiceRequests = legacyRequests.Where(row => row.ServiceId == service.Id).ToList();
            foreach (var request in legacyServiceRequests)
            {
                if (string.IsNullOrWhiteSpace(request.WorkspaceId)) request.WorkspaceId = service.WorkspaceId;
            }
            _doc.Requests.AddRange(legacyServiceRequests);
            _doc.RequestFolders.AddRange(legacyFolders.Where(row => row.ServiceId == service.Id));
            _doc.RequestSettings.AddRange(legacySettings.Where(row => legacyRequests.Any(request => request.Id == row.RequestId && request.ServiceId == service.Id)));
            _doc.ServiceVariables.AddRange(legacyVariables.Where(row => row.ServiceId == service.Id));
        }
    }

    private void SaveLocked()
    {
        SaveDocumentLocked(_doc, _filePath, IsPerCollection);
    }

    private void SaveDocumentLocked(JsonDataDocument document, string filePath, bool isPerCollection)
    {
        if (!isPerCollection)
        {
            foreach (var service in document.Services)
            {
                service.StoragePath = "";
            }

            EnsureRequestFolderDirectoriesLocked(document, filePath, SettingsService.JsonSingleFile);
            JsonFileTransaction.Commit(filePath, new Dictionary<string, string>
            {
                [filePath] = JsonSerializer.Serialize(document, JsonOptions),
            });
            return;
        }

        foreach (var service in document.Services)
        {
            service.StoragePath = ResolveCollectionPathFor(
                service.Id,
                service.Name,
                service.StoragePath,
                filePath,
                true);
        }

        var manifest = new JsonDataDocument
        {
            Version = document.Version,
            Workspaces = document.Workspaces,
            Environments = document.Environments,
            EnvironmentVariables = document.EnvironmentVariables,
            Services = document.Services,
            WorkspaceVariables = document.WorkspaceVariables,
            Requests = document.Requests.Where(row => row.ServiceId == null).ToList(),
            RequestSettings = document.RequestSettings
                .Where(row => document.Requests.Any(request => request.Id == row.RequestId && request.ServiceId == null))
                .ToList(),
            History = document.History,
            MockServers = document.MockServers,
        };
        var files = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var service in document.Services)
        {
            var collection = new JsonCollectionDocument
            {
                Service = service,
                RequestFolders = document.RequestFolders.Where(folder => folder.ServiceId == service.Id).ToList(),
                Requests = document.Requests.Where(row => row.ServiceId == service.Id).ToList(),
                RequestSettings = document.RequestSettings
                    .Where(row => document.Requests.Any(request => request.Id == row.RequestId && request.ServiceId == service.Id))
                    .ToList(),
                ServiceVariables = document.ServiceVariables.Where(row => row.ServiceId == service.Id).ToList(),
            };
            collection.Service.Requests = [];
            collection.Service.Folders = [];
            if (!files.TryAdd(service.StoragePath, JsonSerializer.Serialize(collection, JsonOptions)))
                throw new InvalidOperationException("Collections must use distinct storage files.");
        }

        EnsureRequestFolderDirectoriesLocked(document, filePath, SettingsService.JsonPerCollection);
        if (!files.TryAdd(filePath, JsonSerializer.Serialize(manifest, JsonOptions)))
            throw new InvalidOperationException("A collection cannot overwrite the workspace manifest.");
        JsonFileTransaction.Commit(filePath, files);
    }

    private static void EnsureRequestFolderDirectoriesLocked(
        JsonDataDocument document,
        string filePath,
        string strategy)
    {
        foreach (var service in document.Services)
        {
            foreach (var folder in document.RequestFolders.Where(folder => folder.ServiceId == service.Id))
            {
                Directory.CreateDirectory(ResolveRequestFolderPathFor(
                    service.Id,
                    service.Name,
                    service.StoragePath,
                    filePath,
                    strategy,
                    folder.Name));
            }
        }
    }

    public static string ResolveCollectionPathFor(
        string serviceId,
        string name,
        string? requestedPath,
        string targetFilePath,
        bool isPerCollection)
    {
        if (!isPerCollection) return "";

        var normalized = requestedPath?.Trim();
        if (!string.IsNullOrWhiteSpace(normalized) &&
            string.Equals(Path.GetExtension(normalized), ".json", StringComparison.OrdinalIgnoreCase) &&
            !Directory.Exists(normalized))
        {
            return Path.GetFullPath(normalized);
        }

        var defaultDirectory = Path.Combine(
            Path.GetDirectoryName(Path.GetFullPath(targetFilePath)) ?? Directory.GetCurrentDirectory(),
            $"{Path.GetFileNameWithoutExtension(targetFilePath)}-collections");
        var parent = string.IsNullOrWhiteSpace(normalized)
            ? defaultDirectory
            : Path.GetFullPath(normalized);
        var safeName = SanitizeFileName(name);
        var suffix = serviceId.Length > 8 ? serviceId[..8] : serviceId;
        return Path.Combine(parent, $"{safeName}-{suffix}.json");
    }

    public static string ResolveRequestFolderPathFor(
        string serviceId,
        string serviceName,
        string? storagePath,
        string jsonDataPath,
        string strategy,
        string folderName)
    {
        var isPerCollection = string.Equals(
            strategy,
            SettingsService.JsonPerCollection,
            StringComparison.OrdinalIgnoreCase);
        string serviceDirectory;

        if (isPerCollection && !string.IsNullOrWhiteSpace(storagePath))
        {
            var collectionPath = Path.GetFullPath(storagePath);
            serviceDirectory = Path.Combine(
                Path.GetDirectoryName(collectionPath) ?? Directory.GetCurrentDirectory(),
                Path.GetFileNameWithoutExtension(collectionPath));
        }
        else
        {
            var collectionsDirectory = Path.Combine(
                Path.GetDirectoryName(Path.GetFullPath(jsonDataPath)) ?? Directory.GetCurrentDirectory(),
                "requestloom-collections");
            var safeName = SanitizeFileName(serviceName);
            var suffix = serviceId.Length > 8 ? serviceId[..8] : serviceId;
            var legacyDirectory = Path.Combine(collectionsDirectory, $"{safeName}-{suffix}");
            serviceDirectory = Directory.Exists(legacyDirectory)
                ? legacyDirectory
                : Path.Combine(collectionsDirectory, $"collection-{suffix}");
        }

        return Path.Combine(serviceDirectory, SanitizeFileName(folderName));
    }

    private static JsonDataDocument CloneDocument(JsonDataDocument document)
    {
        return JsonSerializer.Deserialize<JsonDataDocument>(
            JsonSerializer.Serialize(document, JsonOptions),
            JsonOptions) ?? new JsonDataDocument();
    }

    private static void WriteJsonFile(string path, object value)
    {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var tempPath = path + ".tmp";
        File.WriteAllText(tempPath, JsonSerializer.Serialize(value, JsonOptions));
        File.Move(tempPath, path, overwrite: true);
    }

    private static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = new string(value.Trim()
            .Replace('/', '_')
            .Replace('\\', '_')
            .Select(character => invalid.Contains(character) ? '_' : character)
            .ToArray());
        return string.IsNullOrWhiteSpace(sanitized) || sanitized is "." or ".." ? "collection" : sanitized;
    }

    internal static string Now() => DateTime.UtcNow.ToString("o");

    internal static void SeedEnvironments(JsonDataDocument doc, string workspaceId)
    {
        var names = new[] { "DEV", "STG", "PRD" };
        for (var i = 0; i < names.Length; i++)
        {
            doc.Environments.Add(new Environment
            {
                Id = Guid.NewGuid().ToString("N"),
                WorkspaceId = workspaceId,
                Name = names[i],
                IsActive = i == 0,
                SortOrder = i,
                CreatedAt = Now()
            });
        }
    }
}

public class StoredRequestFile
{
    public string RequestId { get; set; } = "";
    public string FilePath { get; set; } = "";
    public string Content { get; set; } = "";
    public bool IsJsonStorage { get; set; }
}

public class JsonCollectionDocument
{
    public int Version { get; set; } = 1;
    public Service Service { get; set; } = new();
    public List<RequestFolder> RequestFolders { get; set; } = [];
    public List<ApiRequest> Requests { get; set; } = [];
    public List<ApiRequestSettings> RequestSettings { get; set; } = [];
    public List<ServiceVariable> ServiceVariables { get; set; } = [];
}

/// <summary>Serialized shape of the root JSON data file.</summary>
public class JsonDataDocument
{
    public int Version { get; set; } = 2;
    public List<Workspace> Workspaces { get; set; } = [];
    public List<Environment> Environments { get; set; } = [];
    public List<EnvironmentVariable> EnvironmentVariables { get; set; } = [];
    public List<Service> Services { get; set; } = [];
    public List<RequestFolder> RequestFolders { get; set; } = [];
    public List<ApiRequest> Requests { get; set; } = [];
    public List<ApiRequestSettings> RequestSettings { get; set; } = [];
    public List<WorkspaceVariable> WorkspaceVariables { get; set; } = [];
    public List<ServiceVariable> ServiceVariables { get; set; } = [];
    public List<HistoryEntry> History { get; set; } = [];
    public List<MockServer> MockServers { get; set; } = [];
}
