using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Jint;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;
using Kvp = RequestLoom.Api.Models.KeyValuePair;

namespace RequestLoom.Api.Services;

/// <summary>
/// Matches incoming HTTP requests to mock server endpoints and generates responses.
/// Supports static responses, dynamic JavaScript responses, and small in-memory
/// OAuth2/OIDC provider behaviors intended for local integration testing only.
/// </summary>
public class MockServerService
{
    private readonly IMockServerRepository _repo;
    private readonly VariableResolutionService _variableResolver;
    private readonly ILogger<MockServerService> _logger;

    private static readonly HashSet<string> _runningServers = [];
    private static readonly ConcurrentDictionary<string, AuthorizationCodeState> _authorizationCodes = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, AccessTokenState> _accessTokens = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, RefreshTokenState> _refreshTokens = new(StringComparer.Ordinal);

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
    /// Handle an incoming mock request. The serverKey parameter can be a slug or id.
    /// requestOrigin is used as the default OIDC issuer when the behavior has no issuer configured.
    /// </summary>
    public async Task<MockServerResponse> HandleRequestAsync(
        string serverKey,
        string method,
        string path,
        string? body,
        IHeaderDictionary headers,
        string? requestOrigin = null)
    {
        var server = await _repo.GetBySlugAsync(serverKey, includeEndpoints: true)
                    ?? await _repo.GetByIdAsync(serverKey, includeEndpoints: true);
        if (server == null)
        {
            return ErrorResponse(404, "Mock server not found");
        }

        var endpoint = MatchEndpoint(server.Endpoints, method, path);
        if (endpoint == null)
        {
            _logger.LogWarning("No matching endpoint: {Method} {Path} on mock server {Server}",
                method, path, server.Name);
            return ErrorResponse(404, "No matching mock endpoint found");
        }

        if (endpoint.DelayMs > 0)
        {
            await Task.Delay(endpoint.DelayMs);
        }

        var responseBody = await _variableResolver.ResolveAsync(
            endpoint.ResponseBody,
            server.WorkspaceId,
            includeDynamicValues: false);
        var responseHeaders = await ResolveResponseHeadersAsync(endpoint, server.WorkspaceId);
        var behavior = MockEndpointBehaviors.Normalize(endpoint.Behavior);

        if (MockEndpointBehaviors.IsBuiltIn(behavior))
        {
            var configJson = await _variableResolver.ResolveAsync(
                endpoint.BehaviorConfigJson,
                server.WorkspaceId,
                includeDynamicValues: false);
            return await ExecuteBuiltInBehaviorAsync(
                behavior,
                server,
                method,
                path,
                body,
                headers,
                configJson,
                requestOrigin,
                endpoint.Id,
                responseHeaders);
        }

        var statusCode = endpoint.StatusCode;
        var contentType = endpoint.ContentType;
        if (endpoint.ScriptEnabled && !string.IsNullOrWhiteSpace(endpoint.Script))
        {
            try
            {
                var scriptResponse = ExecuteScript(
                    endpoint.Script,
                    method,
                    path,
                    body,
                    headers,
                    responseBody,
                    responseHeaders,
                    statusCode,
                    contentType,
                    ExtractPathParams(endpoint.Path, path));
                responseBody = scriptResponse.Body;
                statusCode = scriptResponse.StatusCode;
                contentType = scriptResponse.ContentType;

                foreach (var header in scriptResponse.Headers)
                {
                    responseHeaders.RemoveAll(existing => existing.Key.Equals(header.Key, StringComparison.OrdinalIgnoreCase));
                    responseHeaders.Add(new Kvp { Key = header.Key, Value = header.Value });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Script execution failed for endpoint {EndpointId}", endpoint.Id);
                return new MockServerResponse
                {
                    StatusCode = 500,
                    ContentType = "application/json",
                    Body = JsonSerializer.Serialize(new { error = "Mock script error", message = ex.Message }),
                    Headers = DefaultHeaders("application/json"),
                    Matched = true,
                    MatchedEndpointId = endpoint.Id
                };
            }
        }

        AddDefaultHeaders(responseHeaders, contentType);
        return new MockServerResponse
        {
            StatusCode = statusCode,
            ContentType = contentType,
            Body = responseBody,
            Headers = responseHeaders,
            Matched = true,
            MatchedEndpointId = endpoint.Id
        };
    }

    private async Task<List<Kvp>> ResolveResponseHeadersAsync(MockServerEndpoint endpoint, string workspaceId)
    {
        var responseHeaders = new List<Kvp>();
        try
        {
            if (!string.IsNullOrWhiteSpace(endpoint.ResponseHeadersJson))
            {
                var headerList = JsonSerializer.Deserialize<List<KeyValuePairRequest>>(endpoint.ResponseHeadersJson);
                if (headerList != null)
                {
                    foreach (var header in headerList.Where(header => header.Enabled && !string.IsNullOrWhiteSpace(header.Key)))
                    {
                        var resolvedValue = await _variableResolver.ResolveAsync(
                            header.Value,
                            workspaceId,
                            includeDynamicValues: false);
                        responseHeaders.Add(new Kvp { Key = header.Key.Trim(), Value = resolvedValue });
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse response headers for endpoint {EndpointId}", endpoint.Id);
        }

        return responseHeaders;
    }

    private async Task<MockServerResponse> ExecuteBuiltInBehaviorAsync(
        string behavior,
        MockServer server,
        string method,
        string path,
        string? body,
        IHeaderDictionary headers,
        string configJson,
        string? requestOrigin,
        string endpointId,
        List<Kvp> responseHeaders)
    {
        var config = ParseBehaviorConfig(configJson);
        var issuer = ResolveIssuer(server, config, requestOrigin);

        MockServerResponse result = behavior switch
        {
            MockEndpointBehaviors.OAuth2Authorization => HandleAuthorizationRequest(
                server, method, path, config, endpointId),
            MockEndpointBehaviors.OAuth2Token => HandleTokenRequest(
                server, method, body, headers, config, issuer, endpointId),
            MockEndpointBehaviors.OidcDiscovery => DiscoveryResponse(
                server, config, issuer, endpointId),
            MockEndpointBehaviors.OidcUserInfo => UserInfoResponse(
                server, headers, config, endpointId),
            MockEndpointBehaviors.OidcJwks => JwksResponse(
                config, endpointId),
            _ => ErrorResponse(500, "Unsupported mock behavior", endpointId),
        };

        foreach (var header in responseHeaders)
        {
            result.Headers.RemoveAll(existing => existing.Key.Equals(header.Key, StringComparison.OrdinalIgnoreCase));
            result.Headers.Add(header);
        }

        AddDefaultHeaders(result.Headers, result.ContentType);
        result.Matched = true;
        result.MatchedEndpointId = endpointId;
        return await Task.FromResult(result);
    }

    private static MockServerResponse HandleAuthorizationRequest(
        MockServer server,
        string method,
        string path,
        MockBehaviorConfig config,
        string endpointId)
    {
        if (!method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            return ErrorResponse(405, "Authorization endpoint requires GET", endpointId);

        var query = ParseQuery(path);
        var clientId = Get(query, "client_id");
        var redirectUri = Get(query, "redirect_uri");
        var responseType = Get(query, "response_type");
        var state = Get(query, "state");

        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(redirectUri) || string.IsNullOrWhiteSpace(responseType))
            return ErrorResponse(400, "invalid_request", endpointId, new { error_description = "client_id, redirect_uri, and response_type are required" });

        if (!string.IsNullOrWhiteSpace(config.ClientId) && !clientId.Equals(config.ClientId, StringComparison.Ordinal))
            return AuthorizationError(redirectUri, state, "unauthorized_client", endpointId);

        if (!responseType.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Contains("code", StringComparer.OrdinalIgnoreCase))
            return AuthorizationError(redirectUri, state, "unsupported_response_type", endpointId);

        if (!Uri.TryCreate(redirectUri, UriKind.Absolute, out var redirect) ||
            (redirect.Scheme != Uri.UriSchemeHttp && redirect.Scheme != Uri.UriSchemeHttps))
            return ErrorResponse(400, "invalid_request", endpointId, new { error_description = "redirect_uri must be an absolute http/https URL" });

        var code = CreateOpaqueToken("mock_code_");
        _authorizationCodes[code] = new AuthorizationCodeState
        {
            ServerId = server.Id,
            ClientId = clientId,
            RedirectUri = redirectUri,
            CodeChallenge = Get(query, "code_challenge"),
            CodeChallengeMethod = Get(query, "code_challenge_method") ?? "plain",
            Scope = Get(query, "scope") ?? config.Scope,
            Subject = config.Subject,
            Nonce = Get(query, "nonce"),
            ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(5),
        };

        var callback = QueryHelpers.AddQueryString(redirectUri, new Dictionary<string, string?>
        {
            ["code"] = code,
            ["state"] = string.IsNullOrWhiteSpace(state) ? null : state,
        });

        return new MockServerResponse
        {
            StatusCode = StatusCodes.Status302Found,
            ContentType = "text/plain",
            Body = "",
            Headers =
            [
                new Kvp { Key = "Location", Value = callback },
                new Kvp { Key = "Cache-Control", Value = "no-store" },
                new Kvp { Key = "Pragma", Value = "no-cache" },
            ],
            Matched = true,
            MatchedEndpointId = endpointId,
        };
    }

    private static MockServerResponse HandleTokenRequest(
        MockServer server,
        string method,
        string? body,
        IHeaderDictionary headers,
        MockBehaviorConfig config,
        string issuer,
        string endpointId)
    {
        if (!method.Equals("POST", StringComparison.OrdinalIgnoreCase))
            return ErrorResponse(405, "Token endpoint requires POST", endpointId);

        var form = ParseForm(body);
        var basicCredentials = ParseBasicCredentials(headers);
        var clientId = Get(form, "client_id") ?? basicCredentials.ClientId ?? "";
        var clientSecret = Get(form, "client_secret") ?? basicCredentials.ClientSecret;

        if (!string.IsNullOrWhiteSpace(config.ClientId) && !clientId.Equals(config.ClientId, StringComparison.Ordinal))
            return ErrorResponse(401, "invalid_client", endpointId);
        if (!string.IsNullOrWhiteSpace(config.ClientSecret) && !string.Equals(clientSecret, config.ClientSecret, StringComparison.Ordinal))
            return ErrorResponse(401, "invalid_client", endpointId);

        var grantType = Get(form, "grant_type") ?? "authorization_code";
        return grantType switch
        {
            "authorization_code" => ExchangeAuthorizationCode(server, form, config, issuer, clientId, endpointId),
            "refresh_token" => ExchangeRefreshToken(server, form, config, issuer, clientId, endpointId),
            "client_credentials" => IssueTokenResponse(server, config, issuer, clientId, "client", Get(form, "scope"), false, null, endpointId),
            _ => ErrorResponse(400, "unsupported_grant_type", endpointId),
        };
    }

    private static MockServerResponse ExchangeAuthorizationCode(
        MockServer server,
        Dictionary<string, string> form,
        MockBehaviorConfig config,
        string issuer,
        string clientId,
        string endpointId)
    {
        var code = Get(form, "code");
        if (string.IsNullOrWhiteSpace(code) || !_authorizationCodes.TryRemove(code, out var authorization))
            return ErrorResponse(400, "invalid_grant", endpointId);

        if (authorization.ServerId != server.Id || authorization.ExpiresAt <= DateTimeOffset.UtcNow ||
            !authorization.ClientId.Equals(clientId, StringComparison.Ordinal))
            return ErrorResponse(400, "invalid_grant", endpointId);

        var redirectUri = Get(form, "redirect_uri");
        if (!string.IsNullOrWhiteSpace(authorization.RedirectUri) && !authorization.RedirectUri.Equals(redirectUri, StringComparison.Ordinal))
            return ErrorResponse(400, "invalid_grant", endpointId);

        if (!VerifyCodeVerifier(authorization, Get(form, "code_verifier")))
            return ErrorResponse(400, "invalid_grant", endpointId, new { error_description = "PKCE verification failed" });

        var scope = string.IsNullOrWhiteSpace(authorization.Scope) ? config.Scope : authorization.Scope;
        return IssueTokenResponse(server, config, issuer, clientId, authorization.Subject, scope, HasOpenIdScope(scope), authorization.Nonce, endpointId);
    }

    private static MockServerResponse ExchangeRefreshToken(
        MockServer server,
        Dictionary<string, string> form,
        MockBehaviorConfig config,
        string issuer,
        string clientId,
        string endpointId)
    {
        var refreshToken = Get(form, "refresh_token");
        if (string.IsNullOrWhiteSpace(refreshToken) || !_refreshTokens.TryGetValue(refreshToken, out var stored) ||
            stored.ExpiresAt <= DateTimeOffset.UtcNow || stored.ServerId != server.Id ||
            (!string.IsNullOrWhiteSpace(stored.ClientId) && !stored.ClientId.Equals(clientId, StringComparison.Ordinal)))
            return ErrorResponse(400, "invalid_grant", endpointId);

        return IssueTokenResponse(server, config, issuer, clientId, stored.Subject, stored.Scope, HasOpenIdScope(stored.Scope), stored.Nonce, endpointId, refreshToken);
    }

    private static MockServerResponse IssueTokenResponse(
        MockServer server,
        MockBehaviorConfig config,
        string issuer,
        string clientId,
        string subject,
        string? scope,
        bool includeIdToken,
        string? nonce,
        string endpointId,
        string? previousRefreshToken = null)
    {
        var expiresIn = Math.Clamp(config.TokenTtlSeconds, 1, 86400);
        var expiresAt = DateTimeOffset.UtcNow.AddSeconds(expiresIn);
        var normalizedScope = string.IsNullOrWhiteSpace(scope) ? config.Scope : scope.Trim();
        var accessToken = CreateOpaqueToken("mock_access_");
        var refreshToken = previousRefreshToken ?? CreateOpaqueToken("mock_refresh_");

        _accessTokens[accessToken] = new AccessTokenState
        {
            ServerId = server.Id,
            ClientId = clientId,
            Subject = subject,
            Scope = normalizedScope,
            ExpiresAt = expiresAt,
        };
        _refreshTokens[refreshToken] = new RefreshTokenState
        {
            ServerId = server.Id,
            ClientId = clientId,
            Subject = subject,
            Scope = normalizedScope,
            Nonce = nonce,
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(30),
        };

        var payload = new Dictionary<string, object?>
        {
            ["access_token"] = accessToken,
            ["token_type"] = "Bearer",
            ["expires_in"] = expiresIn,
            ["refresh_token"] = refreshToken,
            ["scope"] = normalizedScope,
        };
        if (includeIdToken)
        {
            payload["id_token"] = CreateUnsignedIdToken(issuer, clientId, subject, expiresAt, nonce, config);
        }

        return JsonResponse(200, payload, endpointId);
    }

    private static MockServerResponse DiscoveryResponse(
        MockServer server,
        MockBehaviorConfig config,
        string issuer,
        string endpointId)
    {
        var authorizationEndpoint = config.AuthorizationEndpoint ?? $"{issuer}/oauth/authorize";
        var tokenEndpoint = config.TokenEndpoint ?? $"{issuer}/oauth/token";
        var userinfoEndpoint = config.UserinfoEndpoint ?? $"{issuer}/userinfo";
        var jwksUri = config.JwksUri ?? $"{issuer}/.well-known/jwks.json";

        return JsonResponse(200, new Dictionary<string, object?>
        {
            ["issuer"] = issuer,
            ["authorization_endpoint"] = authorizationEndpoint,
            ["token_endpoint"] = tokenEndpoint,
            ["userinfo_endpoint"] = userinfoEndpoint,
            ["jwks_uri"] = jwksUri,
            ["response_types_supported"] = new[] { "code" },
            ["grant_types_supported"] = new[] { "authorization_code", "refresh_token", "client_credentials" },
            ["scopes_supported"] = SplitScopes(config.Scope),
            ["subject_types_supported"] = new[] { "public" },
            ["id_token_signing_alg_values_supported"] = new[] { "none" },
            ["token_endpoint_auth_methods_supported"] = new[] { "client_secret_post", "client_secret_basic" },
            ["code_challenge_methods_supported"] = new[] { "S256", "plain" },
        }, endpointId);
    }

    private static MockServerResponse UserInfoResponse(
        MockServer server,
        IHeaderDictionary headers,
        MockBehaviorConfig config,
        string endpointId)
    {
        var token = GetBearerToken(headers);
        if (string.IsNullOrWhiteSpace(token) || !_accessTokens.TryGetValue(token, out var access) ||
            access.ServerId != server.Id || access.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            return new MockServerResponse
            {
                StatusCode = 401,
                ContentType = "application/json",
                Body = JsonSerializer.Serialize(new { error = "invalid_token" }),
                Headers =
                [
                    new Kvp { Key = "WWW-Authenticate", Value = "Bearer error=\"invalid_token\"" },
                ],
                Matched = true,
                MatchedEndpointId = endpointId,
            };
        }

        return JsonResponse(200, new Dictionary<string, object?>
        {
            ["sub"] = access.Subject,
            ["name"] = config.Name,
            ["preferred_username"] = config.PreferredUsername,
            ["email"] = config.Email,
            ["email_verified"] = true,
        }, endpointId);
    }

    private static MockServerResponse JwksResponse(MockBehaviorConfig config, string endpointId)
    {
        if (!string.IsNullOrWhiteSpace(config.JwksJson))
        {
            try
            {
                using var document = JsonDocument.Parse(config.JwksJson);
                if (document.RootElement.ValueKind == JsonValueKind.Object)
                {
                    return JsonResponse(200, document.RootElement, endpointId);
                }
            }
            catch (JsonException)
            {
                // Fall through to an empty but valid JWKS document.
            }
        }

        return JsonResponse(200, new { keys = Array.Empty<object>() }, endpointId);
    }

    private static MockServerResponse AuthorizationError(string redirectUri, string? state, string error, string endpointId)
    {
        if (!Uri.TryCreate(redirectUri, UriKind.Absolute, out var redirect) ||
            (redirect.Scheme != Uri.UriSchemeHttp && redirect.Scheme != Uri.UriSchemeHttps))
            return ErrorResponse(400, error, endpointId);

        var callback = QueryHelpers.AddQueryString(redirectUri, new Dictionary<string, string?>
        {
            ["error"] = error,
            ["state"] = string.IsNullOrWhiteSpace(state) ? null : state,
        });
        return new MockServerResponse
        {
            StatusCode = StatusCodes.Status302Found,
            ContentType = "text/plain",
            Headers = [new Kvp { Key = "Location", Value = callback }],
            Matched = true,
            MatchedEndpointId = endpointId,
        };
    }

    private static bool VerifyCodeVerifier(AuthorizationCodeState authorization, string? verifier)
    {
        if (string.IsNullOrWhiteSpace(authorization.CodeChallenge)) return true;
        if (string.IsNullOrWhiteSpace(verifier)) return false;

        var computed = authorization.CodeChallengeMethod.Equals("S256", StringComparison.OrdinalIgnoreCase)
            ? Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)))
            : verifier;
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(computed),
            Encoding.ASCII.GetBytes(authorization.CodeChallenge));
    }

    private static string CreateUnsignedIdToken(
        string issuer,
        string clientId,
        string subject,
        DateTimeOffset expiresAt,
        string? nonce,
        MockBehaviorConfig config)
    {
        var header = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { alg = "none", typ = "JWT" }));
        var payload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object?>
        {
            ["iss"] = issuer,
            ["aud"] = clientId,
            ["sub"] = subject,
            ["name"] = config.Name,
            ["email"] = config.Email,
            ["iat"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            ["exp"] = expiresAt.ToUnixTimeSeconds(),
            ["nonce"] = string.IsNullOrWhiteSpace(nonce) ? null : nonce,
        }));
        return $"{header}.{payload}.";
    }

    private static string ResolveIssuer(MockServer server, MockBehaviorConfig config, string? requestOrigin)
    {
        if (Uri.TryCreate(config.Issuer, UriKind.Absolute, out var configured) &&
            (configured.Scheme == Uri.UriSchemeHttp || configured.Scheme == Uri.UriSchemeHttps))
            return config.Issuer!.TrimEnd('/');

        var origin = NormalizeOrigin(requestOrigin) ?? "http://localhost:5056";
        return $"{origin}/mock/{server.Slug}";
    }

    private static MockBehaviorConfig ParseBehaviorConfig(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new MockBehaviorConfig();
        try
        {
            return JsonSerializer.Deserialize<MockBehaviorConfig>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            }) ?? new MockBehaviorConfig();
        }
        catch (JsonException)
        {
            return new MockBehaviorConfig();
        }
    }

    private static Dictionary<string, string> ParseQuery(string path)
    {
        var queryIndex = path.IndexOf('?');
        if (queryIndex < 0 || queryIndex == path.Length - 1)
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        return QueryHelpers.ParseQuery(path[(queryIndex + 1)..])
            .ToDictionary(pair => pair.Key, pair => pair.Value.ToString(), StringComparer.OrdinalIgnoreCase);
    }

    private static Dictionary<string, string> ParseForm(string? body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        return QueryHelpers.ParseQuery(body)
            .ToDictionary(pair => pair.Key, pair => pair.Value.ToString(), StringComparer.OrdinalIgnoreCase);
    }

    private static (string? ClientId, string? ClientSecret) ParseBasicCredentials(IHeaderDictionary headers)
    {
        var authorization = GetHeader(headers, "Authorization");
        if (string.IsNullOrWhiteSpace(authorization) || !authorization.StartsWith("Basic ", StringComparison.OrdinalIgnoreCase))
            return (null, null);

        try
        {
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(authorization[6..].Trim()));
            var separator = decoded.IndexOf(':');
            return separator < 0
                ? (decoded, "")
                : (decoded[..separator], decoded[(separator + 1)..]);
        }
        catch (FormatException)
        {
            return (null, null);
        }
    }

    private static string? GetBearerToken(IHeaderDictionary headers)
    {
        var authorization = GetHeader(headers, "Authorization");
        return authorization?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true
            ? authorization[7..].Trim()
            : null;
    }

    private static string? GetHeader(IHeaderDictionary headers, string key)
    {
        return headers.TryGetValue(key, out var value) ? value.ToString() : null;
    }

    private static string? Get(IReadOnlyDictionary<string, string> values, string key)
    {
        return values.TryGetValue(key, out var value) ? value : null;
    }

    private static bool HasOpenIdScope(string? scope) =>
        SplitScopes(scope).Contains("openid", StringComparer.OrdinalIgnoreCase);

    private static string[] SplitScopes(string? scope) =>
        (scope ?? "openid profile email")
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static string CreateOpaqueToken(string prefix) =>
        prefix + Base64Url(RandomNumberGenerator.GetBytes(32));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string? NormalizeOrigin(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            return null;
        return $"{uri.Scheme}://{uri.Authority}";
    }

    private static MockServerResponse JsonResponse(int statusCode, object body, string endpointId)
    {
        return new MockServerResponse
        {
            StatusCode = statusCode,
            ContentType = "application/json",
            Body = JsonSerializer.Serialize(body),
            Headers = [],
            Matched = true,
            MatchedEndpointId = endpointId,
        };
    }

    private static MockServerResponse ErrorResponse(int statusCode, string error, string endpointId = "", object? extra = null)
    {
        var payload = new Dictionary<string, object?> { ["error"] = error };
        if (extra != null)
        {
            foreach (var property in JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(extra)) ?? [])
                payload[property.Key] = property.Value;
        }

        return JsonResponse(statusCode, payload, endpointId);
    }

    private static List<Kvp> DefaultHeaders(string contentType)
    {
        var headers = new List<Kvp>();
        AddDefaultHeaders(headers, contentType);
        return headers;
    }

    private static void AddDefaultHeaders(List<Kvp> headers, string contentType)
    {
        if (!headers.Any(header => header.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)))
            headers.Add(new Kvp { Key = "Content-Type", Value = contentType });
        if (!headers.Any(header => header.Key.Equals("Access-Control-Allow-Origin", StringComparison.OrdinalIgnoreCase)))
            headers.Add(new Kvp { Key = "Access-Control-Allow-Origin", Value = "*" });
    }

    /// <summary>Match exact paths before {parameter} paths.</summary>
    private static MockServerEndpoint? MatchEndpoint(List<MockServerEndpoint> endpoints, string method, string path)
    {
        var normalizedMethod = method.ToUpperInvariant();
        var queryIndex = path.IndexOf('?');
        var pathOnly = queryIndex >= 0 ? path[..queryIndex] : path;
        var normalizedPath = pathOnly.TrimEnd('/');
        if (string.IsNullOrEmpty(normalizedPath)) normalizedPath = "/";

        var candidates = endpoints
            .Where(endpoint => endpoint.Method.Equals(normalizedMethod, StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (candidates.Count == 0) return null;

        var exact = candidates.FirstOrDefault(endpoint =>
            endpoint.Path.TrimEnd('/').Equals(normalizedPath, StringComparison.OrdinalIgnoreCase));
        if (exact != null) return exact;

        return candidates
            .OrderBy(endpoint => endpoint.SortOrder)
            .FirstOrDefault(endpoint => PathMatchesPattern(endpoint.Path, normalizedPath));
    }

    private static bool PathMatchesPattern(string pattern, string requestPath)
    {
        var patternSegments = pattern.Trim('/').Split('/');
        var pathSegments = requestPath.Trim('/').Split('/');
        if (patternSegments.Length != pathSegments.Length) return false;

        for (var index = 0; index < patternSegments.Length; index++)
        {
            var patternSegment = patternSegments[index];
            if (patternSegment.StartsWith('{') && patternSegment.EndsWith('}')) continue;
            if (!patternSegment.Equals(pathSegments[index], StringComparison.OrdinalIgnoreCase)) return false;
        }

        return true;
    }

    private static Dictionary<string, string> ExtractPathParams(string pattern, string requestPath)
    {
        var result = new Dictionary<string, string>();
        var queryIndex = requestPath.IndexOf('?');
        var pathOnly = queryIndex >= 0 ? requestPath[..queryIndex] : requestPath;
        var patternSegments = pattern.Trim('/').Split('/');
        var pathSegments = pathOnly.Trim('/').Split('/');
        if (patternSegments.Length != pathSegments.Length) return result;

        for (var index = 0; index < patternSegments.Length; index++)
        {
            var segment = patternSegments[index];
            if (segment.StartsWith('{') && segment.EndsWith('}'))
                result[segment[1..^1]] = Uri.UnescapeDataString(pathSegments[index]);
        }

        return result;
    }

    private static ScriptResponse ExecuteScript(
        string script,
        string method,
        string path,
        string? body,
        IHeaderDictionary headers,
        string currentResponseBody,
        List<Kvp> currentHeaders,
        int currentStatusCode,
        string currentContentType,
        Dictionary<string, string> pathParams)
    {
        var engine = new Engine(options =>
        {
            options.TimeoutInterval(TimeSpan.FromSeconds(10));
            options.LimitRecursion(64);
        });

        var requestObject = new Dictionary<string, object?>
        {
            ["method"] = method,
            ["path"] = path,
            ["body"] = body ?? "",
            ["headers"] = headers.ToDictionary(header => header.Key, header => (object?)header.Value.ToString()),
            ["queryParams"] = ParseQuery(path),
            ["pathParams"] = pathParams,
        };
        var responseObject = new Dictionary<string, object?>
        {
            ["statusCode"] = currentStatusCode,
            ["contentType"] = currentContentType,
            ["body"] = currentResponseBody,
            ["headers"] = currentHeaders.ToDictionary(header => header.Key, header => (object?)header.Value, StringComparer.OrdinalIgnoreCase),
        };

        engine.SetValue("request", requestObject);
        engine.SetValue("response", responseObject);
        var result = engine.Evaluate(script);
        var modifiedResponse = engine.GetValue("response");
        if (!modifiedResponse.IsObject())
            return new ScriptResponse(currentStatusCode, currentContentType, currentResponseBody, currentHeaders.ToDictionary(h => h.Key, h => h.Value));

        var response = modifiedResponse.AsObject();
        var responseJson = engine.Invoke(
            engine.GetValue("JSON").AsObject().Get("stringify"),
            new object[] { response }).ToString();
        using var responseDocument = JsonDocument.Parse(responseJson);
        var root = responseDocument.RootElement;

        var statusCode = root.TryGetProperty("statusCode", out var status) && status.TryGetInt32(out var parsedStatus)
            ? parsedStatus
            : currentStatusCode;
        var contentType = root.TryGetProperty("contentType", out var type) && type.ValueKind == JsonValueKind.String
            ? type.GetString() ?? currentContentType
            : currentContentType;
        var responseBody = currentResponseBody;
        if (root.TryGetProperty("body", out var responseBodyElement))
        {
            responseBody = responseBodyElement.ValueKind == JsonValueKind.String
                ? responseBodyElement.GetString() ?? ""
                : responseBodyElement.GetRawText();
        }

        var responseHeaders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (root.TryGetProperty("headers", out var responseHeadersElement) && responseHeadersElement.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in responseHeadersElement.EnumerateObject())
            {
                responseHeaders[property.Name] = property.Value.ValueKind == JsonValueKind.String
                    ? property.Value.GetString() ?? ""
                    : property.Value.GetRawText();
            }
        }

        if (!result.IsUndefined() && !result.IsNull() &&
            string.Equals(responseBody, currentResponseBody, StringComparison.Ordinal))
        {
            responseBody = result.ToString() ?? responseBody;
        }

        return new ScriptResponse(statusCode, contentType, responseBody, responseHeaders);
    }

    private sealed class MockBehaviorConfig
    {
        public string? Issuer { get; set; }
        public string? AuthorizationEndpoint { get; set; }
        public string? TokenEndpoint { get; set; }
        public string? UserinfoEndpoint { get; set; }
        public string? JwksUri { get; set; }
        public string? ClientId { get; set; }
        public string? ClientSecret { get; set; }
        public string Scope { get; set; } = "openid profile email";
        public int TokenTtlSeconds { get; set; } = 3600;
        public string Subject { get; set; } = "user-1";
        public string Name { get; set; } = "Jane Doe";
        public string PreferredUsername { get; set; } = "jane.doe";
        public string Email { get; set; } = "jane@example.com";
        public string? JwksJson { get; set; }
    }

    private sealed class AuthorizationCodeState
    {
        public string ServerId { get; set; } = "";
        public string ClientId { get; set; } = "";
        public string RedirectUri { get; set; } = "";
        public string? CodeChallenge { get; set; }
        public string CodeChallengeMethod { get; set; } = "plain";
        public string Scope { get; set; } = "";
        public string Subject { get; set; } = "";
        public string? Nonce { get; set; }
        public DateTimeOffset ExpiresAt { get; set; }
    }

    private sealed class AccessTokenState
    {
        public string ServerId { get; set; } = "";
        public string ClientId { get; set; } = "";
        public string Subject { get; set; } = "";
        public string Scope { get; set; } = "";
        public DateTimeOffset ExpiresAt { get; set; }
    }

    private sealed class RefreshTokenState
    {
        public string ServerId { get; set; } = "";
        public string ClientId { get; set; } = "";
        public string Subject { get; set; } = "";
        public string Scope { get; set; } = "";
        public string? Nonce { get; set; }
        public DateTimeOffset ExpiresAt { get; set; }
    }

    private sealed record ScriptResponse(
        int StatusCode,
        string ContentType,
        string Body,
        Dictionary<string, string> Headers);
}
