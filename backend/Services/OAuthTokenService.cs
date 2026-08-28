using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

/// <summary>
/// Keeps OAuth access/refresh tokens in process memory. Tokens are deliberately
/// not written to request JSON, SQLite, or the JSON storage backend.
/// </summary>
public sealed class OAuthTokenService
{
    private static readonly TimeSpan RefreshSkew = TimeSpan.FromMinutes(1);
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ConcurrentDictionary<string, OAuthTokenEntry> _tokens = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new(StringComparer.Ordinal);

    public OAuthTokenService(IHttpClientFactory httpClientFactory)
    {
        _httpClientFactory = httpClientFactory;
    }

    public async Task<OAuthTokenExchangeResponse> ExchangeCodeAsync(
        OAuthTokenExchangeRequest request,
        CancellationToken cancellationToken)
    {
        ValidateExchangeRequest(request);

        var token = await RequestTokenAsync(
            request.Configuration,
            new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["code"] = request.Code.Trim(),
                ["code_verifier"] = request.CodeVerifier.Trim(),
                ["redirect_uri"] = request.RedirectUri.Trim(),
            },
            cancellationToken);

        _tokens[request.OwnerKey.Trim()] = token;
        return ToExchangeResponse(token);
    }

    public async Task<OAuthAccessToken> GetAccessTokenAsync(
        string ownerKey,
        OAuth2Configuration configuration,
        CancellationToken cancellationToken)
    {
        ValidateConfiguration(configuration);
        var normalizedOwnerKey = NormalizeOwnerKey(ownerKey);
        var configurationKey = BuildConfigurationKey(configuration);

        if (_tokens.TryGetValue(normalizedOwnerKey, out var current) &&
            !string.Equals(current.ConfigurationKey, configurationKey, StringComparison.Ordinal))
        {
            _tokens.TryRemove(normalizedOwnerKey, out _);
            current = null;
        }

        if (current != null && current.ExpiresAt - DateTimeOffset.UtcNow > RefreshSkew)
        {
            return ToAccessToken(current);
        }

        var refreshLock = _locks.GetOrAdd(normalizedOwnerKey, _ => new SemaphoreSlim(1, 1));
        await refreshLock.WaitAsync(cancellationToken);
        try
        {
            if (_tokens.TryGetValue(normalizedOwnerKey, out current) &&
                string.Equals(current.ConfigurationKey, configurationKey, StringComparison.Ordinal) &&
                current.ExpiresAt - DateTimeOffset.UtcNow > RefreshSkew)
            {
                return ToAccessToken(current);
            }

            if (current == null || string.IsNullOrWhiteSpace(current.RefreshToken))
            {
                throw new InvalidOperationException("OAuth authorization is required. Connect this request first.");
            }

            var refreshed = await RequestTokenAsync(
                configuration,
                new Dictionary<string, string>
                {
                    ["grant_type"] = "refresh_token",
                    ["refresh_token"] = current.RefreshToken,
                },
                cancellationToken,
                current.RefreshToken);

            _tokens[normalizedOwnerKey] = refreshed;
            return ToAccessToken(refreshed);
        }
        finally
        {
            refreshLock.Release();
        }
    }

    public OAuthTokenStatusResponse GetStatus(string ownerKey)
    {
        if (!_tokens.TryGetValue(NormalizeOwnerKey(ownerKey), out var token))
        {
            return new OAuthTokenStatusResponse();
        }

        return new OAuthTokenStatusResponse
        {
            Connected = true,
            ExpiresAt = token.ExpiresAt,
            HasRefreshToken = !string.IsNullOrWhiteSpace(token.RefreshToken),
        };
    }

    public void Clear(string ownerKey)
    {
        _tokens.TryRemove(NormalizeOwnerKey(ownerKey), out _);
    }

    private async Task<OAuthTokenEntry> RequestTokenAsync(
        OAuth2Configuration configuration,
        Dictionary<string, string> grantFields,
        CancellationToken cancellationToken,
        string? fallbackRefreshToken = null)
    {
        ValidateConfiguration(configuration);

        using var request = new HttpRequestMessage(HttpMethod.Post, configuration.TokenUrl.Trim());
        var form = BuildTokenForm(configuration, grantFields).ToList();

        if (string.Equals(configuration.ClientAuthenticationMethod, "client_secret_basic", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(configuration.ClientSecret))
        {
            var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes(
                $"{configuration.ClientId}:{configuration.ClientSecret}"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);
            form.RemoveAll(pair => pair.Key == "client_secret");
        }

        request.Content = new FormUrlEncodedContent(form);
        var client = _httpClientFactory.CreateClient();
        using var response = await client.SendAsync(request, cancellationToken);
        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(BuildTokenError(response.StatusCode, responseBody));
        }

        try
        {
            using var document = JsonDocument.Parse(responseBody);
            var root = document.RootElement;
            var accessToken = ReadString(root, "access_token");
            if (string.IsNullOrWhiteSpace(accessToken))
            {
                throw new InvalidOperationException("OAuth token response did not contain an access_token.");
            }

            var expiresIn = ReadInt(root, "expires_in") ?? 3600;
            var refreshToken = ReadString(root, "refresh_token");
            return new OAuthTokenEntry
            {
                AccessToken = accessToken,
                RefreshToken = string.IsNullOrWhiteSpace(refreshToken) ? fallbackRefreshToken ?? "" : refreshToken,
                ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Max(1, expiresIn)),
                TokenType = ReadString(root, "token_type") ?? "Bearer",
                ConfigurationKey = BuildConfigurationKey(configuration),
            };
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"OAuth token response was not valid JSON: {ex.Message}", ex);
        }
    }

    private static IEnumerable<KeyValuePair<string, string>> BuildTokenForm(
        OAuth2Configuration configuration,
        Dictionary<string, string> grantFields)
    {
        var form = new List<KeyValuePair<string, string>>
        {
            new("client_id", configuration.ClientId.Trim()),
        };

        if (!string.Equals(configuration.ClientAuthenticationMethod, "client_secret_basic", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(configuration.ClientSecret))
        {
            form.Add(new KeyValuePair<string, string>("client_secret", configuration.ClientSecret));
        }

        if (!string.IsNullOrWhiteSpace(configuration.Scope))
        {
            form.Add(new KeyValuePair<string, string>("scope", configuration.Scope.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(configuration.Audience))
        {
            form.Add(new KeyValuePair<string, string>("audience", configuration.Audience.Trim()));
        }

        form.AddRange(grantFields);
        return form;
    }

    private static void ValidateExchangeRequest(OAuthTokenExchangeRequest request)
    {
        if (request == null) throw new InvalidOperationException("OAuth exchange request is required.");
        if (string.IsNullOrWhiteSpace(request.OwnerKey)) throw new InvalidOperationException("OAuth owner key is required.");
        if (string.IsNullOrWhiteSpace(request.Code)) throw new InvalidOperationException("OAuth authorization code is required.");
        if (string.IsNullOrWhiteSpace(request.CodeVerifier)) throw new InvalidOperationException("PKCE code verifier is required.");
        if (string.IsNullOrWhiteSpace(request.RedirectUri)) throw new InvalidOperationException("OAuth redirect URI is required.");
        ValidateConfiguration(request.Configuration);
    }

    private static void ValidateConfiguration(OAuth2Configuration configuration)
    {
        if (configuration == null) throw new InvalidOperationException("OAuth configuration is required.");
        if (!IsHttpUrl(configuration.TokenUrl)) throw new InvalidOperationException("OAuth token URL must be an absolute http/https URL.");
        if (string.IsNullOrWhiteSpace(configuration.ClientId)) throw new InvalidOperationException("OAuth client ID is required.");
    }

    private static bool IsHttpUrl(string value)
    {
        return Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri) &&
            (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }

    private static string NormalizeOwnerKey(string ownerKey)
    {
        if (string.IsNullOrWhiteSpace(ownerKey)) throw new InvalidOperationException("OAuth owner key is required.");
        return ownerKey.Trim();
    }

    private static string BuildConfigurationKey(OAuth2Configuration configuration)
    {
        var raw = string.Join(
            "\u001f",
            configuration.TokenUrl.Trim(),
            configuration.ClientId.Trim(),
            configuration.ClientSecret,
            configuration.Scope.Trim(),
            configuration.Audience.Trim(),
            configuration.ClientAuthenticationMethod.Trim().ToLowerInvariant());
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
    }

    private static OAuthTokenExchangeResponse ToExchangeResponse(OAuthTokenEntry token)
    {
        return new OAuthTokenExchangeResponse
        {
            TokenType = token.TokenType,
            ExpiresAt = token.ExpiresAt,
            HasRefreshToken = !string.IsNullOrWhiteSpace(token.RefreshToken),
        };
    }

    private static OAuthAccessToken ToAccessToken(OAuthTokenEntry token)
    {
        return new OAuthAccessToken
        {
            Value = token.AccessToken,
            TokenType = string.IsNullOrWhiteSpace(token.TokenType) ? "Bearer" : token.TokenType.Trim(),
        };
    }

    private static string BuildTokenError(System.Net.HttpStatusCode statusCode, string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            var root = document.RootElement;
            var description = ReadString(root, "error_description") ?? ReadString(root, "error");
            if (!string.IsNullOrWhiteSpace(description))
                return $"OAuth token request failed ({(int)statusCode}): {description}";
        }
        catch (JsonException)
        {
            // Fall through to a provider-independent error.
        }

        return $"OAuth token request failed ({(int)statusCode}).";
    }

    private static string? ReadString(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var value)) return null;
        return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
    }

    private static int? ReadInt(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
        return int.TryParse(value.ToString(), out var parsed) ? parsed : null;
    }

    private sealed class OAuthTokenEntry
    {
        public string AccessToken { get; init; } = "";
        public string RefreshToken { get; init; } = "";
        public string TokenType { get; init; } = "Bearer";
        public DateTimeOffset ExpiresAt { get; init; }
        public string ConfigurationKey { get; init; } = "";
    }
}
