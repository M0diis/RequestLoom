namespace RequestLoom.Api.Models;

public sealed class CookieJarEntry
{
    public string Name { get; set; } = "";
    public string Domain { get; set; } = "";
    public string Path { get; set; } = "/";
    public DateTimeOffset? ExpiresAt { get; set; }
    public bool Secure { get; set; }
    public bool HttpOnly { get; set; }
}

public sealed class PersistedCookie
{
    public string Name { get; set; } = "";
    public string Value { get; set; } = "";
    public string Domain { get; set; } = "";
    public string Path { get; set; } = "/";
    public DateTimeOffset? ExpiresAt { get; set; }
    public bool Secure { get; set; }
    public bool HttpOnly { get; set; }
}

public sealed class CookieJarDocument
{
    public int Version { get; set; } = 1;
    public Dictionary<string, List<PersistedCookie>> Workspaces { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class MultipartFormBody
{
    public List<MultipartFormField> Fields { get; set; } = [];
}

public sealed class MultipartFormField
{
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "text";
    public string Value { get; set; } = "";
    public string FilePath { get; set; } = "";
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "application/octet-stream";
    public bool Enabled { get; set; } = true;
}

public sealed class RequestFileUploadResponse
{
    public string FilePath { get; set; } = "";
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "application/octet-stream";
    public long Size { get; set; }
}
