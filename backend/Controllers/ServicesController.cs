using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/workspaces/{workspaceId}/[controller]")]
public class ServicesController : ControllerBase
{
    private readonly IServiceRepository _repo;
    private readonly JsonDataStore _jsonStore;
    private readonly JavaScriptRunnerService _javascriptRunner;

    public ServicesController(
        IServiceRepository repo,
        JsonDataStore jsonStore,
        JavaScriptRunnerService javascriptRunner)
    {
        _repo = repo;
        _jsonStore = jsonStore;
        _javascriptRunner = javascriptRunner;
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
            var service = await _repo.GetByIdAsync(id);
            if (service == null) return NotFound();

            var file = _jsonStore.CreateServiceFile(
                service.Id,
                service.Name,
                service.StoragePath,
                request.Name,
                request.Kind);
            return Ok(file);
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

    [HttpGet("{id}/files")]
    public async Task<IActionResult> GetFiles(string id)
    {
        var service = await _repo.GetByIdAsync(id);
        if (service == null) return NotFound();

        return Ok(_jsonStore.GetServiceFiles(service.Id, service.Name, service.StoragePath));
    }

    [HttpPut("{id}/files/{fileName}")]
    public async Task<IActionResult> SaveFile(string id, string fileName, [FromBody] SaveServiceFileRequest request)
    {
        var service = await _repo.GetByIdAsync(id);
        if (service == null) return NotFound();

        try
        {
            _jsonStore.SaveServiceFile(service.Id, service.Name, service.StoragePath, fileName, request.Content);
            return NoContent();
        }
        catch (FileNotFoundException)
        {
            return NotFound();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpDelete("{id}/files/{fileName}")]
    public async Task<IActionResult> DeleteFile(string id, string fileName)
    {
        var service = await _repo.GetByIdAsync(id);
        if (service == null) return NotFound();

        try
        {
            _jsonStore.DeleteServiceFile(service.Id, service.Name, service.StoragePath, fileName);
            return NoContent();
        }
        catch (FileNotFoundException)
        {
            return NotFound();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPost("{id}/files/{fileName}/run")]
    public async Task<IActionResult> RunFile(string id, string fileName, [FromBody] RunServiceFileRequest request)
    {
        var service = await _repo.GetByIdAsync(id);
        if (service == null) return NotFound();

        try
        {
            _jsonStore.SaveServiceFile(service.Id, service.Name, service.StoragePath, fileName, request.Code);
            return Ok(_javascriptRunner.Run(request.Code));
        }
        catch (FileNotFoundException)
        {
            return NotFound();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
    }
}
