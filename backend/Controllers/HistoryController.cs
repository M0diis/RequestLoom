using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data.Repositories;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/workspaces/{workspaceId}/[controller]")]
public class HistoryController : ControllerBase
{
    private readonly IHistoryRepository _repo;

    public sealed class HistoryQuery
    {
        public int Limit { get; set; } = 50;
        public int Offset { get; set; } = 0;
        public string? Method { get; set; }
        public int? Status { get; set; }
        public string? RequestId { get; set; }
    }

    public HistoryController(IHistoryRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(string workspaceId, [FromQuery] HistoryQuery query)
    {
        var requestId = query.RequestId;

        if (string.IsNullOrWhiteSpace(requestId))
        {
            requestId = HttpContext.Request.Query["request_id"].FirstOrDefault();
        }

        var history = await _repo.GetByWorkspaceAsync(
            workspaceId,
            query.Limit,
            query.Offset,
            query.Method,
            query.Status,
            requestId);

        return Ok(history);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id)
    {
        var entry = await _repo.GetByIdAsync(id);
        if (entry == null) return NotFound();
        return Ok(entry);
    }

    [HttpGet("count")]
    public async Task<IActionResult> Count(string workspaceId, [FromQuery] string? requestId = null)
    {
        var count = await _repo.CountAsync(workspaceId, requestId);
        return Ok(new { count });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var deleted = await _repo.DeleteAsync(id);
        if (!deleted) return NotFound();
        return NoContent();
    }

    [HttpDelete]
    public async Task<IActionResult> ClearAll(string workspaceId)
    {
        var count = await _repo.ClearWorkspaceHistoryAsync(workspaceId);
        return Ok(new { deleted = count });
    }

    [HttpDelete("request/{requestId}")]
    public async Task<IActionResult> ClearForRequest(string requestId)
    {
        var count = await _repo.ClearRequestHistoryAsync(requestId);
        return Ok(new { deleted = count });
    }
}
