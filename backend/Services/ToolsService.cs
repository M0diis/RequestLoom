using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

/// <summary>
/// Provides cURL parsing/generation, code snippet generation, and request utilities.
/// </summary>
public partial class ToolsService
{
    private const string DefaultGeneratedUrl = "https://example.com";
    private readonly VariableResolutionService _variableService;
    private readonly IServiceRepository _serviceRepo;
    private readonly IRequestRepository _requestRepo;
    private readonly RuntimeVariableStore _runtimeVariableStore;

    public ToolsService(
        VariableResolutionService variableService,
        IServiceRepository serviceRepo,
        IRequestRepository requestRepo,
        RuntimeVariableStore runtimeVariableStore)
    {
        _variableService = variableService;
        _serviceRepo = serviceRepo;
        _requestRepo = requestRepo;
        _runtimeVariableStore = runtimeVariableStore;
    }

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

    public async Task<string> GenerateCurlAsync(ExecuteRequestPayload payload)
    {
        var materialized = await PrepareSnapshotAsync(payload);
        return GenerateCurlMaterialized(materialized);
    }

    public async Task<List<CodeSnippet>> GenerateSnippetsAsync(ExecuteRequestPayload payload, string? language = null)
    {
        var materialized = await PrepareSnapshotAsync(payload);
        return GenerateSnippetsMaterialized(materialized, language);
    }

    private static string GenerateCurlMaterialized(ExecuteRequestPayload payload)
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
        foreach (var h in payload.Headers.Where(h =>
                     h.Enabled &&
                     !string.IsNullOrWhiteSpace(h.Key) &&
                     !(IsMultipartBodyType(payload.BodyType) &&
                       h.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))))
        {
            sb.Append($" \\\n  -H '{EscapeBash(h.Key)}: {EscapeBash(h.Value ?? "")}'");
        }

        // Body
        if (!string.IsNullOrWhiteSpace(payload.Body))
        {
            if (IsMultipartBodyType(payload.BodyType))
            {
                AppendMultipartCurlFields(sb, payload.Body);
            }
            else
            {
                var escapedBody = EscapeBash(payload.Body);
                sb.Append($" \\\n  -d '{escapedBody}'");
            }
        }

        sb.Append('\n');
        return sb.ToString();
    }

    private static void AppendMultipartCurlFields(StringBuilder sb, string body)
    {
        MultipartFormBody? multipart;
        try
        {
            multipart = JsonSerializer.Deserialize<MultipartFormBody>(body, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
        }
        catch (JsonException)
        {
            return;
        }

        if (multipart == null) return;
        foreach (var field in multipart.Fields.Where(field => field.Enabled && !string.IsNullOrWhiteSpace(field.Name)))
        {
            var specification = field.Name + "=";
            if (string.Equals(field.Kind, "file", StringComparison.OrdinalIgnoreCase))
            {
                specification += "@" + field.FilePath;
                if (!string.IsNullOrWhiteSpace(field.ContentType))
                    specification += ";type=" + field.ContentType;
                if (!string.IsNullOrWhiteSpace(field.FileName))
                    specification += ";filename=" + field.FileName;
            }
            else
            {
                specification += field.Value ?? "";
            }

            sb.Append($" \\\n  -F '{EscapeBash(specification)}'");
        }
    }

    private static bool IsMultipartBodyType(string? bodyType) =>
        string.Equals(bodyType, "multipart", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(bodyType, "multipart/form-data", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(bodyType, "formdata", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(bodyType, "form-data", StringComparison.OrdinalIgnoreCase);

    private static List<CodeSnippet> GenerateSnippetsMaterialized(ExecuteRequestPayload payload, string? language = null)
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
            snippets.Add(new CodeSnippet { Language = "Shell", Client = "cURL", Code = GenerateCurlMaterialized(payload).TrimEnd() });

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

    private async Task<ExecuteRequestPayload> PrepareSnapshotAsync(ExecuteRequestPayload input)
    {
        var persistedRequest = !string.IsNullOrWhiteSpace(input.RequestId)
            ? await _requestRepo.GetByIdAsync(input.RequestId)
            : null;
        var serviceId = input.ServiceId ?? persistedRequest?.ServiceId;
        var service = !string.IsNullOrWhiteSpace(serviceId)
            ? await _serviceRepo.GetByIdAsync(serviceId)
            : null;
        var workspaceId = input.WorkspaceId ?? service?.WorkspaceId ?? "default";

        var requestVariables = MergeRequestVariables(persistedRequest?.Variables, input.Variables);
        var runtimeVariables = _runtimeVariableStore.Get(workspaceId, input.RequestId);
        var session = await _variableService.CreateSessionAsync(
            workspaceId,
            serviceId,
            requestVariables,
            runtimeVariables.ToDictionary(pair => pair.Key, pair => pair.Value.Value, StringComparer.OrdinalIgnoreCase));

        var requestHeaders = input.Headers.Count > 0
            ? input.Headers
            : persistedRequest?.Headers.Select(header => new KeyValuePairRequest
            {
                Key = header.Key,
                Value = header.Value,
                Enabled = header.Enabled
            }).ToList() ?? [];
        var requestParams = input.Params.Count > 0
            ? input.Params
            : persistedRequest?.Params.Select(param => new KeyValuePairRequest
            {
                Key = param.Key,
                Value = param.Value,
                Enabled = param.Enabled
            }).ToList() ?? [];

        var resolvedUrl = session.Resolve(string.IsNullOrWhiteSpace(input.Url)
            ? persistedRequest?.Url ?? DefaultGeneratedUrl
            : input.Url);
        foreach (var param in requestParams.Where(param => param.Enabled))
        {
            var key = session.Resolve(param.Key);
            var value = session.Resolve(param.Value);
            resolvedUrl = AppendQueryParameter(resolvedUrl, key, value);
        }

        var headers = MergeHeaders(service?.Headers ?? [], requestHeaders)
            .Where(header => header.Enabled && !string.IsNullOrWhiteSpace(header.Key))
            .Select(header => new KeyValuePairRequest
            {
                Key = session.Resolve(header.Key),
                Value = session.Resolve(header.Value),
                Enabled = true
            })
            .ToList();

        var persistedAuth = persistedRequest?.Auth == null
            ? null
            : new AuthRequest
            {
                AuthType = persistedRequest.Auth.AuthType,
                ConfigJson = persistedRequest.Auth.ConfigJson
            };
        var effectiveAuth = ResolveEffectiveAuth(input.Auth ?? persistedAuth, service?.Auth);
        ApplyAuthToSnapshot(headers, ref resolvedUrl, effectiveAuth, session);

        var body = input.Body == null && persistedRequest != null
            ? persistedRequest.Body == null ? null : session.Resolve(persistedRequest.Body)
            : input.Body == null ? null : session.Resolve(input.Body);
        var bodyType = input.Body == null && persistedRequest != null
            ? persistedRequest.BodyType
            : input.BodyType;

        return new ExecuteRequestPayload
        {
            Method = string.IsNullOrWhiteSpace(input.Method) ? persistedRequest?.Method ?? "GET" : input.Method,
            Url = resolvedUrl,
            Body = body,
            BodyType = bodyType,
            Headers = headers,
            Params = requestParams,
            Variables = requestVariables.Select(pair => new RequestVariableRequest
            {
                Key = pair.Key,
                Value = session.GetVariable(pair.Key) ?? pair.Value,
                Enabled = true
            }).ToList(),
            Auth = effectiveAuth,
        };
    }

    private static Dictionary<string, string> MergeRequestVariables(
        IEnumerable<RequestVariable>? persisted,
        IEnumerable<RequestVariableRequest> current)
    {
        var currentVariables = current.ToList();
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (persisted != null)
        {
            foreach (var variable in persisted.Where(variable => variable.Enabled && !string.IsNullOrWhiteSpace(variable.Key)))
                result[variable.Key.Trim()] = variable.Value ?? "";
        }

        foreach (var variable in currentVariables.Where(variable => !string.IsNullOrWhiteSpace(variable.Key)))
        {
            var key = variable.Key.Trim();
            if (variable.Enabled)
                result[key] = variable.Value ?? "";
            else
                result.Remove(key);
        }

        return result;
    }

    private static string AppendQueryParameter(string url, string key, string value)
    {
        var separator = url.Contains('?') ? "&" : "?";
        return $"{url}{separator}{Uri.EscapeDataString(key)}={Uri.EscapeDataString(value)}";
    }

    private static void ApplyAuthToSnapshot(
        List<KeyValuePairRequest> headers,
        ref string url,
        AuthRequest? auth,
        TemplateResolutionSession session)
    {
        if (auth == null || string.Equals(auth.AuthType, "none", StringComparison.OrdinalIgnoreCase)) return;

        using var document = JsonDocument.Parse(session.Resolve(auth.ConfigJson));
        var config = document.RootElement;
        string GetString(string name) => config.TryGetProperty(name, out var property)
            ? session.Resolve(property.GetString() ?? "")
            : "";

        switch ((auth.AuthType ?? "").Trim().ToLowerInvariant())
        {
            case "basic":
                var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{GetString("username")}:{GetString("password")}"));
                UpsertHeader(headers, "Authorization", $"Basic {credentials}");
                break;
            case "bearer":
                UpsertHeader(headers, "Authorization", $"Bearer {GetString("token")}");
                break;
            case "apikey":
                var key = GetString("key");
                var value = GetString("value");
                var location = GetString("in");
                if (string.Equals(location, "query", StringComparison.OrdinalIgnoreCase))
                    url = AppendQueryParameter(url, key, value);
                else
                    UpsertHeader(headers, key, value);
                break;
        }
    }

    private static void UpsertHeader(List<KeyValuePairRequest> headers, string key, string value)
    {
        var existing = headers.FirstOrDefault(header => string.Equals(header.Key, key, StringComparison.OrdinalIgnoreCase));
        if (existing != null)
        {
            existing.Value = value;
            return;
        }

        headers.Add(new KeyValuePairRequest { Key = key, Value = value, Enabled = true });
    }

    private static AuthRequest? ResolveEffectiveAuth(AuthRequest? requestAuth, ServiceAuth? serviceAuth)
    {
        if (requestAuth == null || IsAuthType(requestAuth.AuthType, "inherit"))
        {
            if (serviceAuth == null || IsAuthType(serviceAuth.AuthType, "none")) return null;
            return new AuthRequest { AuthType = serviceAuth.AuthType, ConfigJson = serviceAuth.ConfigJson };
        }

        return IsAuthType(requestAuth.AuthType, "none") ? null : requestAuth;
    }

    private static bool IsAuthType(string? authType, string expected) =>
        string.Equals(authType?.Trim(), expected, StringComparison.OrdinalIgnoreCase);

    private static List<KeyValuePairRequest> MergeHeaders(
        IEnumerable<RequestLoom.Api.Models.KeyValuePair> serviceHeaders,
        IEnumerable<KeyValuePairRequest> requestHeaders)
    {
        var merged = new Dictionary<string, KeyValuePairRequest>(StringComparer.OrdinalIgnoreCase);
        foreach (var serviceHeader in serviceHeaders.Where(header => header.Enabled && !string.IsNullOrWhiteSpace(header.Key)))
        {
            var key = serviceHeader.Key.Trim();
            merged[key] = new KeyValuePairRequest { Key = key, Value = serviceHeader.Value ?? "", Enabled = true };
        }

        foreach (var requestHeader in requestHeaders.Where(header => !string.IsNullOrWhiteSpace(header.Key)))
        {
            var key = requestHeader.Key.Trim();
            if (!requestHeader.Enabled)
            {
                merged.Remove(key);
                continue;
            }

            merged[key] = new KeyValuePairRequest { Key = key, Value = requestHeader.Value ?? "", Enabled = true };
        }

        return merged.Values.ToList();
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
