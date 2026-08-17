using System.Text.Json;
using RequestLoom.Api.Models;
using Environment = RequestLoom.Api.Models.Environment;

namespace RequestLoom.Api.Data;

/// <summary>
/// In-memory data document persisted to a single JSON file.
/// Used when storage mode is "json"; all JSON repositories read/write through this store.
/// </summary>
public class JsonDataStore
{
    private readonly string _filePath;
    private readonly object _lock = new();
    private readonly ILogger<JsonDataStore> _logger;
    private JsonDataDocument _doc = new();

    public JsonDataStore(IConfiguration configuration, ILogger<JsonDataStore> logger)
    {
        _logger = logger;
        var configured = configuration["Storage:JsonPath"];
        _filePath = Path.GetFullPath(string.IsNullOrWhiteSpace(configured) ? "requestloom-data.json" : configured);
    }

    /// <summary>Loads the JSON file, seeding a default workspace on first run.</summary>
    public void Initialize()
    {
        lock (_lock)
        {
            if (File.Exists(_filePath))
            {
                try
                {
                    _doc = JsonSerializer.Deserialize<JsonDataDocument>(File.ReadAllText(_filePath))
                        ?? new JsonDataDocument();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to read JSON data file {Path}; starting with an empty store.", _filePath);
                    _doc = new JsonDataDocument();
                }
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

            SaveLocked();
            _logger.LogInformation("JSON store ready at {Path}", _filePath);
        }
    }

    public string FilePath
    {
        get
        {
            lock (_lock)
            {
                return _filePath;
            }
        }
    }

    /// <summary>Runs the action with exclusive access, persisting the document afterwards.</summary>
    public void Mutate(Action<JsonDataDocument> action)
    {
        lock (_lock)
        {
            action(_doc);
            SaveLocked();
        }
    }

    /// <summary>Runs the selector under the store lock without persisting.</summary>
    public T Read<T>(Func<JsonDataDocument, T> selector)
    {
        lock (_lock)
        {
            return selector(_doc);
        }
    }

    private void SaveLocked()
    {
        var directory = Path.GetDirectoryName(_filePath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var tempPath = _filePath + ".tmp";
        File.WriteAllText(tempPath, JsonSerializer.Serialize(_doc, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(tempPath, _filePath, overwrite: true);
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

/// <summary>Serialized shape of the JSON data file.</summary>
public class JsonDataDocument
{
    public int Version { get; set; } = 1;
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