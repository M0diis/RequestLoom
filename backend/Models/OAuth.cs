namespace RequestLoom.Api.Models;

public sealed class OAuth2Configuration
{
    public string AuthorizationUrl { get; set; } = "";
    public string TokenUrl { get; set; } = "";
    public string Issuer { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string Scope { get; set; } = "openid profile email";
    public string RedirectUri { get; set; } = "";
    public string Audience { get; set; } = "";
    public string ClientAuthenticationMethod { get; set; } = "client_secret_post";
}

public sealed class OAuthTokenExchangeRequest
{
    public string OwnerKey { get; set; } = "";
    public string Code { get; set; } = "";
    public string CodeVerifier { get; set; } = "";
    public string RedirectUri { get; set; } = "";
    public OAuth2Configuration Configuration { get; set; } = new();
}

public sealed class OAuthTokenExchangeResponse
{
    public bool Connected { get; set; } = true;
    public string TokenType { get; set; } = "Bearer";
    public DateTimeOffset? ExpiresAt { get; set; }
    public bool HasRefreshToken { get; set; }
}

public sealed class OAuthAccessToken
{
    public string Value { get; set; } = "";
    public string TokenType { get; set; } = "Bearer";
}

public sealed class OAuthTokenStatusResponse
{
    public bool Connected { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public bool HasRefreshToken { get; set; }
}

public sealed class OAuthDiscoveryResponse
{
    public string Issuer { get; set; } = "";
    public string AuthorizationEndpoint { get; set; } = "";
    public string TokenEndpoint { get; set; } = "";
    public string? UserinfoEndpoint { get; set; }
    public string[] ScopesSupported { get; set; } = [];
}
