using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RequestLoom.Api.Models;
using RequestLoom.Api.Services;

namespace RequestLoom.Api.Controllers;

[ApiController]
[Route("api/oauth")]
public sealed class OAuthController : ControllerBase
{
    private readonly OAuthTokenService _tokenService;
    private readonly IHttpClientFactory _httpClientFactory;

    public OAuthController(OAuthTokenService tokenService, IHttpClientFactory httpClientFactory)
    {
        _tokenService = tokenService;
        _httpClientFactory = httpClientFactory;
    }

    [HttpPost("exchange")]
    public async Task<IActionResult> Exchange(
        [FromBody] OAuthTokenExchangeRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await _tokenService.ExchangeCodeAsync(request, cancellationToken);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpGet("status")]
    public IActionResult Status([FromQuery] string ownerKey)
    {
        try
        {
            return Ok(_tokenService.GetStatus(ownerKey));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete("token")]
    public IActionResult Disconnect([FromQuery] string ownerKey)
    {
        try
        {
            _tokenService.Clear(ownerKey);
            return NoContent();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpGet("discover")]
    public async Task<IActionResult> Discover([FromQuery] string issuer, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(issuer?.Trim(), UriKind.Absolute, out var issuerUri) ||
            (issuerUri.Scheme != Uri.UriSchemeHttp && issuerUri.Scheme != Uri.UriSchemeHttps))
        {
            return BadRequest(new { error = "OIDC issuer must be an absolute http/https URL." });
        }

        var issuerPath = issuerUri.AbsolutePath.TrimEnd('/');
        var discoveryUrl = issuerPath.EndsWith("/.well-known/openid-configuration", StringComparison.OrdinalIgnoreCase)
            ? issuerUri
            : new Uri($"{issuerUri.Scheme}://{issuerUri.Authority}{issuerPath}/.well-known/openid-configuration");

        try
        {
            var client = _httpClientFactory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, discoveryUrl);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var response = await client.SendAsync(request, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
                return BadRequest(new { error = $"OIDC discovery failed ({(int)response.StatusCode})." });

            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            return Ok(new OAuthDiscoveryResponse
            {
                Issuer = ReadString(root, "issuer") ?? issuerUri.ToString().TrimEnd('/'),
                AuthorizationEndpoint = ReadString(root, "authorization_endpoint") ?? "",
                TokenEndpoint = ReadString(root, "token_endpoint") ?? "",
                UserinfoEndpoint = ReadString(root, "userinfo_endpoint"),
                ScopesSupported = ReadStringArray(root, "scopes_supported"),
            });
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "OIDC discovery response was not valid JSON." });
        }
        catch (HttpRequestException ex)
        {
            return BadRequest(new { error = $"OIDC discovery failed: {ex.Message}" });
        }
    }

    private static string? ReadString(JsonElement root, string property)
    {
        return root.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private static string[] ReadStringArray(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.Array)
            return [];

        return value.EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString() ?? "")
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .ToArray();
    }
}
