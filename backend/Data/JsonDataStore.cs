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

            SaveLocked();
            _logger.LogInformation("JSON store ready at {Path} ({Strategy})", _filePath, IsPerCollection ? "per collection" : "single file");
        }
    }

    public string FilePath => _filePath;

    public string ResolveCollectionPath(string serviceId, string name, string? requestedPath)
    {
        if (!IsPerCollection)
        {
            return "";
        }

        var normalized = requestedPath?.Trim();
        if (!string.IsNullOrWhiteSpace(normalized) &&
            string.Equals(Path.GetExtension(normalized), ".json", StringComparison.OrdinalIgnoreCase) &&
            !Directory.Exists(normalized))
        {
            return Path.GetFullPath(normalized);
        }

        var parent = string.IsNullOrWhiteSpace(normalized)
            ? DefaultCollectionsDirectory
            : Path.GetFullPath(normalized);
        var safeName = SanitizeFileName(name);
        var suffix = serviceId.Length > 8 ? serviceId[..8] : serviceId;
        return Path.Combine(parent, $"{safeName}-{suffix}.json");
    }

    public void Mutate(Action<JsonDataDocument> action)
    {
        lock (_lock)
        {
            action(_doc);
            SaveLocked();
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

    private string DefaultCollectionsDirectory => Path.Combine(
        Path.GetDirectoryName(_filePath) ?? Directory.GetCurrentDirectory(),
        $"{Path.GetFileNameWithoutExtension(_filePath)}-collections");

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
                ?? new JsonDataDocument();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read JSON data file {Path}; starting with an empty store.", _filePath);
            _doc = new JsonDataDocument();
        }
    }

    private void LoadCollectionFilesLocked()
    {
        var legacyRequests = _doc.Requests.ToList();
        var legacySettings = _doc.RequestSettings.ToList();
        var legacyVariables = _doc.ServiceVariables.ToList();
        _doc.Requests = [];
        _doc.RequestSettings = [];
        _doc.ServiceVariables = [];

        foreach (var service in _doc.Services)
        {
            service.Requests = [];
            service.StoragePath = ResolveCollectionPath(service.Id, service.Name, service.StoragePath);

            if (File.Exists(service.StoragePath))
            {
                try
                {
                    var collection = JsonSerializer.Deserialize<JsonCollectionDocument>(
                        File.ReadAllText(service.StoragePath), JsonOptions);
                    if (collection != null)
                    {
                        _doc.Requests.AddRange(collection.Requests.Where(row => row.ServiceId == service.Id));
                        _doc.RequestSettings.AddRange(collection.RequestSettings.Where(row => row.RequestId != ""));
                        _doc.ServiceVariables.AddRange(collection.ServiceVariables.Where(row => row.ServiceId == service.Id));
                        continue;
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to read collection file {Path}; falling back to root data.", service.StoragePath);
                }
            }

            _doc.Requests.AddRange(legacyRequests.Where(row => row.ServiceId == service.Id));
            _doc.RequestSettings.AddRange(legacySettings.Where(row => legacyRequests.Any(request => request.Id == row.RequestId && request.ServiceId == service.Id)));
            _doc.ServiceVariables.AddRange(legacyVariables.Where(row => row.ServiceId == service.Id));
        }
    }

    private void SaveLocked()
    {
        if (!IsPerCollection)
        {
            WriteJsonFile(_filePath, _doc);
            return;
        }

        foreach (var service in _doc.Services)
        {
            service.StoragePath = ResolveCollectionPath(service.Id, service.Name, service.StoragePath);
        }

        var manifest = new JsonDataDocument
        {
            Version = _doc.Version,
            Workspaces = _doc.Workspaces,
            Environments = _doc.Environments,
            EnvironmentVariables = _doc.EnvironmentVariables,
            Services = _doc.Services,
            WorkspaceVariables = _doc.WorkspaceVariables,
            History = _doc.History,
            MockServers = _doc.MockServers,
        };
        WriteJsonFile(_filePath, manifest);

        foreach (var service in _doc.Services)
        {
            var collection = new JsonCollectionDocument
            {
                Service = service,
                Requests = _doc.Requests.Where(row => row.ServiceId == service.Id).ToList(),
                RequestSettings = _doc.RequestSettings
                    .Where(row => _doc.Requests.Any(request => request.Id == row.RequestId && request.ServiceId == service.Id))
                    .ToList(),
                ServiceVariables = _doc.ServiceVariables.Where(row => row.ServiceId == service.Id).ToList(),
            };
            collection.Service.Requests = [];
            WriteJsonFile(service.StoragePath, collection);
        }
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
    public List<ApiRequest> Requests { get; set; } = [];
    public List<ApiRequestSettings> RequestSettings { get; set; } = [];
    public List<WorkspaceVariable> WorkspaceVariables { get; set; } = [];
    public List<ServiceVariable> ServiceVariables { get; set; } = [];
    public List<HistoryEntry> History { get; set; } = [];
    public List<MockServer> MockServers { get; set; } = [];
}
