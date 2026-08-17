using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/workspaces/{workspaceId}/[controller]")]
public class MockServersController : ControllerBase
{
    private readonly IMockServerRepository _repo;

    public MockServersController(IMockServerRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(string workspaceId, [FromQuery] bool includeEndpoints = true)
    {
        var servers = await _repo.GetByWorkspaceAsync(workspaceId, includeEndpoints);
        return Ok(servers);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id, [FromQuery] bool includeEndpoints = true)
    {
        var server = await _repo.GetByIdAsync(id, includeEndpoints);
        if (server == null) return NotFound();
        return Ok(server);
    }

    [HttpPost]
    public async Task<IActionResult> Create(string workspaceId, [FromBody] CreateMockServerRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Name is required");

        var server = await _repo.CreateAsync(workspaceId, request.Name.Trim(), request.Description, request.Slug, request.Port);
        return CreatedAtAction(nameof(GetById), new { workspaceId, id = server.Id }, server);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateMockServerRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Name is required");

        var server = await _repo.UpdateAsync(id, request.Name.Trim(), request.Description, request.Slug, request.Port);
        if (server == null) return NotFound();
        return Ok(server);
    }

    [HttpPost("{id}/start")]
    public async Task<IActionResult> Start(string id)
    {
        var server = await _repo.GetByIdAsync(id);
        if (server == null) return NotFound();

        await _repo.SetRunningAsync(id, true);
        Services.MockServerService.SetRunning(id, true);
        return Ok(new { isRunning = true });
    }

    [HttpPost("{id}/stop")]
    public async Task<IActionResult> Stop(string id)
    {
        var server = await _repo.GetByIdAsync(id);
        if (server == null) return NotFound();

        await _repo.SetRunningAsync(id, false);
        Services.MockServerService.SetRunning(id, false);
        return Ok(new { isRunning = false });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var deleted = await _repo.DeleteAsync(id);
        if (!deleted) return NotFound();
        Services.MockServerService.SetRunning(id, false);
        return NoContent();
    }

    [HttpGet("{mockServerId}/endpoints")]
    public async Task<IActionResult> GetEndpoints(string mockServerId)
    {
        var server = await _repo.GetByIdAsync(mockServerId);
        if (server == null) return NotFound();

        var endpoints = await _repo.GetEndpointsAsync(mockServerId);
        return Ok(endpoints);
    }

    [HttpGet("{mockServerId}/endpoints/{endpointId}")]
    public async Task<IActionResult> GetEndpoint(string endpointId)
    {
        var endpoint = await _repo.GetEndpointByIdAsync(endpointId);
        if (endpoint == null) return NotFound();
        return Ok(endpoint);
    }

    [HttpPost("{mockServerId}/endpoints")]
    public async Task<IActionResult> CreateEndpoint(string mockServerId, [FromBody] CreateMockEndpointRequest request)
    {
        var server = await _repo.GetByIdAsync(mockServerId);
        if (server == null) return NotFound();

        if (string.IsNullOrWhiteSpace(request.Path))
            return BadRequest("Path is required");

        var endpoint = await _repo.CreateEndpointAsync(mockServerId, request);
        return CreatedAtAction(nameof(GetEndpoint), new { workspaceId = RouteData.Values["workspaceId"], mockServerId, endpointId = endpoint.Id }, endpoint);
    }

    [HttpPut("{mockServerId}/endpoints/{endpointId}")]
    public async Task<IActionResult> UpdateEndpoint(string endpointId, [FromBody] UpdateMockEndpointRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Path))
            return BadRequest("Path is required");

        var endpoint = await _repo.UpdateEndpointAsync(endpointId, request);
        if (endpoint == null) return NotFound();
        return Ok(endpoint);
    }

    [HttpDelete("{mockServerId}/endpoints/{endpointId}")]
    public async Task<IActionResult> DeleteEndpoint(string endpointId)
    {
        var deleted = await _repo.DeleteEndpointAsync(endpointId);
        if (!deleted) return NotFound();
        return NoContent();
    }
}
