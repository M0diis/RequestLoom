namespace RequestLoom.Api.Models;

public class MockServer
{
    public string Id { get; set; } = "";
    public string WorkspaceId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Slug { get; set; } = "";
    public int Port { get; set; }
    public bool IsRunning { get; set; }
    public string CreatedAt { get; set; } = "";
    public string UpdatedAt { get; set; } = "";
    public List<MockServerEndpoint> Endpoints { get; set; } = [];
}

public class MockServerEndpoint
{
    public string Id { get; set; } = "";
    public string MockServerId { get; set; } = "";
    public string Method { get; set; } = "GET";
    public string Path { get; set; } = "/";
    public int StatusCode { get; set; } = 200;
    public string ContentType { get; set; } = "application/json";
    public string ResponseBody { get; set; } = "";
    public string ResponseHeadersJson { get; set; } = "[]";
    public bool ScriptEnabled { get; set; }
    public string Script { get; set; } = "";
    public string Behavior { get; set; } = MockEndpointBehaviors.Static;
    public string BehaviorConfigJson { get; set; } = "{}";
    public int DelayMs { get; set; }
    public int SortOrder { get; set; }
    public string CreatedAt { get; set; } = "";
}

public class CreateMockServerRequest
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Slug { get; set; } = "";
    public int Port { get; set; }
}

public class UpdateMockServerRequest
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Slug { get; set; } = "";
    public int Port { get; set; }
}

public class CreateMockEndpointRequest
{
    public string Method { get; set; } = "GET";
    public string Path { get; set; } = "/";
    public int StatusCode { get; set; } = 200;
    public string ContentType { get; set; } = "application/json";
    public string ResponseBody { get; set; } = "";
    public List<KeyValuePairRequest> ResponseHeaders { get; set; } = [];
    public bool ScriptEnabled { get; set; }
    public string Script { get; set; } = "";
    public string Behavior { get; set; } = MockEndpointBehaviors.Static;
    public string BehaviorConfigJson { get; set; } = "{}";
    public int DelayMs { get; set; }
}

public class UpdateMockEndpointRequest
{
    public string Method { get; set; } = "GET";
    public string Path { get; set; } = "/";
    public int StatusCode { get; set; } = 200;
    public string ContentType { get; set; } = "application/json";
    public string ResponseBody { get; set; } = "";
    public List<KeyValuePairRequest> ResponseHeaders { get; set; } = [];
    public bool ScriptEnabled { get; set; }
    public string Script { get; set; } = "";
    public string Behavior { get; set; } = MockEndpointBehaviors.Static;
    public string BehaviorConfigJson { get; set; } = "{}";
    public int DelayMs { get; set; }
}

public class MockServerResponse
{
    public int StatusCode { get; set; }
    public string ContentType { get; set; } = "application/json";
    public string Body { get; set; } = "";
    public List<KeyValuePair> Headers { get; set; } = [];
    public bool Matched { get; set; }
    public string MatchedEndpointId { get; set; } = "";
}

public static class MockEndpointBehaviors
{
    public const string Static = "static";
    public const string OAuth2Authorization = "oauth2-authorization";
    public const string OAuth2Token = "oauth2-token";
    public const string OidcDiscovery = "oidc-discovery";
    public const string OidcUserInfo = "oidc-userinfo";
    public const string OidcJwks = "oidc-jwks";

    public static bool IsBuiltIn(string? behavior) => behavior is
        OAuth2Authorization or OAuth2Token or OidcDiscovery or OidcUserInfo or OidcJwks;

    public static string Normalize(string? behavior) => string.IsNullOrWhiteSpace(behavior)
        ? Static
        : behavior.Trim().ToLowerInvariant() switch
        {
            OAuth2Authorization => OAuth2Authorization,
            OAuth2Token => OAuth2Token,
            OidcDiscovery => OidcDiscovery,
            OidcUserInfo => OidcUserInfo,
            OidcJwks => OidcJwks,
            _ => Static,
        };
}
