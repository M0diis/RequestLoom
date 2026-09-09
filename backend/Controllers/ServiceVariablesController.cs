using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/services/{serviceId}/variables")]
public class ServiceVariablesController : ControllerBase
{
    private readonly IServiceVariableRepository _repo;
    private readonly IServiceRepository _serviceRepo;
    private readonly RuntimeVariableStore _runtimeVariableStore;

    public ServiceVariablesController(
        IServiceVariableRepository repo,
        IServiceRepository serviceRepo,
        RuntimeVariableStore runtimeVariableStore)
    {
        _repo = repo;
        _serviceRepo = serviceRepo;
        _runtimeVariableStore = runtimeVariableStore;
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

        var service = await _serviceRepo.GetByIdAsync(serviceId);
        if (service == null) return NotFound("Service not found");

        var variable = await _repo.UpsertAsync(
            serviceId,
            request.Id,
            request.Key.Trim(),
            request.Value,
            request.IsSecret,
            request.Enabled,
            request.EnvironmentId);

        // A manual edit is authoritative. Drop any service-scoped runtime
        // values so a deleted/disabled/renamed persisted variable cannot keep
        // supplying an old value on the next request.
        _runtimeVariableStore.ClearService(service.WorkspaceId, serviceId);

        return Ok(variable);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string serviceId, string id)
    {
        var service = await _serviceRepo.GetByIdAsync(serviceId);
        if (service == null) return NotFound("Service not found");

        var variable = (await _repo.GetByServiceAsync(serviceId))
            .FirstOrDefault(item => item.Id == id);
        if (variable == null) return NotFound();

        var deleted = await _repo.DeleteAsync(id);
        if (!deleted) return NotFound();

        _runtimeVariableStore.ClearService(service.WorkspaceId, serviceId);
        return NoContent();
    }
}
