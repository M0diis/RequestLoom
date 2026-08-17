using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Models;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

/// <summary>
/// Handles export and import of workspace data at multiple scopes:
/// workspace, service, and request level.
/// </summary>
[ApiController]
public class ExportImportController : ControllerBase
{
    private readonly ExportImportService _exportImportService;

    public ExportImportController(ExportImportService exportImportService)
    {
        _exportImportService = exportImportService;
    }

    /// <summary>
    /// Export all data for a workspace.
    /// </summary>
    [HttpGet("api/workspaces/{workspaceId}/export")]
    public async Task<IActionResult> ExportWorkspace(string workspaceId)
    {
        try
        {
            var data = await _exportImportService.ExportWorkspaceAsync(workspaceId);
            return Ok(data);
        }
        catch (InvalidOperationException)
        {
            return NotFound(new { error = "Workspace not found" });
        }
    }

    /// <summary>
    /// Import a workspace export as a brand-new workspace.
    /// </summary>
    [HttpPost("api/workspaces/import")]
    public async Task<IActionResult> ImportAsNewWorkspace([FromBody] WorkspaceExport data)
    {
        if (data == null)
            return BadRequest(new { error = "No import data provided" });

        if (data.Services.Count == 0 && data.Environments.Count == 0)
            return BadRequest(new { error = "Import data is empty: no services or environments found" });

        try
        {
            var workspace = await _exportImportService.ImportWorkspaceAsync(data);
            return CreatedAtAction(nameof(ImportAsNewWorkspace), new { id = workspace.Id }, workspace);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = $"Import failed: {ex.Message}" });
        }
    }

    /// <summary>
    /// Import data into an existing workspace (merge).
    /// </summary>
    [HttpPost("api/workspaces/{workspaceId}/import")]
    public async Task<IActionResult> ImportIntoWorkspace(string workspaceId, [FromBody] WorkspaceExport data)
    {
        if (data == null)
            return BadRequest(new { error = "No import data provided" });

        try
        {
            await _exportImportService.ImportIntoWorkspaceAsync(workspaceId, data);
            return Ok(new { message = "Import successful" });
        }
        catch (InvalidOperationException)
        {
            return NotFound(new { error = "Workspace not found" });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = $"Import failed: {ex.Message}" });
        }
    }

    /// <summary>
    /// Export a single service (with all its requests, variables, headers, auth).
    /// </summary>
    [HttpGet("api/services/{serviceId}/export")]
    public async Task<IActionResult> ExportService(string serviceId)
    {
        try
        {
            var data = await _exportImportService.ExportServiceAsync(serviceId);
            return Ok(data);
        }
        catch (InvalidOperationException)
        {
            return NotFound(new { error = "Service not found" });
        }
    }

    /// <summary>
    /// Export a single request (with all its headers, params, variables, auth).
    /// </summary>
    [HttpGet("api/requests/{requestId}/export")]
    public async Task<IActionResult> ExportRequest(string requestId)
    {
        try
        {
            var data = await _exportImportService.ExportRequestAsync(requestId);
            return Ok(data);
        }
        catch (InvalidOperationException)
        {
            return NotFound(new { error = "Request not found" });
        }
    }
}
