using RequestLoom.Api.Models;

namespace RequestLoom.Api.Models;

/// <summary>
/// Complete workspace export/import payload containing all data for a workspace.
/// </summary>
public class WorkspaceExport
{
    public string Name { get; set; } = "";
    public List<EnvironmentExport> Environments { get; set; } = [];
    public List<WorkspaceVariable> WorkspaceVariables { get; set; } = [];
    public List<ServiceExport> Services { get; set; } = [];
    public List<HistoryEntry> History { get; set; } = [];
}

public class EnvironmentExport
{
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
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public int SortOrder { get; set; }
    public List<KeyValuePairRequest> Headers { get; set; } = [];
    public AuthRequest? Auth { get; set; }
    public List<ServiceVariableExport> Variables { get; set; } = [];
    public List<RequestExport> Requests { get; set; } = [];
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
    public string Name { get; set; } = "";
    public string Method { get; set; } = "GET";
    public string Url { get; set; } = "";
    public string? Body { get; set; }
    public string BodyType { get; set; } = "none";
    public string PreRequestScript { get; set; } = "";
    public string PostRequestScript { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsFavorite { get; set; }
    public List<KeyValuePairRequest> Headers { get; set; } = [];
    public List<KeyValuePairRequest> Params { get; set; } = [];
    public List<RequestVariableRequest> Variables { get; set; } = [];
    public AuthRequest? Auth { get; set; }
    public ApiRequestSettings? Settings { get; set; }
}
