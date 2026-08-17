using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/workspaces/{workspaceId}/[controller]")]
public class ServicesController : ControllerBase
{
    private readonly IServiceRepository _repo;

    public ServicesController(IServiceRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(string workspaceId, [FromQuery] bool includeRequests = true)
    {
        var services = await _repo.GetByWorkspaceAsync(workspaceId, includeRequests);
        return Ok(services);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id)
    {
        var service = await _repo.GetByIdAsync(id);
        if (service == null) return NotFound();
        return Ok(service);
    }

    [HttpPost]
    public async Task<IActionResult> Create(string workspaceId, [FromBody] CreateServiceRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Name is required");

        var service = await _repo.CreateAsync(
            workspaceId,
            request.Name.Trim(),
            request.Description,
            request.Headers ?? [],
            request.Auth);
        return CreatedAtAction(nameof(GetById), new { workspaceId, id = service.Id }, service);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateServiceRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Name is required");

        var service = await _repo.UpdateAsync(
            id,
            request.Name.Trim(),
            request.Description,
            request.Headers ?? [],
            request.Auth);
        if (service == null) return NotFound();
        return Ok(service);
    }

    [HttpPut("reorder")]
    public async Task<IActionResult> Reorder(string workspaceId, [FromBody] List<string> serviceIds)
    {
        await _repo.ReorderAsync(workspaceId, serviceIds);
        return NoContent();
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var deleted = await _repo.DeleteAsync(id);
        if (!deleted) return NotFound();
        return NoContent();
    }
}
