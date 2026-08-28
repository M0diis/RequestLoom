using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

/// <summary>
/// Provides cURL parsing/generation, code snippet generation, and request utilities.
/// </summary>
public partial class ToolsService
{
    private const string DefaultGeneratedUrl = "https://example.com";

    public CurlParseResult ParseCurl(string curlCommand)
    {
        var result = new CurlParseResult();
        var input = curlCommand.Trim();

        if (input.StartsWith("curl ", StringComparison.OrdinalIgnoreCase))
            input = input[5..];

        // Remove line continuations
        input = Regex.Replace(input, @"\\\r?\n\s*", " ");
        // Collapse whitespace
        input = Regex.Replace(input, @"\s+", " ");

        // Extract URL (last non-flag argument or the one with quotes)
        var urlMatch = UrlRegex().Match(input);
        if (urlMatch.Success)
        {
            result.Url = urlMatch.Groups[1].Value.Trim('\'', '"');
        }

        // Extract method
        var methodMatch = Regex.Match(input, @"(?:-X|--request)\s+['""]?(\w+)['""]?", RegexOptions.IgnoreCase);
        if (methodMatch.Success)
        {
            result.Method = methodMatch.Groups[1].Value.ToUpperInvariant();
        }
        else
        {
            // If there's -d/--data, it's POST; otherwise GET
            result.Method = Regex.IsMatch(input, @"(?:-d|--data|--data-raw|--data-binary)\s+") ? "POST" : "GET";
        }

        // Extract headers
        var headerMatches = Regex.Matches(input, @"(?:-H|--header)\s+['""]([^'""]+)['""]", RegexOptions.IgnoreCase);
        foreach (Match m in headerMatches)
        {
            var header = m.Groups[1].Value;
            var colonIndex = header.IndexOf(':');
            if (colonIndex > 0)
            {
                var key = header[..colonIndex].Trim();
                var value = header[(colonIndex + 1)..].Trim();
                result.Headers.Add(new KeyValuePairRequest { Key = key, Value = value, Enabled = true });
            }
        }

        // Extract body
        var bodyMatch = Regex.Match(input, @"(?:-d|--data|--data-raw)\s+['""]([^'""]*)['""]", RegexOptions.IgnoreCase);
        if (!bodyMatch.Success)
            bodyMatch = Regex.Match(input, @"(?:--data-binary)\s+['""]([^'""]*)['""]", RegexOptions.IgnoreCase);
        if (!bodyMatch.Success)
            bodyMatch = Regex.Match(input, @"(?:--data-binary)\s+@(['""]?[\w.\\/-]+['""]?)", RegexOptions.IgnoreCase);

        if (bodyMatch.Success)
        {
            result.Body = bodyMatch.Groups[1].Value;
            // Detect content type from headers or body content
            var contentType = result.Headers
                .FirstOrDefault(h => h.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))?.Value ?? "";
            if (contentType.Contains("json") || LooksLikeJson(result.Body))
                result.BodyType = "json";
            else if (contentType.Contains("xml"))
                result.BodyType = "xml";
            else if (contentType.Contains("form"))
                result.BodyType = "form";
            else
                result.BodyType = "text";
        }

        // Extract basic auth
        var basicAuthMatch = Regex.Match(input, @"(?:-u|--user)\s+['""]?([^:'""\s]+):([^'""\s]+)['""]?", RegexOptions.IgnoreCase);
        if (basicAuthMatch.Success)
        {
            var username = basicAuthMatch.Groups[1].Value;
            var password = basicAuthMatch.Groups[2].Value;
            result.Auth = new AuthRequest
            {
                AuthType = "basic",
                ConfigJson = JsonSerializer.Serialize(new { username, password })
            };
        }

        // Extract bearer token
        var bearerMatch = Regex.Match(input, @"(?:-H|--header)\s+['""]Authorization:\s*Bearer\s+([^'""]+)['""]", RegexOptions.IgnoreCase);
        if (bearerMatch.Success && result.Auth == null)
        {
            result.Auth = new AuthRequest
            {
                AuthType = "bearer",
                ConfigJson = JsonSerializer.Serialize(new { token = bearerMatch.Groups[1].Value.Trim() })
            };
        }

        // Try to infer service name from URL path
        if (!string.IsNullOrWhiteSpace(result.Url) && Uri.TryCreate(result.Url, UriKind.Absolute, out var uri))
        {
            var segments = uri.AbsolutePath.Trim('/').Split('/');
            result.ServiceName = segments.Length > 0 ? segments[0] : "";
        }

        return result;
    }

    private static bool LooksLikeJson(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        var trimmed = text.TrimStart();
        return trimmed.StartsWith('{') || trimmed.StartsWith('[');
    }

    public string GenerateCurl(ExecuteRequestPayload payload)
    {
        var sb = new StringBuilder();
        sb.Append("curl");
        var url = string.IsNullOrWhiteSpace(payload.Url) ? DefaultGeneratedUrl : payload.Url;

        // Method
        if (!string.Equals(payload.Method, "GET", StringComparison.OrdinalIgnoreCase))
            sb.Append($" -X {payload.Method}");

        // URL
        sb.Append($" '{EscapeBash(url)}'");

        // Headers
        foreach (var h in payload.Headers.Where(h => h.Enabled && !string.IsNullOrWhiteSpace(h.Key)))
        {
            sb.Append($" \\\n  -H '{EscapeBash(h.Key)}: {EscapeBash(h.Value ?? "")}'");
        }

        // Body
        if (!string.IsNullOrWhiteSpace(payload.Body))
        {
            var escapedBody = EscapeBash(payload.Body);
            sb.Append($" \\\n  -d '{escapedBody}'");
        }

        sb.Append('\n');
        return sb.ToString();
    }

    public List<CodeSnippet> GenerateSnippets(ExecuteRequestPayload payload, string? language = null)
    {
        var snippets = new List<CodeSnippet>();

        var headersList = payload.Headers
            .Where(h => h.Enabled && !string.IsNullOrWhiteSpace(h.Key))
            .ToList();

        var body = payload.Body;
        var method = payload.Method.ToUpperInvariant();
        var url = string.IsNullOrWhiteSpace(payload.Url) ? DefaultGeneratedUrl : payload.Url;
        var contentType = headersList
            .FirstOrDefault(h => h.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))?.Value ?? "";

        if (language == null || language == "curl")
            snippets.Add(new CodeSnippet { Language = "Shell", Client = "cURL", Code = GenerateCurl(payload).TrimEnd() });

        if (language == null || language == "javascript-fetch")
            snippets.Add(new CodeSnippet { Language = "JavaScript", Client = "fetch", Code = GenerateJsFetch(method, url, headersList, body, contentType) });

        if (language == null || language == "javascript-axios")
            snippets.Add(new CodeSnippet { Language = "JavaScript", Client = "axios", Code = GenerateJsAxios(method, url, headersList, body, contentType) });

        if (language == null || language == "python-requests")
            snippets.Add(new CodeSnippet { Language = "Python", Client = "requests", Code = GeneratePythonRequests(method, url, headersList, body, contentType) });

        if (language == null || language == "python-httpx")
            snippets.Add(new CodeSnippet { Language = "Python", Client = "httpx", Code = GeneratePythonHttpx(method, url, headersList, body, contentType) });

        if (language == null || language == "go")
            snippets.Add(new CodeSnippet { Language = "Go", Client = "net/http", Code = GenerateGo(method, url, headersList, body, contentType) });

        if (language == null || language == "csharp")
            snippets.Add(new CodeSnippet { Language = "C#", Client = "HttpClient", Code = GenerateCSharp(method, url, headersList, body, contentType) });

        if (language == null || language == "java")
            snippets.Add(new CodeSnippet { Language = "Java", Client = "HttpClient", Code = GenerateJava(method, url, headersList, body, contentType) });

        if (language == null || language == "php")
            snippets.Add(new CodeSnippet { Language = "PHP", Client = "cURL", Code = GeneratePhp(method, url, headersList, body, contentType) });

        if (language == null || language == "ruby")
            snippets.Add(new CodeSnippet { Language = "Ruby", Client = "Net::HTTP", Code = GenerateRuby(method, url, headersList, body, contentType) });

        return snippets;
    }

    private static string EscapeBash(string s) => s.Replace("'", "'\"'\"'");

    private static string EscapeJs(string s) => s.Replace("\\", "\\\\").Replace("'", "\\'").Replace("\n", "\\n");

    private static string EscapePython(string s) => s.Replace("\\", "\\\\").Replace("'", "\\'");

    private static string EscapeJava(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n");

    private static string EscapeRuby(string s) => s.Replace("\\", "\\\\").Replace("'", "\\'").Replace("\n", "\\n");

    private static string GenerateJsFetch(string method, string url, List<KeyValuePairRequest> headers, string? body, string contentType)
    {
        var sb = new StringBuilder();
        var indent = "  ";

        sb.AppendLine("fetch('" + EscapeJs(url) + "', {");
        sb.AppendLine(indent + "method: '" + method + "',");

        if (headers.Count > 0)
        {
            sb.AppendLine(indent + "headers: {");
            foreach (var h in headers)
                sb.AppendLine(indent + indent + "'" + EscapeJs(h.Key) + "': '" + EscapeJs(h.Value) + "',");
            sb.AppendLine(indent + "},");
        }

        if (!string.IsNullOrWhiteSpace(body))
        {
            sb.AppendLine(indent + "body: '" + EscapeJs(body) + "',");
        }

        sb.AppendLine("})");
        sb.AppendLine(indent + ".then(response => response.json())");
        sb.AppendLine(indent + ".then(data => console.log(data))");
        sb.AppendLine(indent + ".catch(error => console.error(error));");

        return sb.ToString().TrimEnd();
    }

    private static string GenerateJsAxios(string method, string url, List<KeyValuePairRequest> headers, string? body, string contentType)
    {
        var sb = new StringBuilder();

        sb.AppendLine("import axios from 'axios';");
        sb.AppendLine();
        sb.AppendLine("axios({");
        sb.AppendLine("  method: '" + method.ToLowerInvariant() + "',");
        sb.AppendLine("  url: '" + EscapeJs(url) + "',");

        if (headers.Count > 0)
        {
            sb.AppendLine("  headers: {");
            foreach (var h in headers)
                sb.AppendLine("    '" + EscapeJs(h.Key) + "': '" + EscapeJs(h.Value) + "',");
            sb.AppendLine("  },");
        }

        if (!string.IsNullOrWhiteSpace(body))
        {
            sb.AppendLine("  data: " + body + ",");
        }

        sb.AppendLine("})");
        sb.AppendLine("  .then(response => console.log(response.data))");
        sb.AppendLine("  .catch(error => console.error(error));");

        return sb.ToString().TrimEnd();
    }

    private static string GeneratePythonRequests(string method, string url, List<KeyValuePairRequest> headers, string? body, string contentType)
    {
        var sb = new StringBuilder();

        sb.AppendLine("import requests");
        sb.AppendLine();

        if (headers.Count > 0)
        {
            sb.AppendLine("headers = {");
            foreach (var h in headers)
                sb.AppendLine("    '" + EscapePython(h.Key) + "': '" + EscapePython(h.Value) + "',");
            sb.AppendLine("}");
            sb.AppendLine();
        }

        var hasBody = !string.IsNullOrWhiteSpace(body);
        if (hasBody)
        {
            sb.AppendLine("data = '''" + body + "'''");
            sb.AppendLine();
        }

        var args = new List<string> { $"url='{EscapePython(url)}'" };
        if (headers.Count > 0) args.Add("headers=headers");
        if (hasBody) args.Add("data=data");

        sb.AppendLine($"response = requests.{method.ToLowerInvariant()}({string.Join(", ", args)})");
        sb.AppendLine();
        sb.AppendLine("print(response.status_code)");
        sb.AppendLine("print(response.text)");

        return sb.ToString().TrimEnd();
    }

    private static string GeneratePythonHttpx(string method, string url, List<KeyValuePairRequest> headers, string? body, string contentType)
    {
        var sb = new StringBuilder();

        sb.AppendLine("import httpx");
        sb.AppendLine();

        if (headers.Count > 0)
        {
            sb.AppendLine("headers = {");
            foreach (var h in headers)
                sb.AppendLine("    '" + EscapePython(h.Key) + "': '" + EscapePython(h.Value) + "',");
            sb.AppendLine("}");
            sb.AppendLine();
        }

        var hasBody = !string.IsNullOrWhiteSpace(body);
        if (hasBody)
        {
            sb.AppendLine("data = '''" + body + "'''");
            sb.AppendLine();
        }

        var args = new List<string>();
        if (headers.Count > 0) args.Add("headers=headers");
        if (hasBody) args.Add("content=data");

        var indent = "    ";
        sb.AppendLine($"with httpx.Client() as client:");
        sb.AppendLine($"{indent}response = client.{method.ToLowerInvariant()}('{EscapePython(url)}'{(args.Count > 0 ? ", " + string.Join(", ", args) : "")})");
        sb.AppendLine($"{indent}print(response.status_code)");
        sb.AppendLine($"{indent}print(response.text)");

        return sb.ToString().TrimEnd();
    }

    private static string GenerateGo(string method, string url, List<KeyValuePairRequest> headers, string? body, string contentType)
    {
        var sb = new StringBuilder();

        sb.AppendLine("package main");
        sb.AppendLine();
        sb.AppendLine("import (");
        sb.AppendLine("    \"fmt\"");
        sb.AppendLine("    \"net/http\"");
        sb.AppendLine("    \"io\"");
        if (!string.IsNullOrWhiteSpace(body))
        {
            sb.AppendLine("    \"strings\"");
        }
        sb.AppendLine(")");
        sb.AppendLine();
        sb.AppendLine("func main() {");

        var hasBody = !string.IsNullOrWhiteSpace(body);

        if (hasBody)
        {
            sb.AppendLine($"    payload := strings.NewReader(`{body}`)");
            sb.AppendLine($"    req, _ := http.NewRequest(\"{method}\", \"{url}\", payload)");
        }
        else
        {
            sb.AppendLine($"    req, _ := http.NewRequest(\"{method}\", \"{url}\", nil)");
        }

        foreach (var h in headers)
            sb.AppendLine($"    req.Header.Add(\"{h.Key}\", \"{h.Value}\")");

        sb.AppendLine();
        sb.AppendLine("    client := &http.Client{}");
        sb.AppendLine("    resp, err := client.Do(req)");
        sb.AppendLine("    if err != nil { panic(err) }");
        sb.AppendLine("    defer resp.Body.Close()");
        sb.AppendLine();
        sb.AppendLine("    bodyBytes, _ := io.ReadAll(resp.Body)");
        sb.AppendLine("    fmt.Println(resp.StatusCode)");
        sb.AppendLine("    fmt.Println(string(bodyBytes))");
        sb.AppendLine("}");

        return sb.ToString().TrimEnd();
    }

    private static string GenerateCSharp(string method, string url, List<KeyValuePairRequest> headers, string? body, string contentType)
    {
        var sb = new StringBuilder();

        sb.AppendLine("using System;");
        sb.AppendLine("using System.Net.Http;");
        sb.AppendLine("using System.Text;");
        sb.AppendLine("using System.Threading.Tasks;");
        sb.AppendLine();
        sb.AppendLine("var client = new HttpClient();");
        sb.AppendLine();
        sb.AppendLine($"var request = new HttpRequestMessage(HttpMethod.{method switch { "GET" => "Get", "POST" => "Post", "PUT" => "Put", "PATCH" => "Patch", "DELETE" => "Delete", "OPTIONS" => "Options", "HEAD" => "Head", _ => "Get" }}, \"{url}\");");

        foreach (var h in headers)
            sb.AppendLine($"request.Headers.Add(\"{h.Key}\", \"{h.Value}\");");

        if (!string.IsNullOrWhiteSpace(body))
        {
            sb.AppendLine($"request.Content = new StringContent(@\"{body.Replace("\"", "\"\"")}\", Encoding.UTF8, \"{contentType}\");");
        }

        sb.AppendLine();
        sb.AppendLine("var response = await client.SendAsync(request);");
        sb.AppendLine("var responseBody = await response.Content.ReadAsStringAsync();");
        sb.AppendLine();
        sb.AppendLine("Console.WriteLine((int)response.StatusCode);");
        sb.AppendLine("Console.WriteLine(responseBody);");

        return sb.ToString().TrimEnd();
    }

    private static string GenerateJava(string method, string url, List<KeyValuePairRequest> headers, string? body, string contentType)
    {
        var sb = new StringBuilder();

        sb.AppendLine("import java.net.URI;");
        sb.AppendLine("import java.net.http.HttpClient;");
        sb.AppendLine("import java.net.http.HttpRequest;");
        sb.AppendLine("import java.net.http.HttpResponse;");
        sb.AppendLine("import java.net.http.HttpRequest.BodyPublishers;");
        sb.AppendLine("import java.net.http.HttpResponse.BodyHandlers;");
        sb.AppendLine();
        sb.AppendLine("var client = HttpClient.newHttpClient();");
        sb.AppendLine();

        var builder = $"HttpRequest.newBuilder()";
        sb.AppendLine($"var request = {builder}");
        sb.AppendLine($"    .uri(URI.create(\"{url}\"))");

        var hasBody = !string.IsNullOrWhiteSpace(body);

        if (hasBody && method == "POST")
            sb.AppendLine($"    .POST(BodyPublishers.ofString(\"{EscapeJava(body)}\"))");
        else if (hasBody)
            sb.AppendLine($"    .method(\"{method}\", BodyPublishers.ofString(\"{EscapeJava(body)}\"))");
        else if (method != "GET")
            sb.AppendLine($"    .method(\"{method}\", BodyPublishers.noBody())");
        else
            sb.AppendLine($"    .GET()");

        foreach (var h in headers)
            sb.AppendLine($"    .header(\"{h.Key}\", \"{h.Value}\")");

        sb.AppendLine("    .build();");
        sb.AppendLine();

        sb.AppendLine("var response = client.send(request, BodyHandlers.ofString());");
        sb.AppendLine();
        sb.AppendLine("System.out.println(response.statusCode());");
        sb.AppendLine("System.out.println(response.body());");

        return sb.ToString().TrimEnd();
    }

    private static string GeneratePhp(string method, string url, List<KeyValuePairRequest> headers, string? body, string contentType)
    {
        var sb = new StringBuilder();

        sb.AppendLine("<?php");
        sb.AppendLine();
        sb.AppendLine($"$curl = curl_init('{url}');");
        sb.AppendLine();
        sb.AppendLine($"curl_setopt($curl, CURLOPT_CUSTOMREQUEST, '{method}');");
        sb.AppendLine("curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);");

        if (headers.Count > 0)
        {
            sb.AppendLine("curl_setopt($curl, CURLOPT_HTTPHEADER, [");
            foreach (var h in headers)
                sb.AppendLine($"    '{h.Key}: {h.Value}',");
            sb.AppendLine("]);");
        }

        if (!string.IsNullOrWhiteSpace(body))
        {
            sb.AppendLine($"curl_setopt($curl, CURLOPT_POSTFIELDS, '{EscapeJs(body)}');");
        }

        sb.AppendLine();
        sb.AppendLine("$response = curl_exec($curl);");
        sb.AppendLine("$httpCode = curl_getinfo($curl, CURLINFO_HTTP_CODE);");
        sb.AppendLine("curl_close($curl);");
        sb.AppendLine();
        sb.AppendLine("echo $httpCode;");
        sb.AppendLine("echo $response;");

        return sb.ToString().TrimEnd();
    }

    private static string GenerateRuby(string method, string url, List<KeyValuePairRequest> headers, string? body, string contentType)
    {
        var sb = new StringBuilder();

        sb.AppendLine("require 'net/http'");
        sb.AppendLine("require 'json'");
        sb.AppendLine();
        sb.AppendLine($"uri = URI('{url}')");
        sb.AppendLine();
        var methodClass = method switch { "GET" => "Net::HTTP::Get", "POST" => "Net::HTTP::Post", "PUT" => "Net::HTTP::Put", "PATCH" => "Net::HTTP::Patch", "DELETE" => "Net::HTTP::Delete", _ => "Net::HTTP::Get" };
        sb.AppendLine($"request = {methodClass}.new(uri)");

        foreach (var h in headers)
            sb.AppendLine($"request['{h.Key}'] = '{h.Value}'");

        if (!string.IsNullOrWhiteSpace(body))
        {
            sb.AppendLine($"request.body = '{EscapeRuby(body)}'");
        }

        sb.AppendLine();
        sb.AppendLine("response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https') do |http|");
        sb.AppendLine("  http.request(request)");
        sb.AppendLine("end");
        sb.AppendLine();
        sb.AppendLine("puts response.code");
        sb.AppendLine("puts response.body");

        return sb.ToString().TrimEnd();
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"(?:'([^']*)'|\""([^\""]*)\"")\s*$|(\S+)$")]
    private static partial Regex UrlRegex();
}
