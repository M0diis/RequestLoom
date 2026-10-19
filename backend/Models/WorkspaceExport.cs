using RequestLoom.Api.Models;

namespace RequestLoom.Api.Models;

/// <summary>
/// Complete workspace export/import payload containing all data for a workspace.
/// </summary>
public class WorkspaceExport
{
    public int FormatVersion { get; set; } = 1;
    public string Name { get; set; } = "";
    public List<EnvironmentExport> Environments { get; set; } = [];
    public List<WorkspaceVariable> WorkspaceVariables { get; set; } = [];
    public List<ServiceExport> Services { get; set; } = [];
    public List<RequestExport> TopLevelRequests { get; set; } = [];
    public List<HistoryEntry> History { get; set; } = [];
    /// <summary>False when secret values, credentials and cookies were left out of this archive.</summary>
    public bool IncludesSecrets { get; set; } = true;
    public bool IncludesHistory { get; set; } = true;
    public List<MockServerExport> MockServers { get; set; } = [];
    public List<PersistedCookie> Cookies { get; set; } = [];
    /// <summary>Uploaded request files, keyed by the stored path that request bodies reference.</summary>
    public List<ArchiveFileExport> Files { get; set; } = [];
}

public sealed record WorkspaceExportOptions(bool IncludeSecrets = true, bool IncludeHistory = true);

public class WorkspaceImportResult : Workspace
{
    public List<string> Warnings { get; set; } = [];
}

public class ArchiveFileExport
{
    public string Path { get; set; } = "";
    public string ContentBase64 { get; set; } = "";
}

public class ScriptFileExport
{
    public string Name { get; set; } = "";
    public string Content { get; set; } = "";
}

public class MockServerExport
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Slug { get; set; } = "";
    public int Port { get; set; }
    public List<MockEndpointExport> Endpoints { get; set; } = [];
}

public class MockEndpointExport
{
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
}

public class EnvironmentExport
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public bool IsActive { get; set; }
    public int SortOrder { get; set; }
    public List<EnvironmentVariableExport> Variables { get; set; } = [];
}

public class EnvironmentVariableExport
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool IsSecret { get; set; }
    public bool Enabled { get; set; } = true;
}

public class ServiceExport
{
    public List<EnvironmentExport> Environments { get; set; } = [];
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public int SortOrder { get; set; }
    public List<KeyValuePairRequest> Headers { get; set; } = [];
    public AuthRequest? Auth { get; set; }
    public List<ServiceVariableExport> Variables { get; set; } = [];
    public List<RequestFolderExport> Folders { get; set; } = [];
    public List<RequestExport> Requests { get; set; } = [];
    /// <summary>Collection JavaScript files (JSON storage only).</summary>
    public List<ScriptFileExport> ScriptFiles { get; set; } = [];
}

public class RequestFolderExport
{
    public string Name { get; set; } = "";
    public int SortOrder { get; set; }
}

public class ServiceVariableExport
{
    public string? EnvironmentId { get; set; }
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool IsSecret { get; set; }
    public bool Enabled { get; set; } = true;
}

public class RequestExport
{
    public string Id { get; set; } = "";
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
    public string? FolderName { get; set; }
    public List<KeyValuePairRequest> Headers { get; set; } = [];
    public List<KeyValuePairRequest> Params { get; set; } = [];
    public List<RequestVariableRequest> Variables { get; set; } = [];
    public AuthRequest? Auth { get; set; }
    public ApiRequestSettings? Settings { get; set; }
}
