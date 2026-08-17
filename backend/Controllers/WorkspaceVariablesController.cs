using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/workspaces/{workspaceId}/variables")]
public class WorkspaceVariablesController : ControllerBase
{
    private readonly IWorkspaceVariableRepository _repo;
    private readonly VariableResolutionService _variableService;

    public WorkspaceVariablesController(IWorkspaceVariableRepository repo, VariableResolutionService variableService)
    {
        _repo = repo;
        _variableService = variableService;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(string workspaceId)
    {
        var variables = await _repo.GetByWorkspaceAsync(workspaceId);
        return Ok(variables);
    }

    [HttpPut]
    public async Task<IActionResult> Upsert(string workspaceId, [FromBody] UpsertWorkspaceVariableRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Key))
            return BadRequest("Key is required");

        var variable = await _repo.UpsertAsync(
            workspaceId,
            request.Id,
            request.Key.Trim(),
            request.Value,
            request.IsSecret,
            request.Enabled,
            request.EnvironmentId);

        return Ok(variable);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var deleted = await _repo.DeleteAsync(id);
        if (!deleted) return NotFound();
        return NoContent();
    }

    [HttpGet("resolved")]
    public async Task<IActionResult> GetResolved(string workspaceId, [FromQuery] string? serviceId = null)
    {
        var variables = await _variableService.BuildVariableMapAsync(workspaceId, serviceId);
        return Ok(variables);
    }
}
