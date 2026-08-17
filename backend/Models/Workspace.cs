namespace RequestLoom.Api.Models;

public class Workspace
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string CreatedAt { get; set; } = "";
    public string UpdatedAt { get; set; } = "";
}

public class CreateWorkspaceRequest
{
    public string Name { get; set; } = "";
}

public class UpdateWorkspaceRequest
{
    public string Name { get; set; } = "";
}
