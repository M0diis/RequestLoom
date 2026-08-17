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
    public IActionResult GenerateCurl([FromBody] ExecuteRequestPayload payload)
    {
        if (payload == null || string.IsNullOrWhiteSpace(payload.Url))
            return BadRequest(new { error = "Request payload with URL is required" });

        var curl = _tools.GenerateCurl(payload);
        return Ok(new { curl });
    }

    /// <summary>Generate code snippets for a request.</summary>
    [HttpPost("snippets")]
    public IActionResult GenerateSnippets([FromBody] SnippetRequest req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.Url))
            return BadRequest(new { error = "Request payload with URL is required" });

        var payload = new ExecuteRequestPayload
        {
            Method = req.Method,
            Url = req.Url,
            Body = req.Body,
            BodyType = req.BodyType,
            Headers = req.Headers
        };

        var snippets = _tools.GenerateSnippets(payload, req.Language);
        return Ok(snippets);
    }
}

public class CurlImportRequest
{
    public string Curl { get; set; } = "";
}
