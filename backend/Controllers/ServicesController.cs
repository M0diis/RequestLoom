using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/workspaces/{workspaceId}/[controller]")]
public class ServicesController : ControllerBase
{
    private readonly IServiceRepository _repo;
    private readonly JsonDataStore _jsonStore;

    public ServicesController(IServiceRepository repo, JsonDataStore jsonStore)
    {
        _repo = repo;
        _jsonStore = jsonStore;
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
            request.Auth,
            request.StoragePath);
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

    [HttpPost("{id}/files")]
    public async Task<IActionResult> CreateFile(string id, [FromBody] CreateServiceFileRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("File name is required");

        try
        {
            var path = _jsonStore.CreateServiceFile(id, request.Name, request.Kind);
            return Ok(new { path });
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
    }
}
