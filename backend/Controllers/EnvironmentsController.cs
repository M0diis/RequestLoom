using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/workspaces/{workspaceId}/[controller]")]
public class EnvironmentsController : ControllerBase
{
    private readonly IEnvironmentRepository _repo;

    public EnvironmentsController(IEnvironmentRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(string workspaceId)
    {
        var environments = await _repo.GetByWorkspaceAsync(workspaceId);
        return Ok(environments);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id)
    {
        var env = await _repo.GetByIdAsync(id);
        if (env == null) return NotFound();
        return Ok(env);
    }

    [HttpPost]
    public async Task<IActionResult> Create(string workspaceId, [FromBody] CreateEnvironmentRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Name is required");

        var env = await _repo.CreateAsync(workspaceId, request.Name.Trim());
        return CreatedAtAction(nameof(GetById), new { workspaceId, id = env.Id }, env);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateEnvironmentRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Name is required");

        var env = await _repo.UpdateAsync(id, request.Name.Trim());
        if (env == null) return NotFound();
        return Ok(env);
    }

    [HttpPost("{id}/activate")]
    public async Task<IActionResult> Activate(string workspaceId, string id)
    {
        await _repo.SetActiveAsync(workspaceId, id);
        return NoContent();
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var deleted = await _repo.DeleteAsync(id);
        if (!deleted) return NotFound();
        return NoContent();
    }

    [HttpPut("{id}/variables")]
    public async Task<IActionResult> UpsertVariable(string id, [FromBody] UpsertEnvironmentVariableRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Key))
            return BadRequest("Key is required");

        var variable = await _repo.UpsertVariableAsync(id, request.Key.Trim(), request.Value, request.IsSecret, request.Enabled);
        return Ok(variable);
    }

    [HttpDelete("{environmentId}/variables/{variableId}")]
    public async Task<IActionResult> DeleteVariable(string variableId)
    {
        var deleted = await _repo.DeleteVariableAsync(variableId);
        if (!deleted) return NotFound();
        return NoContent();
    }
}
