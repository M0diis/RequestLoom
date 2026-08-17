using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class WorkspacesController : ControllerBase
{
    private readonly IWorkspaceRepository _repo;

    public WorkspacesController(IWorkspaceRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var workspaces = await _repo.GetAllAsync();
        return Ok(workspaces);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id)
    {
        var workspace = await _repo.GetByIdAsync(id);
        if (workspace == null) return NotFound();
        return Ok(workspace);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateWorkspaceRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Name is required");

        var workspace = await _repo.CreateAsync(request.Name.Trim());
        return CreatedAtAction(nameof(GetById), new { id = workspace.Id }, workspace);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateWorkspaceRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Name is required");

        var workspace = await _repo.UpdateAsync(id, request.Name.Trim());
        if (workspace == null) return NotFound();
        return Ok(workspace);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        if (id == "default")
            return BadRequest("Cannot delete the default workspace");

        var deleted = await _repo.DeleteAsync(id);
        if (!deleted) return NotFound();
        return NoContent();
    }
}
