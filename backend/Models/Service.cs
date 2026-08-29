namespace RequestLoom.Api.Models;

public class Service
{
    public string Id { get; set; } = "";
    public string WorkspaceId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string StoragePath { get; set; } = "";
    public int SortOrder { get; set; }
    public string CreatedAt { get; set; } = "";
    public List<KeyValuePair> Headers { get; set; } = [];
    public ServiceAuth? Auth { get; set; }
    public List<RequestFolder> Folders { get; set; } = [];
    public List<ApiRequest> Requests { get; set; } = [];
}

public class RequestFolder
{
    public string Id { get; set; } = "";
    public string ServiceId { get; set; } = "";
    public string Name { get; set; } = "";
    public int SortOrder { get; set; }
    public string CreatedAt { get; set; } = "";
}

public class CreateRequestFolderRequest
{
    public string Name { get; set; } = "";
}

public class UpdateRequestFolderRequest
{
    public string Name { get; set; } = "";
}

public class ServiceAuth
{
    public string Id { get; set; } = "";
    public string ServiceId { get; set; } = "";
    public string AuthType { get; set; } = "none";
    public string ConfigJson { get; set; } = "{}";
}

public class ServiceVariable
{
    public string Id { get; set; } = "";
    public string ServiceId { get; set; } = "";
    public string? EnvironmentId { get; set; }
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool IsSecret { get; set; }
    public bool Enabled { get; set; } = true;
}

public class CreateServiceRequest
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string? StoragePath { get; set; }
    public List<KeyValuePairRequest> Headers { get; set; } = [];
    public AuthRequest? Auth { get; set; }
}

public class CreateServiceFileRequest
{
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "";
}

public class ServiceFileResponse
{
    public string Path { get; set; } = "";
    public string Name { get; set; } = "";
    public string Content { get; set; } = "";
}

public class SaveServiceFileRequest
{
    public string Content { get; set; } = "";
}

public class RunServiceFileRequest
{
    public string Code { get; set; } = "";
}

public class JavaScriptRunResponse
{
    public bool Success { get; set; }
    public List<string> Logs { get; set; } = [];
    public string? Result { get; set; }
    public string? Error { get; set; }
}

public class UpdateServiceRequest
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public List<KeyValuePairRequest> Headers { get; set; } = [];
    public AuthRequest? Auth { get; set; }
}

public class UpsertServiceVariableRequest
{
    public string? Id { get; set; }
    public string? EnvironmentId { get; set; }
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool IsSecret { get; set; }
    public bool Enabled { get; set; } = true;
}
