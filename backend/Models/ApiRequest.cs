namespace RequestLoom.Api.Models;

public class ApiRequest
{
    public string Id { get; set; } = "";
    public string ServiceId { get; set; } = "";
    public string? FolderId { get; set; }
    public string Name { get; set; } = "";
    public string Method { get; set; } = "GET";
    public string Url { get; set; } = "";
    public string? Body { get; set; }
    public string BodyType { get; set; } = "none";
    public string PreRequestScript { get; set; } = "";
    public string PostRequestScript { get; set; } = "";
    public string TestScript { get; set; } = "";
    public string Notes { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsFavorite { get; set; }
    public string CreatedAt { get; set; } = "";
    public string UpdatedAt { get; set; } = "";
    public List<KeyValuePair> Headers { get; set; } = [];
    public List<KeyValuePair> Params { get; set; } = [];
    public List<RequestVariable> Variables { get; set; } = [];
    public RequestAuth? Auth { get; set; }
}

public class KeyValuePair
{
    public string Id { get; set; } = "";
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool Enabled { get; set; } = true;
}

public class RequestAuth
{
    public string Id { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string AuthType { get; set; } = "none";
    public string ConfigJson { get; set; } = "{}";
}

public class RequestVariable
{
    public string Id { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool Enabled { get; set; } = true;
}

public class WorkspaceVariable
{
    public string Id { get; set; } = "";
    public string WorkspaceId { get; set; } = "";
    public string? EnvironmentId { get; set; }
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool IsSecret { get; set; }
    public bool Enabled { get; set; } = true;
}

public class UpsertWorkspaceVariableRequest
{
    public string? Id { get; set; }
    public string? EnvironmentId { get; set; }
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool IsSecret { get; set; }
    public bool Enabled { get; set; } = true;
}

public class CreateApiRequestRequest
{
    public string Name { get; set; } = "";
    public string Method { get; set; } = "GET";
    public string Url { get; set; } = "";
    public string? Body { get; set; }
    public string BodyType { get; set; } = "none";
    public string? FolderId { get; set; }
}

public class MoveRequestToFolderRequest
{
    public string? FolderId { get; set; }
}

public class ReorderRequestRequest
{
    public string? FolderId { get; set; }
    public string? BeforeRequestId { get; set; }
}

public class UpdateApiRequestRequest
{
    public string Name { get; set; } = "";
    public string Method { get; set; } = "GET";
    public string Url { get; set; } = "";
    public string? Body { get; set; }
    public string BodyType { get; set; } = "none";
    public string PreRequestScript { get; set; } = "";
    public string PostRequestScript { get; set; } = "";
    public string TestScript { get; set; } = "";
    public string Notes { get; set; } = "";
    public List<KeyValuePairRequest> Headers { get; set; } = [];
    public List<KeyValuePairRequest> Params { get; set; } = [];
    public List<RequestVariableRequest> Variables { get; set; } = [];
    public AuthRequest? Auth { get; set; }
}

public class KeyValuePairRequest
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool Enabled { get; set; } = true;
}

public class AuthRequest
{
    public string AuthType { get; set; } = "none";
    public string ConfigJson { get; set; } = "{}";
}

public class RequestVariableRequest
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool Enabled { get; set; } = true;
}

public class ApiRequestSettings
{
    public string RequestId { get; set; } = "";
    public bool FollowRedirects { get; set; } = true;
    public int MaxRedirects { get; set; } = 10;
    public bool IgnoreSslErrors { get; set; }
    public int? TimeoutSeconds { get; set; }
    public string ProxyMode { get; set; } = "inherit";
    public string ProxyUrl { get; set; } = "";
    public string ProxyUsername { get; set; } = "";
    public string ProxyPassword { get; set; } = "";
}
