using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/tools")]
public class ToolsController : ControllerBase
{
    private readonly ToolsService _tools;
    private readonly IRequestRepository _requestRepo;

    public ToolsController(ToolsService tools, IRequestRepository requestRepo)
    {
        _tools = tools;
        _requestRepo = requestRepo;
    }

    /// <summary>Parse a cURL command into request parts.</summary>
    [HttpPost("curl/parse")]
    public IActionResult ParseCurl([FromBody] CurlImportRequest req)
    {
        if (string.IsNullOrWhiteSpace(req?.Curl))
            return BadRequest(new { error = "cURL command is required" });

        try
        {
            var result = _tools.ParseCurl(req.Curl);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Generate a cURL command from a request payload.</summary>
    [HttpPost("curl/generate")]
    public async Task<IActionResult> GenerateCurl([FromBody] ExecuteRequestPayload payload)
    {
        if (payload == null)
            return BadRequest(new { error = "Request payload is required" });

        var curl = await _tools.GenerateCurlAsync(payload);
        return Ok(new { curl });
    }

    /// <summary>Generate code snippets for a request.</summary>
    [HttpPost("snippets")]
    public async Task<IActionResult> GenerateSnippets([FromBody] SnippetRequest req)
    {
        if (req == null)
            return BadRequest(new { error = "Request payload is required" });

        var payload = new ExecuteRequestPayload
        {
            Method = req.Method,
            Url = req.Url,
            Body = req.Body,
            BodyType = req.BodyType,
            Headers = req.Headers,
            Params = req.Params,
            Variables = req.Variables,
            Auth = req.Auth,
            WorkspaceId = req.WorkspaceId,
            ServiceId = req.ServiceId,
            RequestId = req.RequestId,
        };

        var snippets = await _tools.GenerateSnippetsAsync(payload, req.Language);
        return Ok(snippets);
    }

    /// <summary>Return the supported dynamic request value definitions.</summary>
    [HttpGet("dynamic-values")]
    public IActionResult GetDynamicValues()
    {
        return Ok(DynamicValueRegistry.GetDefinitions());
    }
}

public class CurlImportRequest
{
    public string Curl { get; set; } = "";
}
