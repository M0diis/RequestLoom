using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/workspaces/{workspaceId}/cookies")]
public sealed class CookiesController : ControllerBase
{
    private readonly CookieJarService _cookieJar;

    public CookiesController(CookieJarService cookieJar)
    {
        _cookieJar = cookieJar;
    }

    [HttpGet]
    public IActionResult Get(string workspaceId)
    {
        return Ok(_cookieJar.List(workspaceId));
    }

    [HttpDelete]
    public IActionResult Clear(string workspaceId)
    {
        _cookieJar.Clear(workspaceId);
        return NoContent();
    }
}
