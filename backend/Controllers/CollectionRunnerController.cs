using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Models;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api")]
public class CollectionRunnerController : ControllerBase
{
    private readonly CollectionRunnerService _runner;

    public CollectionRunnerController(CollectionRunnerService runner)
    {
        _runner = runner;
    }

    /// <summary>Run all requests in a service as a collection.</summary>
    [HttpPost("services/{serviceId}/run")]
    public async Task<IActionResult> RunCollection(
        string serviceId,
        [FromBody] RunCollectionRequest? req,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await _runner.RunServiceAsync(
                serviceId,
                req?.EnvironmentId,
                req?.StopOnFailure ?? false,
                cancellationToken);

            return Ok(result);
        }
        catch (InvalidOperationException)
        {
            return NotFound(new { error = "Service not found" });
        }
        catch (OperationCanceledException)
        {
            return StatusCode(499, new { error = "Collection run cancelled" });
        }
    }
}
