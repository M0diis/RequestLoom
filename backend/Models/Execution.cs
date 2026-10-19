namespace RequestLoom.Api.Models;

public class ExecuteRequestPayload
{
    public string Method { get; set; } = "GET";
    public string Url { get; set; } = "";
    public string? Body { get; set; }
    public string BodyType { get; set; } = "none";
    public List<KeyValuePairRequest> Headers { get; set; } = [];
    public List<KeyValuePairRequest> Params { get; set; } = [];
    public List<RequestVariableRequest> Variables { get; set; } = [];
    public AuthRequest? Auth { get; set; }
    public string? WorkspaceId { get; set; }
    public string? EnvironmentId { get; set; }
    public string? ServiceId { get; set; }
    public string? RequestId { get; set; }
    public string? PreRequestScript { get; set; }
    public string? PostRequestScript { get; set; }
    public string? TestScript { get; set; }
    public bool IgnoreSslErrors { get; set; }
    public MtlsConfig? Mtls { get; set; }
}

/// <summary>Runtime service variables owned by one collection run, rather than the interactive session.</summary>
public sealed class RequestExecutionContext
{
    public string? EnvironmentId { get; init; }
    public Dictionary<string, RuntimeScriptVariable> ServiceVariables { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public class MtlsConfig
{
    public string CertPath { get; set; } = "";
    public string KeyPath { get; set; } = "";
    public string? CaPath { get; set; }
}

public class ExecuteResponse
{
    public int StatusCode { get; set; }
    public string StatusText { get; set; } = "";
    public Dictionary<string, string[]> Headers { get; set; } = [];
    public string Body { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long ResponseTimeMs { get; set; }
    public long ResponseSizeBytes { get; set; }
    public bool IsTruncated { get; set; }
    public string? Error { get; set; }
    public bool IsSoapFault { get; set; }
    public SoapFaultInfo? SoapFault { get; set; }
    public Dictionary<string, RuntimeScriptVariable> ScriptVariables { get; set; } = [];
    public Dictionary<string, RuntimeScriptVariable> ServiceScriptVariables { get; set; } = [];
    public List<string> ScriptLogs { get; set; } = [];
    public List<TestResult> TestResults { get; set; } = [];
}

public class RuntimeScriptVariable
{
    public string Value { get; set; } = "";
    public string Source { get; set; } = "";
    public string Scope { get; set; } = "request";
}

public class SoapFaultInfo
{
    public string FaultCode { get; set; } = "";
    public string FaultString { get; set; } = "";
    public string? Detail { get; set; }
}

public class HistoryEntry
{
    public string Id { get; set; } = "";
    public string? RequestId { get; set; }
    public string WorkspaceId { get; set; } = "";
    public string Method { get; set; } = "";
    public string Url { get; set; } = "";
    public string? RequestHeadersJson { get; set; }
    public string? RequestBody { get; set; }
    public int ResponseStatus { get; set; }
    public string StatusText { get; set; } = "";
    public string? ResponseHeadersJson { get; set; }
    public string? ResponseBody { get; set; }
    public string ContentType { get; set; } = "";
    public long ResponseTimeMs { get; set; }
    public long ResponseSizeBytes { get; set; }
    public bool IsTruncated { get; set; }
    public string? Error { get; set; }
    public bool IsSoapFault { get; set; }
    public SoapFaultInfo? SoapFault { get; set; }
    public Dictionary<string, RuntimeScriptVariable> ScriptVariables { get; set; } = [];
    public Dictionary<string, RuntimeScriptVariable> ServiceScriptVariables { get; set; } = [];
    public List<string> ScriptLogs { get; set; } = [];
    public List<TestResult> TestResults { get; set; } = [];
    public string ExecutedAt { get; set; } = "";
}
