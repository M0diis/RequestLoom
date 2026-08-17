using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/services/{serviceId}/variables")]
public class ServiceVariablesController : ControllerBase
{
    private readonly IServiceVariableRepository _repo;

    public ServiceVariablesController(IServiceVariableRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(string serviceId)
    {
        var variables = await _repo.GetByServiceAsync(serviceId);
        return Ok(variables);
    }

    [HttpPut]
    public async Task<IActionResult> Upsert(string serviceId, [FromBody] UpsertServiceVariableRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Key))
            return BadRequest("Key is required");

        var variable = await _repo.UpsertAsync(
            serviceId,
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
}
