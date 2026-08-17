namespace RequestLoom.Api.Models;

public class Environment
{
    public string Id { get; set; } = "";
    public string WorkspaceId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool IsActive { get; set; }
    public int SortOrder { get; set; }
    public string CreatedAt { get; set; } = "";
    public List<EnvironmentVariable> Variables { get; set; } = [];
}

public class EnvironmentVariable
{
    public string Id { get; set; } = "";
    public string EnvironmentId { get; set; } = "";
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool IsSecret { get; set; }
    public bool Enabled { get; set; } = true;
}

public class CreateEnvironmentRequest
{
    public string Name { get; set; } = "";
}

public class UpdateEnvironmentRequest
{
    public string Name { get; set; } = "";
}

public class UpsertEnvironmentVariableRequest
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public bool IsSecret { get; set; }
    public bool Enabled { get; set; } = true;
}
