using System.Globalization;
using System.Text.Json;

namespace RequestLoom.Api.Services;

/// <summary>
/// Application-level settings. The storage mode (sqlite | json) is resolved
/// with the following priority: environment variable STORAGE_MODE, then the
/// settings file (requestloom.settings.json), then appsettings Storage:Mode,
/// finally the default "sqlite". Changing the mode requires a restart.
/// Other settings are persisted in the same settings file and take effect
/// immediately. Storage mode changes can be applied by restarting the embedded
/// backend, which the desktop shell exposes as an in-app reload.
/// </summary>
public class SettingsService
{
    public const string SqliteMode = "sqlite";
    public const string JsonMode = "json";
    public const string JsonSingleFile = "single";
    public const string JsonPerCollection = "perCollection";
    public const int DefaultMaxRedirects = 10;
    public const int MaxAllowedRedirects = 50;

    private const string KeyStorageMode = "storageMode";
    private const string KeyJsonStorageStrategy = "jsonStorageStrategy";
    private const string KeyFollowRedirects = "followRedirects";
    private const string KeyMaxRedirects = "maxRedirects";
    private const string KeyRequestTimeoutMs = "requestTimeoutMs";
    private const string KeyIgnoreSslErrors = "ignoreSslErrors";
    private const string KeyMaxResponseBodySizeMb = "maxResponseBodySizeMb";
    private const string KeySaveHistory = "saveHistory";
    private const string KeyPersistCookies = "persistCookies";
    private const string KeyResponseFormat = "responseFormat";
    private const string KeyProxyEnabled = "proxyEnabled";
    private const string KeyProxyUrl = "proxyUrl";
    private const string KeyProxyUsername = "proxyUsername";
    private const string KeyProxyPassword = "proxyPassword";

    private readonly IConfiguration _config;
    private readonly string _settingsFilePath;
    private readonly object _lock = new();
    private Dictionary<string, string> _overrides = [];

    public SettingsService(IConfiguration config)
    {
        _config = config;
        _settingsFilePath = Path.GetFullPath("requestloom.settings.json");
        LoadSettingsFile();
    }

    /// <summary>Effective storage mode for this process.</summary>
    public string Mode
    {
        get
        {
            var env = Environment.GetEnvironmentVariable("STORAGE_MODE");
            if (!string.IsNullOrWhiteSpace(env)) return Normalize(env);

            lock (_lock)
            {
                if (_overrides.TryGetValue(KeyStorageMode, out var overrideMode) && !string.IsNullOrWhiteSpace(overrideMode))
                    return Normalize(overrideMode);
            }

            var configured = _config["Storage:Mode"];
            if (!string.IsNullOrWhiteSpace(configured)) return Normalize(configured);

            return SqliteMode;
        }
    }

    public bool UseJson => string.Equals(Mode, JsonMode, StringComparison.OrdinalIgnoreCase);

    public string JsonStorageStrategy
    {
        get
        {
            var configured = GetString(KeyJsonStorageStrategy, JsonSingleFile);
            return string.Equals(configured, JsonPerCollection, StringComparison.OrdinalIgnoreCase)
                ? JsonPerCollection
                : JsonSingleFile;
        }
    }

    /// <summary>Full path of the JSON data file used in json mode.</summary>
    public string JsonDataPath
    {
        get
        {
            var configured = _config["Storage:JsonPath"];
            return Path.GetFullPath(string.IsNullOrWhiteSpace(configured) ? "requestloom-data.json" : configured);
        }
    }

    /// <summary>Full path of the SQLite database file used in sqlite mode.</summary>
    public string DatabasePath
    {
        get
        {
            var configured = _config["Database:Path"];
            return Path.GetFullPath(string.IsNullOrWhiteSpace(configured) ? "RequestLoom.db" : configured);
        }
    }

    /// <summary>Path of the file the storage mode currently points at.</summary>
    public string StoragePath => UseJson ? JsonDataPath : DatabasePath;

    /// <summary>Default request timeout in milliseconds. 0 = no timeout.</summary>
    public long RequestTimeoutMs => GetLong(KeyRequestTimeoutMs, 120_000);

    /// <summary>Whether requests follow HTTP redirects by default.</summary>
    public bool FollowRedirects => GetBool(KeyFollowRedirects, true);

    /// <summary>Maximum number of automatic redirects to follow.</summary>
    public int MaxRedirects => (int)Math.Clamp(GetLong(KeyMaxRedirects, DefaultMaxRedirects), 1L, (long)MaxAllowedRedirects);

    /// <summary>Global default for ignoring TLS/SSL certificate errors.</summary>
    public bool IgnoreSslErrors => GetBool(KeyIgnoreSslErrors, false);

    /// <summary>Maximum response body size in megabytes to keep in the UI. 0 = unlimited.</summary>
    public long MaxResponseBodySizeMb => GetLong(KeyMaxResponseBodySizeMb, 0);

    /// <summary>Whether executed requests are recorded in history.</summary>
    public bool SaveHistory => GetBool(KeySaveHistory, true);

    /// <summary>Whether response cookies are reused and persisted between requests.</summary>
    public bool PersistCookies => GetBool(KeyPersistCookies, true);

    /// <summary>Default response body view format: "pretty" | "raw".</summary>
    public string ResponseFormat => GetString(KeyResponseFormat, "pretty");

    /// <summary>Whether requests are routed through a proxy server.</summary>
    public bool ProxyEnabled => GetBool(KeyProxyEnabled, false);

    /// <summary>Proxy server URL, e.g. http://localhost:8888.</summary>
    public string ProxyUrl => GetString(KeyProxyUrl, "");

    /// <summary>Optional proxy username for authentication.</summary>
    public string ProxyUsername => GetString(KeyProxyUsername, "");

    /// <summary>Optional proxy password for authentication.</summary>
    public string ProxyPassword => GetString(KeyProxyPassword, "");

    public AppSettingsDto GetSettings()
    {
        return new AppSettingsDto
        {
            StorageMode = Mode,
            StoragePath = StoragePath,
            JsonStorageStrategy = JsonStorageStrategy,
            RestartRequired = false,
            RequestTimeoutMs = RequestTimeoutMs,
            FollowRedirects = FollowRedirects,
            MaxRedirects = MaxRedirects,
            IgnoreSslErrors = IgnoreSslErrors,
            MaxResponseBodySizeMb = MaxResponseBodySizeMb,
            SaveHistory = SaveHistory,
            PersistCookies = PersistCookies,
            ResponseFormat = ResponseFormat,
            ProxyEnabled = ProxyEnabled,
            ProxyUrl = ProxyUrl,
            ProxyUsername = ProxyUsername,
            ProxyPassword = ProxyPassword
        };
    }

    /// <summary>
    /// Applies the requested settings and persists them to the settings file.
    /// Null fields in the request keep their current values. A storage mode
    /// change takes effect on the next restart.
    /// </summary>
    public AppSettingsDto Update(UpdateSettingsRequest request)
    {
        string? newMode = null;
        if (!string.IsNullOrWhiteSpace(request.StorageMode))
        {
            var normalized = Normalize(request.StorageMode);
            if (normalized != SqliteMode && normalized != JsonMode)
                throw new ArgumentException($"Invalid storage mode '{request.StorageMode}'. Expected 'sqlite' or 'json'.");
            newMode = normalized;
        }

        string? newJsonStorageStrategy = null;
        if (!string.IsNullOrWhiteSpace(request.JsonStorageStrategy))
        {
            var normalizedStrategy = NormalizeJsonStorageStrategy(request.JsonStorageStrategy);
            if (normalizedStrategy != JsonSingleFile && normalizedStrategy != JsonPerCollection)
                throw new ArgumentException($"Invalid JSON storage strategy '{request.JsonStorageStrategy}'. Expected 'single' or 'perCollection'.");
            newJsonStorageStrategy = normalizedStrategy;
        }

        if (request.RequestTimeoutMs is < 0)
            throw new ArgumentException("Request timeout must be zero or a positive number of milliseconds.");

        if (request.MaxRedirects is < 1 or > MaxAllowedRedirects)
            throw new ArgumentException($"Maximum redirects must be between 1 and {MaxAllowedRedirects}.");

        if (request.MaxResponseBodySizeMb is < 0)
            throw new ArgumentException("Maximum response size must be zero or a positive number of megabytes.");

        if (request.ResponseFormat is not null &&
            request.ResponseFormat != "pretty" && request.ResponseFormat != "raw")
            throw new ArgumentException("Invalid response format. Expected 'pretty' or 'raw'.");

        if (request.ProxyUrl is not null && !string.IsNullOrWhiteSpace(request.ProxyUrl) &&
            !Uri.TryCreate(request.ProxyUrl, UriKind.Absolute, out _))
            throw new ArgumentException("Invalid proxy URL. Expected an absolute URL such as 'http://localhost:8888'.");

        var restartRequired = (newMode != null &&
            !string.Equals(newMode, Mode, StringComparison.OrdinalIgnoreCase)) ||
            (newJsonStorageStrategy != null &&
             !string.Equals(newJsonStorageStrategy, JsonStorageStrategy, StringComparison.OrdinalIgnoreCase));

        lock (_lock)
        {
            if (newMode != null) _overrides[KeyStorageMode] = newMode;
            if (newJsonStorageStrategy != null) _overrides[KeyJsonStorageStrategy] = newJsonStorageStrategy;
            if (request.RequestTimeoutMs.HasValue) _overrides[KeyRequestTimeoutMs] = request.RequestTimeoutMs.Value.ToString(CultureInfo.InvariantCulture);
            if (request.FollowRedirects.HasValue) _overrides[KeyFollowRedirects] = request.FollowRedirects.Value ? "true" : "false";
            if (request.MaxRedirects.HasValue) _overrides[KeyMaxRedirects] = request.MaxRedirects.Value.ToString(CultureInfo.InvariantCulture);
            if (request.IgnoreSslErrors.HasValue) _overrides[KeyIgnoreSslErrors] = request.IgnoreSslErrors.Value ? "true" : "false";
            if (request.MaxResponseBodySizeMb.HasValue) _overrides[KeyMaxResponseBodySizeMb] = request.MaxResponseBodySizeMb.Value.ToString(CultureInfo.InvariantCulture);
            if (request.SaveHistory.HasValue) _overrides[KeySaveHistory] = request.SaveHistory.Value ? "true" : "false";
            if (request.PersistCookies.HasValue) _overrides[KeyPersistCookies] = request.PersistCookies.Value ? "true" : "false";
            if (request.ResponseFormat is not null) _overrides[KeyResponseFormat] = Normalize(request.ResponseFormat);
            if (request.ProxyEnabled.HasValue) _overrides[KeyProxyEnabled] = request.ProxyEnabled.Value ? "true" : "false";
            if (request.ProxyUrl is not null) _overrides[KeyProxyUrl] = request.ProxyUrl.Trim();
            if (request.ProxyUsername is not null) _overrides[KeyProxyUsername] = request.ProxyUsername;
            if (request.ProxyPassword is not null) _overrides[KeyProxyPassword] = request.ProxyPassword;
            Persist();
        }

        var effectiveMode = newMode ?? Mode;
        return new AppSettingsDto
        {
            StorageMode = effectiveMode,
            StoragePath = effectiveMode == JsonMode ? JsonDataPath : DatabasePath,
            JsonStorageStrategy = JsonStorageStrategy,
            RestartRequired = restartRequired,
            RequestTimeoutMs = RequestTimeoutMs,
            FollowRedirects = FollowRedirects,
            MaxRedirects = MaxRedirects,
            IgnoreSslErrors = IgnoreSslErrors,
            MaxResponseBodySizeMb = MaxResponseBodySizeMb,
            SaveHistory = SaveHistory,
            PersistCookies = PersistCookies,
            ResponseFormat = ResponseFormat,
            ProxyEnabled = ProxyEnabled,
            ProxyUrl = ProxyUrl,
            ProxyUsername = ProxyUsername,
            ProxyPassword = ProxyPassword
        };
    }

    private string GetString(string key, string fallback)
    {
        lock (_lock)
        {
            if (_overrides.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
                return value;
        }

        var configured = _config[$"Settings:{key}"];
        return string.IsNullOrWhiteSpace(configured) ? fallback : configured;
    }

    private bool GetBool(string key, bool fallback)
    {
        var value = GetString(key, fallback ? "true" : "false");
        return bool.TryParse(value, out var parsed) ? parsed : fallback;
    }

    private long GetLong(string key, long fallback)
    {
        var value = GetString(key, fallback.ToString(CultureInfo.InvariantCulture));
        return long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : fallback;
    }

    private void Persist()
    {
        var payload = new Dictionary<string, string>(_overrides);
        var tempPath = _settingsFilePath + ".tmp";
        File.WriteAllText(tempPath, JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(tempPath, _settingsFilePath, overwrite: true);
    }

    private void LoadSettingsFile()
    {
        if (!File.Exists(_settingsFilePath)) return;

        try
        {
            var parsed = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(_settingsFilePath));
            if (parsed != null) _overrides = parsed;
        }
        catch
        {
            // Ignore corrupt settings file; fall back to defaults.
        }
    }

    private static string Normalize(string mode) => mode.Trim().ToLowerInvariant();

    private static string NormalizeJsonStorageStrategy(string strategy)
    {
        var normalized = strategy.Trim();
        return normalized.Equals(JsonPerCollection, StringComparison.OrdinalIgnoreCase)
            ? JsonPerCollection
            : normalized.ToLowerInvariant();
    }
}

public class AppSettingsDto
{
    public string StorageMode { get; set; } = SettingsService.SqliteMode;
    public string StoragePath { get; set; } = "";
    public string JsonStorageStrategy { get; set; } = SettingsService.JsonSingleFile;
    public bool RestartRequired { get; set; }
    public long RequestTimeoutMs { get; set; } = 120_000;
    public bool FollowRedirects { get; set; } = true;
    public int MaxRedirects { get; set; } = SettingsService.DefaultMaxRedirects;
    public bool IgnoreSslErrors { get; set; }
    public long MaxResponseBodySizeMb { get; set; }
    public bool SaveHistory { get; set; } = true;
    public bool PersistCookies { get; set; } = true;
    public string ResponseFormat { get; set; } = "pretty";
    public bool ProxyEnabled { get; set; }
    public string ProxyUrl { get; set; } = "";
    public string ProxyUsername { get; set; } = "";
    public string ProxyPassword { get; set; } = "";
}

public class UpdateSettingsRequest
{
    public string? StorageMode { get; set; }
    public string? JsonStorageStrategy { get; set; }
    public long? RequestTimeoutMs { get; set; }
    public bool? FollowRedirects { get; set; }
    public int? MaxRedirects { get; set; }
    public bool? IgnoreSslErrors { get; set; }
    public long? MaxResponseBodySizeMb { get; set; }
    public bool? SaveHistory { get; set; }
    public bool? PersistCookies { get; set; }
    public string? ResponseFormat { get; set; }
    public bool? ProxyEnabled { get; set; }
    public string? ProxyUrl { get; set; }
    public string? ProxyUsername { get; set; }
    public string? ProxyPassword { get; set; }
}
