using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

[ApiController]
public class SettingsController : ControllerBase
{
    private readonly SettingsService _settings;
    private readonly IHistoryRepository _historyRepo;
    private readonly ExampleDataService _exampleData;
    private readonly StorageMigrationService _migration;

    public SettingsController(
        SettingsService settings,
        IHistoryRepository historyRepo,
        ExampleDataService exampleData,
        StorageMigrationService migration)
    {
        _settings = settings;
        _historyRepo = historyRepo;
        _exampleData = exampleData;
        _migration = migration;
    }

    [HttpGet("api/settings")]
    public IActionResult GetSettings()
    {
        return Ok(_settings.GetSettings());
    }

    [HttpPut("api/settings")]
    public IActionResult UpdateSettings([FromBody] UpdateSettingsRequest request)
    {
        if (request == null)
            return BadRequest(new { error = "No settings provided" });

        try
        {
            var storageModeChanged = request.StorageMode != null &&
                !string.Equals(request.StorageMode, _settings.Mode, StringComparison.OrdinalIgnoreCase);
            var strategyChanged = request.JsonStorageStrategy != null &&
                !string.Equals(request.JsonStorageStrategy, _settings.JsonStorageStrategy, StringComparison.OrdinalIgnoreCase);
            if (storageModeChanged || strategyChanged)
            {
                return BadRequest(new { error = "Storage changes require migration confirmation." });
            }

            var result = _settings.Update(request);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("api/settings/migrate")]
    public async Task<IActionResult> MigrateStorage([FromBody] UpdateSettingsRequest request)
    {
        if (request == null)
            return BadRequest(new { error = "No settings provided" });

        try
        {
            var targetMode = string.IsNullOrWhiteSpace(request.StorageMode) ? _settings.Mode : request.StorageMode;
            var targetStrategy = string.IsNullOrWhiteSpace(request.JsonStorageStrategy)
                ? _settings.JsonStorageStrategy
                : request.JsonStorageStrategy;
            await _migration.MigrateAsync(targetMode!, targetStrategy!);
            return Ok(_settings.Update(request));
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (IOException ex)
        {
            return BadRequest(new { error = $"Storage migration failed: {ex.Message}" });
        }
    }

    [HttpDelete("api/settings/history")]
    public async Task<IActionResult> ClearHistory()
    {
        var count = await _historyRepo.ClearAllAsync();
        return Ok(new { deleted = count });
    }

    /// <summary>Generate a "Sandbox" workspace with example services, requests, variables, and mock servers.</summary>
    [HttpPost("api/settings/examples")]
    public async Task<IActionResult> GenerateExamples()
    {
        try
        {
            var workspaceId = await _exampleData.GenerateExamplesAsync();
            return Ok(new { workspaceId, name = "Sandbox", message = "Example workspace created successfully. Switch to the Sandbox workspace to explore." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>Clear ALL data (workspaces, services, requests, variables, mock servers, history). Irreversible.</summary>
    [HttpDelete("api/settings/data")]
    public async Task<IActionResult> ClearAllData()
    {
        try
        {
            var count = await _exampleData.ClearAllDataAsync();
            return Ok(new { deleted = count, message = $"All data cleared ({count} records deleted). Refresh the page to see changes." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }
}
