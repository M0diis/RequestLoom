using System.Text.Json;
using Jint;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;
using Kvp = RequestLoom.Api.Models.KeyValuePair;

namespace RequestLoom.Api.Services;

/// <summary>
/// Matches incoming HTTP requests to mock server endpoints and generates responses.
/// Supports static JSON responses and dynamic JavaScript-driven responses via Jint.
/// </summary>
public class MockServerService
{
    private readonly IMockServerRepository _repo;
    private readonly VariableResolutionService _variableResolver;
    private readonly ILogger<MockServerService> _logger;

    // Track which mock servers are actively listening
    private static readonly HashSet<string> _runningServers = [];

    public MockServerService(
        IMockServerRepository repo,
        VariableResolutionService variableResolver,
        ILogger<MockServerService> logger)
    {
        _repo = repo;
        _variableResolver = variableResolver;
        _logger = logger;
    }

    public static bool IsRunning(string serverId) => _runningServers.Contains(serverId);

    public static void SetRunning(string serverId, bool running)
    {
        if (running) _runningServers.Add(serverId);
        else _runningServers.Remove(serverId);
    }

    /// <summary>
    /// Handle an incoming mock request: match endpoint, execute script (if any), return response.
    /// The serverKey parameter can be either a slug or an id.
    /// </summary>
    public async Task<MockServerResponse> HandleRequestAsync(
        string serverKey, string method, string path, string? body, IHeaderDictionary headers)
    {
        // Try slug first, then id
        var server = await _repo.GetBySlugAsync(serverKey, includeEndpoints: true)
                    ?? await _repo.GetByIdAsync(serverKey, includeEndpoints: true);
        if (server == null)
        {
            return new MockServerResponse
            {
                StatusCode = 404,
                ContentType = "application/json",
                Body = """{"error":"Mock server not found"}""",
                Matched = false
            };
        }

        // Find matching endpoint
        var endpoint = MatchEndpoint(server.Endpoints, method, path);
        if (endpoint == null)
        {
            _logger.LogWarning("No matching endpoint: {Method} {Path} on mock server {Server}",
                method, path, server.Name);

            return new MockServerResponse
            {
                StatusCode = 404,
                ContentType = "application/json",
                Body = """{"error":"No matching mock endpoint found"}""",
                Matched = false
            };
        }

        // Optional delay
        if (endpoint.DelayMs > 0)
        {
            await Task.Delay(endpoint.DelayMs);
        }

        // Resolve variables in response body
        var responseBody = await _variableResolver.ResolveAsync(endpoint.ResponseBody, server.WorkspaceId, includeDynamicValues: false);

        // Parse response headers
        var responseHeaders = new List<Kvp>();
        try
        {
            if (!string.IsNullOrWhiteSpace(endpoint.ResponseHeadersJson))
            {
                var headerList = JsonSerializer.Deserialize<List<KeyValuePairRequest>>(endpoint.ResponseHeadersJson);
                if (headerList != null)
                {
                    foreach (var h in headerList.Where(h => h.Enabled))
                    {
                        var resolvedValue = await _variableResolver.ResolveAsync(h.Value, server.WorkspaceId, includeDynamicValues: false);
                        responseHeaders.Add(new Kvp { Key = h.Key, Value = resolvedValue });
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse response headers for endpoint {EndpointId}", endpoint.Id);
        }

        // Execute script if enabled
        if (endpoint.ScriptEnabled && !string.IsNullOrWhiteSpace(endpoint.Script))
        {
            try
            {
                // Extract path parameters from the matched endpoint pattern
                var pathParams = ExtractPathParams(endpoint.Path, path);
                responseBody = ExecuteScript(endpoint.Script, method, path, body, headers, responseBody, pathParams);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Script execution failed for endpoint {EndpointId}", endpoint.Id);
                return new MockServerResponse
                {
                    StatusCode = 500,
                    ContentType = "application/json",
                    Body = JsonSerializer.Serialize(new { error = "Mock script error", message = ex.Message }),
                    Matched = true,
                    MatchedEndpointId = endpoint.Id
                };
            }
        }

        // Add default Content-Type if not specified in custom headers
        if (!responseHeaders.Any(h => h.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)))
        {
            responseHeaders.Add(new Kvp { Key = "Content-Type", Value = endpoint.ContentType });
        }

        // Add CORS header for browser access
        if (!responseHeaders.Any(h => h.Key.Equals("Access-Control-Allow-Origin", StringComparison.OrdinalIgnoreCase)))
        {
            responseHeaders.Add(new Kvp { Key = "Access-Control-Allow-Origin", Value = "*" });
        }

        return new MockServerResponse
        {
            StatusCode = endpoint.StatusCode,
            ContentType = endpoint.ContentType,
            Body = responseBody,
            Headers = responseHeaders,
            Matched = true,
            MatchedEndpointId = endpoint.Id
        };
    }

    /// <summary>
    /// Match an incoming request to the best endpoint definition.
    /// Priority: exact path match > path parameter match > wildcard
    /// </summary>
    private static MockServerEndpoint? MatchEndpoint(List<MockServerEndpoint> endpoints, string method, string path)
    {
        var normalizedMethod = method.ToUpperInvariant();

        // Strip query string — it's not part of the path for matching purposes
        var qIdx = path.IndexOf('?');
        var pathOnly = qIdx >= 0 ? path[..qIdx] : path;
        var normalizedPath = pathOnly.TrimEnd('/');
        if (string.IsNullOrEmpty(normalizedPath)) normalizedPath = "/";

        // Filter by method
        var candidates = endpoints
            .Where(e => e.Method.Equals(normalizedMethod, StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (candidates.Count == 0) return null;

        // Try exact match first
        var exact = candidates.FirstOrDefault(e =>
            e.Path.TrimEnd('/').Equals(normalizedPath, StringComparison.OrdinalIgnoreCase));
        if (exact != null) return exact;

        // Try parameterized paths (e.g., /users/{id} matching /users/123)
        foreach (var ep in candidates.OrderBy(e => e.SortOrder))
        {
            if (PathMatchesPattern(ep.Path, normalizedPath))
                return ep;
        }

        return null;
    }

    /// <summary>
    /// Check if a request path matches an endpoint's path pattern.
    /// Supports {param} style path parameters.
    /// </summary>
    private static bool PathMatchesPattern(string pattern, string requestPath)
    {
        var patternSegments = pattern.Trim('/').Split('/');
        var pathSegments = requestPath.Trim('/').Split('/');

        if (patternSegments.Length != pathSegments.Length) return false;

        for (int i = 0; i < patternSegments.Length; i++)
        {
            var ps = patternSegments[i];
            var rs = pathSegments[i];

            // {param} matches anything
            if (ps.StartsWith('{') && ps.EndsWith('}'))
                continue;

            if (!ps.Equals(rs, StringComparison.OrdinalIgnoreCase))
                return false;
        }

        return true;
    }

    /// <summary>
    /// Extract path parameter values from a request path using the endpoint's pattern.
    /// E.g., pattern "/api/users/{id}" + path "/api/users/42" → { "id": "42" }
    /// </summary>
    private static Dictionary<string, string> ExtractPathParams(string pattern, string requestPath)
    {
        var result = new Dictionary<string, string>();

        // Strip query string from request path
        var qIdx = requestPath.IndexOf('?');
        var pathOnly = qIdx >= 0 ? requestPath[..qIdx] : requestPath;

        var patternSegments = pattern.Trim('/').Split('/');
        var pathSegments = pathOnly.Trim('/').Split('/');

        if (patternSegments.Length != pathSegments.Length)
            return result;

        for (int i = 0; i < patternSegments.Length; i++)
        {
            var ps = patternSegments[i];
            if (ps.StartsWith('{') && ps.EndsWith('}'))
            {
                var paramName = ps[1..^1];
                result[paramName] = Uri.UnescapeDataString(pathSegments[i]);
            }
        }

        return result;
    }

    /// <summary>
    /// Execute a JavaScript script that can transform the response.
    /// The script has access to:
    ///   - request: { method, path, body, headers, queryParams, pathParams }
    ///   - response: { statusCode, body, headers }
    ///   - context: { mockServerId, endpointId }
    ///   - The return value of the script becomes the new response body.
    /// </summary>
    private string ExecuteScript(
        string script, string method, string path, string? body,
        IHeaderDictionary headers, string currentResponseBody,
        Dictionary<string, string>? pathParams = null)
    {
        var engine = new Engine(options =>
        {
            options.TimeoutInterval(TimeSpan.FromSeconds(10));
            options.LimitRecursion(64);
        });

        // Parse path params — use extracted values from the endpoint pattern match
        // (These are populated by ExtractPathParams before this method is called)
        pathParams ??= new Dictionary<string, string>();

        // Parse query params
        var queryParams = new Dictionary<string, string>();
        var queryIndex = path.IndexOf('?');
        if (queryIndex >= 0)
        {
            var query = path[(queryIndex + 1)..];
            foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = pair.Split('=', 2);
                var key = Uri.UnescapeDataString(parts[0]);
                var val = parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : "";
                queryParams[key] = val;
            }
        }

        // Build request object
        var requestObj = new Dictionary<string, object?>
        {
            ["method"] = method,
            ["path"] = path,
            ["body"] = body ?? "",
            ["headers"] = headers.ToDictionary(h => h.Key, h => (object?)h.Value.ToString()),
            ["queryParams"] = queryParams,
            ["pathParams"] = pathParams
        };

        var responseObj = new Dictionary<string, object?>
        {
            ["statusCode"] = 200,
            ["body"] = currentResponseBody,
            ["headers"] = new Dictionary<string, object?>()
        };

        engine.SetValue("request", requestObj);
        engine.SetValue("response", responseObj);

        // Execute script
        var result = engine.Evaluate(script);

        // Check if script modified the response object
        var modifiedResponse = engine.GetValue("response");
        if (modifiedResponse.IsObject())
        {
            var respObj = modifiedResponse.AsObject();
            if (respObj.TryGetValue("body", out var bodyVal))
            {
                return bodyVal.ToString() ?? currentResponseBody;
            }
        }

        // If return value is not undefined/null, use it as body
        if (!result.IsUndefined() && !result.IsNull())
        {
            return result.ToString() ?? currentResponseBody;
        }

        return currentResponseBody;
    }
}
