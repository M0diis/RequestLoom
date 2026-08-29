using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

/// <summary>
/// Stores workspace cookie jars on disk and applies them to subsequent requests.
/// Cookie values are local application data and can be removed through the cookie
/// jar endpoint or the request settings UI.
/// </summary>
public sealed class CookieJarService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string _filePath;
    private readonly object _lock = new();
    private readonly Dictionary<string, List<PersistedCookie>> _workspaces = new(StringComparer.OrdinalIgnoreCase);
    private bool _loaded;

    public CookieJarService(SettingsService settings)
    {
        var storageDirectory = Path.GetDirectoryName(settings.StoragePath) ?? AppContext.BaseDirectory;
        _filePath = Path.Combine(storageDirectory, "requestloom-cookie-jar.json");
    }

    public string GetCookieHeader(string workspaceId, Uri requestUri)
    {
        lock (_lock)
        {
            EnsureLoadedLocked();
            var cookies = GetWorkspaceCookiesLocked(workspaceId);
            RemoveExpiredLocked(cookies);
            if (cookies.Count == 0) return "";

            var container = new CookieContainer();
            foreach (var persisted in cookies)
            {
                try
                {
                    var persistedDomain = string.IsNullOrWhiteSpace(persisted.Domain)
                        ? requestUri.Host
                        : persisted.Domain;
                    var domain = NormalizeDomain(persistedDomain);
                    var cookieUri = new UriBuilder(requestUri.Scheme, domain).Uri;
                    var cookie = new Cookie(persisted.Name, persisted.Value, NormalizePath(persisted.Path), persistedDomain)
                    {
                        Secure = persisted.Secure,
                        HttpOnly = persisted.HttpOnly,
                    };
                    container.Add(cookieUri, cookie);
                }
                catch (Exception ex) when (ex is CookieException or UriFormatException)
                {
                    // Host-only cookies on localhost can reject an explicit domain.
                    if (string.Equals(
                            NormalizeDomain(persisted.Domain),
                            NormalizeDomain(requestUri.Host),
                            StringComparison.OrdinalIgnoreCase))
                    {
                        try
                        {
                            container.Add(requestUri, new Cookie(
                                persisted.Name,
                                persisted.Value,
                                NormalizePath(persisted.Path))
                            {
                                Secure = persisted.Secure,
                                HttpOnly = persisted.HttpOnly,
                            });
                        }
                        catch (CookieException)
                        {
                            // Ignore malformed legacy entries rather than blocking requests.
                        }
                    }
                }
            }

            return container.GetCookieHeader(requestUri);
        }
    }

    public void StoreResponseCookies(string workspaceId, Uri requestUri, IEnumerable<string> setCookieHeaders)
    {
        lock (_lock)
        {
            EnsureLoadedLocked();
            var cookies = GetWorkspaceCookiesLocked(workspaceId);

            foreach (var header in setCookieHeaders)
            {
                var parsed = ParseSetCookie(header, requestUri);
                if (parsed == null) continue;

                cookies.RemoveAll(existing =>
                    string.Equals(existing.Name, parsed.Name, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(NormalizeDomain(existing.Domain), NormalizeDomain(parsed.Domain), StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(NormalizePath(existing.Path), NormalizePath(parsed.Path), StringComparison.Ordinal));

                if (!IsExpired(parsed)) cookies.Add(parsed);
            }

            RemoveExpiredLocked(cookies);
            PersistLocked();
        }
    }

    public IReadOnlyList<CookieJarEntry> List(string workspaceId)
    {
        lock (_lock)
        {
            EnsureLoadedLocked();
            var cookies = GetWorkspaceCookiesLocked(workspaceId);
            if (RemoveExpiredLocked(cookies)) PersistLocked();

            return cookies
                .OrderBy(cookie => cookie.Domain, StringComparer.OrdinalIgnoreCase)
                .ThenBy(cookie => cookie.Path, StringComparer.Ordinal)
                .ThenBy(cookie => cookie.Name, StringComparer.OrdinalIgnoreCase)
                .Select(cookie => new CookieJarEntry
                {
                    Name = cookie.Name,
                    Domain = cookie.Domain,
                    Path = cookie.Path,
                    ExpiresAt = cookie.ExpiresAt,
                    Secure = cookie.Secure,
                    HttpOnly = cookie.HttpOnly,
                })
                .ToList();
        }
    }

    public void Clear(string workspaceId)
    {
        lock (_lock)
        {
            EnsureLoadedLocked();
            _workspaces.Remove(NormalizeWorkspaceId(workspaceId));
            PersistLocked();
        }
    }

    private List<PersistedCookie> GetWorkspaceCookiesLocked(string workspaceId)
    {
        var key = NormalizeWorkspaceId(workspaceId);
        if (!_workspaces.TryGetValue(key, out var cookies))
        {
            cookies = [];
            _workspaces[key] = cookies;
        }

        return cookies;
    }

    private void EnsureLoadedLocked()
    {
        if (_loaded) return;
        _loaded = true;

        try
        {
            if (!File.Exists(_filePath)) return;
            var document = JsonSerializer.Deserialize<CookieJarDocument>(File.ReadAllText(_filePath), JsonOptions);
            if (document?.Workspaces == null) return;

            foreach (var (workspaceId, cookies) in document.Workspaces)
            {
                if (!string.IsNullOrWhiteSpace(workspaceId) && cookies != null)
                {
                    _workspaces[NormalizeWorkspaceId(workspaceId)] = cookies
                        .Where(cookie => cookie != null && !string.IsNullOrWhiteSpace(cookie.Name))
                        .ToList();
                }
            }
        }
        catch (JsonException)
        {
            // A damaged jar should not prevent the API from starting.
        }
        catch (IOException)
        {
            // The jar can be unavailable temporarily while another process writes it.
        }
        catch (UnauthorizedAccessException)
        {
            // Read-only storage should not prevent the API from starting.
        }
    }

    private void PersistLocked()
    {
        var directory = Path.GetDirectoryName(_filePath);
        if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);

        var tempPath = _filePath + ".tmp";
        var document = new CookieJarDocument
        {
            Workspaces = new Dictionary<string, List<PersistedCookie>>(_workspaces, StringComparer.OrdinalIgnoreCase),
        };
        File.WriteAllText(tempPath, JsonSerializer.Serialize(document, JsonOptions));
        File.Move(tempPath, _filePath, overwrite: true);
    }

    private static PersistedCookie? ParseSetCookie(string header, Uri requestUri)
    {
        if (string.IsNullOrWhiteSpace(header)) return null;

        var segments = header.Split(';');
        var nameValue = segments[0].Trim();
        var separator = nameValue.IndexOf('=');
        if (separator <= 0) return null;

        var cookie = new PersistedCookie
        {
            Name = nameValue[..separator].Trim(),
            Value = nameValue[(separator + 1)..].Trim(),
            Domain = requestUri.Host,
            Path = DefaultPath(requestUri.AbsolutePath),
        };

        DateTimeOffset? maxAgeExpiry = null;
        for (var index = 1; index < segments.Length; index++)
        {
            var attribute = segments[index].Trim();
            var attributeSeparator = attribute.IndexOf('=');
            var key = (attributeSeparator >= 0 ? attribute[..attributeSeparator] : attribute).Trim();
            var value = attributeSeparator >= 0 ? attribute[(attributeSeparator + 1)..].Trim() : "";

            if (key.Equals("Domain", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(value))
            {
                cookie.Domain = value.ToLowerInvariant();
            }
            else if (key.Equals("Path", StringComparison.OrdinalIgnoreCase) && value.StartsWith('/'))
            {
                cookie.Path = NormalizePath(value);
            }
            else if (key.Equals("Expires", StringComparison.OrdinalIgnoreCase) &&
                     DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var expires))
            {
                cookie.ExpiresAt = expires.ToUniversalTime();
            }
            else if (key.Equals("Max-Age", StringComparison.OrdinalIgnoreCase) &&
                     long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var maxAge))
            {
                maxAgeExpiry = maxAge <= 0 ? DateTimeOffset.UnixEpoch : DateTimeOffset.UtcNow.AddSeconds(maxAge);
            }
            else if (key.Equals("Secure", StringComparison.OrdinalIgnoreCase))
            {
                cookie.Secure = true;
            }
            else if (key.Equals("HttpOnly", StringComparison.OrdinalIgnoreCase))
            {
                cookie.HttpOnly = true;
            }
        }

        if (maxAgeExpiry.HasValue) cookie.ExpiresAt = maxAgeExpiry;
        return string.IsNullOrWhiteSpace(cookie.Name) ? null : cookie;
    }

    private static bool RemoveExpiredLocked(List<PersistedCookie> cookies)
    {
        var before = cookies.Count;
        cookies.RemoveAll(IsExpired);
        return before != cookies.Count;
    }

    private static bool IsExpired(PersistedCookie cookie) =>
        cookie.ExpiresAt.HasValue && cookie.ExpiresAt.Value <= DateTimeOffset.UtcNow;

    private static string NormalizeWorkspaceId(string workspaceId) =>
        string.IsNullOrWhiteSpace(workspaceId) ? "default" : workspaceId.Trim();

    private static string NormalizeDomain(string domain) =>
        domain.Trim().TrimStart('.').ToLowerInvariant();

    private static string NormalizePath(string path) =>
        string.IsNullOrWhiteSpace(path) || !path.StartsWith('/') ? "/" : path;

    private static string DefaultPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !path.StartsWith('/')) return "/";
        var lastSlash = path.LastIndexOf('/');
        return lastSlash <= 0 ? "/" : path[..lastSlash];
    }
}
