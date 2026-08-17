using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Models;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/workspaces/{workspaceId}/imports")]
public class ImportsController : ControllerBase
{
    private readonly SpecificationImportService _importService;
    private readonly CollectionImportService _collectionImportService;

    public ImportsController(SpecificationImportService importService, CollectionImportService collectionImportService)
    {
        _importService = importService;
        _collectionImportService = collectionImportService;
    }

    [HttpPost("openapi")]
    public async Task<IActionResult> ImportOpenApi(string workspaceId, [FromBody] ImportSpecificationRequest request)
    {
        try
        {
            var result = await _importService.ImportOpenApiAsync(workspaceId, request);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("wsdl")]
    public async Task<IActionResult> ImportWsdl(string workspaceId, [FromBody] ImportSpecificationRequest request)
    {
        try
        {
            var result = await _importService.ImportWsdlAsync(workspaceId, request);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("postman")]
    public async Task<IActionResult> ImportPostman(string workspaceId, [FromBody] ImportSpecificationRequest request)
    {
        try
        {
            var result = await _collectionImportService.ImportPostmanAsync(workspaceId, request);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("bruno")]
    public async Task<IActionResult> ImportBruno(string workspaceId, [FromForm] IFormFileCollection files, [FromForm] string? serviceId, [FromForm] string? serviceName)
    {
        try
        {
            var importedFiles = new List<CollectionImportService.ImportedFile>();
            foreach (var file in files)
            {
                using var reader = new StreamReader(file.OpenReadStream());
                var content = await reader.ReadToEndAsync();
                importedFiles.Add(new CollectionImportService.ImportedFile
                {
                    FileName = file.FileName,
                    Content = content,
                });
            }

            var result = await _collectionImportService.ImportBrunoAsync(workspaceId, importedFiles, serviceId, serviceName);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}
