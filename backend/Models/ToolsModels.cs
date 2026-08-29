namespace RequestLoom.Api.Models;

/// <summary>
/// Result of parsing a cURL command.
/// </summary>
public class CurlParseResult
{
    public string Method { get; set; } = "GET";
    public string Url { get; set; } = "";
    public List<KeyValuePairRequest> Headers { get; set; } = [];
    public string? Body { get; set; }
    public string BodyType { get; set; } = "none";
    public AuthRequest? Auth { get; set; }
    public string? ServiceName { get; set; }
}

/// <summary>
/// Request to generate code snippets from a request payload.
/// </summary>
public class SnippetRequest
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
    public string? ServiceId { get; set; }
    public string? RequestId { get; set; }
    public string? Language { get; set; } // null = all languages
}

/// <summary>
/// Generated code snippet.
/// </summary>
public class CodeSnippet
{
    public string Language { get; set; } = "";
    public string Client { get; set; } = "";
    public string Code { get; set; } = "";
}

/// <summary>
/// Result of running a collection (service) of requests.
/// </summary>
public class CollectionRunResult
{
    public string ServiceId { get; set; } = "";
    public string ServiceName { get; set; } = "";
    public string? FolderId { get; set; }
    public string? FolderName { get; set; }
    public int TotalRequests { get; set; }
    public int PassedRequests { get; set; }
    public int FailedRequests { get; set; }
    public long TotalTimeMs { get; set; }
    public List<CollectionRequestResult> Results { get; set; } = [];
}

/// <summary>
/// Result of a single request within a collection run.
/// </summary>
public class CollectionRequestResult
{
    public string RequestId { get; set; } = "";
    public string RequestName { get; set; } = "";
    public string Method { get; set; } = "";
    public string Url { get; set; } = "";
    public int StatusCode { get; set; }
    public long ResponseTimeMs { get; set; }
    public bool Passed { get; set; }
    public string? Error { get; set; }
    public List<TestResult> Tests { get; set; } = [];
}

/// <summary>
/// A single test assertion result.
/// </summary>
public class TestResult
{
    public string Name { get; set; } = "";
    public bool Passed { get; set; }
    public string? Message { get; set; }
}

/// <summary>
/// Request to run a collection.
/// </summary>
public class RunCollectionRequest
{
    public string ServiceId { get; set; } = "";
    public string? EnvironmentId { get; set; }
    public bool StopOnFailure { get; set; }
}
