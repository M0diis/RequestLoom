using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Models;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ExecuteController : ControllerBase
{
    private readonly RequestExecutionService _executionService;

    public ExecuteController(RequestExecutionService executionService)
    {
        _executionService = executionService;
    }

    [HttpPost]
    public async Task<IActionResult> Execute([FromBody] ExecuteRequestPayload payload, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(payload.Url))
            return BadRequest("URL is required");

        var result = await _executionService.ExecuteAsync(payload, cancellationToken);
        return Ok(result);
    }
}
