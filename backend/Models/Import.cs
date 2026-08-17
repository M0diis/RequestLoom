namespace RequestLoom.Api.Models;

public class ImportSpecificationRequest
{
    // "url" or "raw"
    public string SourceType { get; set; } = "url";
    public string Source { get; set; } = "";
    public string? ServiceId { get; set; }
    public string? ServiceName { get; set; }
}

public class ImportSpecificationResult
{
    public string ServiceId { get; set; } = "";
    public int CreatedRequests { get; set; }
    public List<string> Warnings { get; set; } = [];
}
