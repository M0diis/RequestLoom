using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class RequestsController : ControllerBase
{
    private readonly IRequestRepository _repo;
    private readonly JsonDataStore _jsonStore;
    private readonly SettingsService _settings;

    public RequestsController(IRequestRepository repo, JsonDataStore jsonStore, SettingsService settings)
    {
        _repo = repo;
        _jsonStore = jsonStore;
        _settings = settings;
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id)
    {
        var request = await _repo.GetByIdAsync(id);
        if (request == null) return NotFound();
        return Ok(request);
    }

    [HttpPost("service/{serviceId}")]
    public async Task<IActionResult> Create(string serviceId, [FromBody] CreateApiRequestRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Name is required");

        var created = await _repo.CreateAsync(serviceId, request);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateApiRequestRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Name is required");

        var updated = await _repo.UpdateAsync(id, request);
        if (updated == null) return NotFound();
        return Ok(updated);
    }

    [HttpPost("{id}/duplicate")]
    public async Task<IActionResult> Duplicate(string id)
    {
        var duplicated = await _repo.DuplicateAsync(id);
        if (duplicated == null) return NotFound();
        return CreatedAtAction(nameof(GetById), new { id = duplicated.Id }, duplicated);
    }

    [HttpPost("{id}/favorite")]
    public async Task<IActionResult> ToggleFavorite(string id)
    {
        var toggled = await _repo.ToggleFavoriteAsync(id);
        if (!toggled) return NotFound();
        return NoContent();
    }

    [HttpPost("{id}/move/{newServiceId}")]
    public async Task<IActionResult> MoveToService(string id, string newServiceId)
    {
        var moved = await _repo.MoveToServiceAsync(id, newServiceId);
        if (!moved) return NotFound();
        return NoContent();
    }

    [HttpGet("{id}/settings")]
    public async Task<IActionResult> GetSettings(string id)
    {
        var request = await _repo.GetByIdAsync(id);
        if (request == null) return NotFound();

        var settings = await _repo.GetSettingsAsync(id);
        return Ok(settings ?? new ApiRequestSettings
        {
            RequestId = id,
            FollowRedirects = _settings.FollowRedirects,
            MaxRedirects = _settings.MaxRedirects,
        });
    }

    [HttpPut("{id}/settings")]
    public async Task<IActionResult> SaveSettings(string id, [FromBody] ApiRequestSettings settings)
    {
        var request = await _repo.GetByIdAsync(id);
        if (request == null) return NotFound();

        settings.RequestId = id;
        var saved = await _repo.SaveSettingsAsync(id, settings);
        return Ok(saved);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var deleted = await _repo.DeleteAsync(id);
        if (!deleted) return NotFound();
        return NoContent();
    }

    [HttpGet("{id}/file")]
    public async Task<IActionResult> GetStoredFile(string id)
    {
        var request = await _repo.GetByIdAsync(id);
        if (request == null) return NotFound();

        if (_jsonStore.IsJsonStorage)
        {
            var stored = _jsonStore.GetRequestFile(id);
            if (stored != null) return Ok(stored);
        }

        return Ok(new StoredRequestFile
        {
            RequestId = id,
            FilePath = "",
            Content = System.Text.Json.JsonSerializer.Serialize(request, new System.Text.Json.JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase }),
            IsJsonStorage = false,
        });
    }
}
