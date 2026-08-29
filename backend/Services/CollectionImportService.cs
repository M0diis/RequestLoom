using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

public class CollectionImportService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IServiceRepository _serviceRepository;
    private readonly IRequestRepository _requestRepository;

    public CollectionImportService(
        IHttpClientFactory httpClientFactory,
        IServiceRepository serviceRepository,
        IRequestRepository requestRepository)
    {
        _httpClientFactory = httpClientFactory;
        _serviceRepository = serviceRepository;
        _requestRepository = requestRepository;
    }

    public async Task<ImportSpecificationResult> ImportPostmanAsync(string workspaceId, ImportSpecificationRequest request)
    {
        var source = await ReadSourceAsync(request);
        var root = JsonNode.Parse(source) as JsonObject
            ?? throw new InvalidOperationException("Could not parse the Postman collection as JSON.");

        var warnings = new List<string>();

        var info = root["info"] as JsonObject;
        var serviceName = request.ServiceName;
        if (string.IsNullOrWhiteSpace(serviceName))
        {
            var detectedTitle = info?["name"]?.GetValue<string>();
            serviceName = string.IsNullOrWhiteSpace(detectedTitle) ? "Postman Import" : detectedTitle;
        }

        var serviceId = await ResolveTargetServiceIdAsync(workspaceId, request.ServiceId, serviceName!);

        if (root["variable"] is JsonArray variables && variables.Count > 0)
        {
            warnings.Add("Collection variables were not imported.");
        }

        var items = root["item"] as JsonArray;
        var requests = new List<(string Name, JsonObject RequestObj, string? FolderName)>();
        if (items != null)
        {
            WalkPostmanItems(items, "", requests);
        }

        if (requests.Count == 0)
        {
            throw new InvalidOperationException("No requests found in the Postman collection.");
        }

        var folderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var targetService = await _serviceRepository.GetByIdAsync(serviceId)
            ?? throw new InvalidOperationException("Service not found");
        foreach (var folder in targetService.Folders)
        {
            folderIds[folder.Name] = folder.Id;
        }

        foreach (var folderName in requests
            .Select(item => item.FolderName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (folderIds.ContainsKey(folderName)) continue;

            var folder = await _serviceRepository.CreateFolderAsync(workspaceId, serviceId, folderName)
                ?? throw new InvalidOperationException($"Could not create Postman folder '{folderName}'.");
            folderIds[folderName] = folder.Id;
        }

        var createdRequests = 0;
        foreach (var (name, requestObj, folderName) in requests)
        {
            var folderId = !string.IsNullOrWhiteSpace(folderName) && folderIds.TryGetValue(folderName.Trim(), out var resolvedFolderId)
                ? resolvedFolderId
                : null;
            var created = await ImportPostmanRequestAsync(serviceId, name, requestObj, warnings, folderId);
            if (created != null)
            {
                createdRequests++;
            }
        }

        return new ImportSpecificationResult
        {
            ServiceId = serviceId,
            CreatedRequests = createdRequests,
            Warnings = warnings,
        };
    }

    public async Task<ImportSpecificationResult> ImportBrunoAsync(string workspaceId, IReadOnlyList<ImportedFile> files, string? serviceId, string? serviceName)
    {
        if (files.Count == 0)
        {
            throw new InvalidOperationException("No .bru files were provided.");
        }

        var warnings = new List<string>();

        var effectiveName = string.IsNullOrWhiteSpace(serviceName) ? "Bruno Import" : serviceName!;
        var targetServiceId = await ResolveTargetServiceIdAsync(workspaceId, serviceId, effectiveName);

        var createdRequests = 0;
        foreach (var file in files)
        {
            var content = ReadBrunoFile(file.Content);
            if (content == null)
            {
                warnings.Add($"Skipped '{file.FileName}' because it could not be parsed.");
                continue;
            }

            var created = await ImportBrunoRequestAsync(targetServiceId, file.FileName, content, warnings);
            if (created != null)
            {
                createdRequests++;
            }
        }

        if (createdRequests == 0)
        {
            throw new InvalidOperationException("No requests could be created from the provided .bru files.");
        }

        return new ImportSpecificationResult
        {
            ServiceId = targetServiceId,
            CreatedRequests = createdRequests,
            Warnings = warnings,
        };
    }

    public sealed class ImportedFile
    {
        public string FileName { get; set; } = "";
        public string Content { get; set; } = "";
    }

    // ---------- Postman ----------

    private void WalkPostmanItems(JsonArray items, string folderPath, List<(string Name, JsonObject Request, string? FolderName)> output)
    {
        foreach (var itemNode in items)
        {
            if (itemNode is not JsonObject item) continue;

            var itemName = item["name"]?.GetValue<string>() ?? "";
            if (item["item"] is JsonArray children)
            {
                var nextFolderPath = string.IsNullOrWhiteSpace(folderPath)
                    ? itemName
                    : string.IsNullOrWhiteSpace(itemName)
                        ? folderPath
                        : $"{folderPath} / {itemName}";
                WalkPostmanItems(children, nextFolderPath, output);
                continue;
            }

            if (item["request"] is not JsonObject requestObj) continue;

            var name = string.IsNullOrWhiteSpace(itemName) ? "Untitled request" : itemName;

            output.Add((name, requestObj, string.IsNullOrWhiteSpace(folderPath) ? null : folderPath));
        }
    }

    private async Task<ApiRequest?> ImportPostmanRequestAsync(string serviceId, string name, JsonObject requestObj, List<string> warnings, string? folderId = null)
    {
        var method = NormalizeHttpMethod(requestObj["method"]?.GetValue<string>());
        if (method == null)
        {
            warnings.Add($"Skipped '{name}' because the HTTP method is not recognized.");
            return null;
        }

        var urlObj = requestObj["url"];
        var (url, queryParams) = ResolvePostmanUrl(urlObj);
        if (string.IsNullOrWhiteSpace(url))
        {
            warnings.Add($"Skipped '{name}' because the URL is empty.");
            return null;
        }

        var headers = new List<KeyValuePairRequest>();
        if (requestObj["header"] is JsonArray headerArray)
        {
            foreach (var headerNode in headerArray)
            {
                if (headerNode is not JsonObject header) continue;
                var key = header["key"]?.GetValue<string>();
                if (string.IsNullOrWhiteSpace(key)) continue;
                if (header["disabled"] is JsonValue disabledValue && disabledValue.TryGetValue<bool>(out var disabled) && disabled) continue;
                headers.Add(new KeyValuePairRequest
                {
                    Key = key.Trim(),
                    Value = header["value"]?.GetValue<string>() ?? "",
                    Enabled = true,
                });
            }
        }

        var paramsList = new List<KeyValuePairRequest>();
        foreach (var query in queryParams)
        {
            paramsList.Add(new KeyValuePairRequest
            {
                Key = query.Key,
                Value = query.Value,
                Enabled = true,
            });
        }

        var body = requestObj["body"];
        string? bodyText = null;
        var bodyType = "none";

        if (body is JsonObject bodyObj)
        {
            var mode = bodyObj["mode"]?.GetValue<string>() ?? "none";
            switch (mode)
            {
                case "raw":
                    bodyText = bodyObj["raw"]?.GetValue<string>() ?? "";
                    var contentType = headers
                        .FirstOrDefault(h => string.Equals(h.Key, "Content-Type", StringComparison.OrdinalIgnoreCase))
                        ?.Value;
                    bodyType = InferBodyTypeFromContentType(contentType);
                    break;
                case "urlencoded":
                    bodyText = BuildFormBody(bodyObj["urlencoded"], warnings, name);
                    bodyType = "form";
                    break;
                case "formdata":
                    bodyText = BuildMultipartBody(bodyObj["formdata"], warnings, name);
                    bodyType = "multipart";
                    break;
                case "graphql":
                    bodyText = bodyObj["graphql"]?["query"]?.GetValue<string>() ?? "";
                    bodyType = "json";
                    break;
                case "file":
                    warnings.Add($"Skipped body for '{name}' because file bodies are not supported.");
                    break;
                default:
                    warnings.Add($"Skipped body for '{name}' because body mode '{mode}' is not supported.");
                    break;
            }
        }

        var auth = requestObj["auth"];
        var authRequest = MapPostmanAuth(auth, warnings, name);

        var created = await _requestRepository.CreateAsync(serviceId, new CreateApiRequestRequest
        {
            Name = name,
            Method = method,
            Url = url,
            Body = bodyText,
            BodyType = bodyType,
            FolderId = folderId,
        });

        if (headers.Count > 0 || paramsList.Count > 0 || authRequest != null)
        {
            await _requestRepository.UpdateAsync(created.Id, new UpdateApiRequestRequest
            {
                Name = created.Name,
                Method = created.Method,
                Url = created.Url,
                Body = created.Body,
                BodyType = created.BodyType,
                Headers = headers,
                Params = paramsList,
                Variables = [],
                Auth = authRequest,
            });
        }

        return created;
    }

    private static (string Url, List<(string Key, string Value)> QueryParams) ResolvePostmanUrl(JsonNode? urlNode)
    {
        var queryParams = new List<(string Key, string Value)>();

        if (urlNode == null) return ("", queryParams);

        if (urlNode is JsonValue valueNode && valueNode.TryGetValue<string>(out var rawString))
        {
            return (rawString, queryParams);
        }

        if (urlNode is not JsonObject urlObj) return ("", queryParams);

        var raw = urlObj["raw"]?.GetValue<string>() ?? "";
        var host = urlObj["host"] is JsonArray hostArray
            ? string.Join('.', hostArray.Select(h => h?.GetValue<string>() ?? ""))
            : "";
        var path = urlObj["path"] is JsonArray pathArray
            ? string.Join('/', pathArray.Select(p => p?.GetValue<string>() ?? ""))
            : "";

        var baseUrl = raw;
        if (string.IsNullOrWhiteSpace(baseUrl) && !string.IsNullOrWhiteSpace(host))
        {
            baseUrl = path.StartsWith('/') || string.IsNullOrWhiteSpace(path)
                ? $"{host}{path}"
                : $"{host}/{path}";
        }

        if (urlObj["query"] is JsonArray queryArray)
        {
            foreach (var queryNode in queryArray)
            {
                if (queryNode is not JsonObject query) continue;
                if (query["disabled"] is JsonValue disabledValue && disabledValue.TryGetValue<bool>(out var disabled) && disabled) continue;
                var key = query["key"]?.GetValue<string>();
                if (string.IsNullOrWhiteSpace(key)) continue;
                queryParams.Add((key, query["value"]?.GetValue<string>() ?? ""));
            }
        }

        if (queryParams.Count > 0)
        {
            var queryStart = baseUrl.IndexOf('?');
            if (queryStart >= 0)
            {
                baseUrl = baseUrl[..queryStart];
            }
        }

        return (baseUrl, queryParams);
    }

    private static string BuildFormBody(JsonNode? node, List<string> warnings, string requestName)
    {
        if (node is not JsonArray array) return "";

        var parts = new List<string>();
        foreach (var entryNode in array)
        {
            if (entryNode is not JsonObject entry) continue;
            var key = entry["key"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(key)) continue;

            if (entry["disabled"] is JsonValue disabledValue && disabledValue.TryGetValue<bool>(out var disabled) && disabled) continue;

            if (entry["type"]?.GetValue<string>() == "file")
            {
                warnings.Add($"Skipped file form field '{key}' for '{requestName}'.");
                continue;
            }

            parts.Add($"{key}={entry["value"]?.GetValue<string>() ?? ""}");
        }

        return string.Join('&', parts);
    }

    private static string BuildMultipartBody(JsonNode? node, List<string> warnings, string requestName)
    {
        var fields = new List<MultipartFormField>();
        if (node is not JsonArray array)
        {
            return JsonSerializer.Serialize(new MultipartFormBody(), new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            });
        }

        foreach (var entryNode in array)
        {
            if (entryNode is not JsonObject entry) continue;
            var key = entry["key"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(key)) continue;

            if (entry["disabled"] is JsonValue disabledValue &&
                disabledValue.TryGetValue<bool>(out var disabled) && disabled)
            {
                continue;
            }

            if (string.Equals(entry["type"]?.GetValue<string>(), "file", StringComparison.OrdinalIgnoreCase))
            {
                warnings.Add($"Skipped file form field '{key}' for '{requestName}' because its local path was not uploaded.");
                continue;
            }

            fields.Add(new MultipartFormField
            {
                Name = key.Trim(),
                Kind = "text",
                Value = entry["value"]?.GetValue<string>() ?? "",
                Enabled = true,
            });
        }

        return JsonSerializer.Serialize(new MultipartFormBody { Fields = fields }, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        });
    }

    private static AuthRequest? MapPostmanAuth(JsonNode? authNode, List<string> warnings, string requestName)
    {
        if (authNode is not JsonObject authObj) return null;

        var type = authObj["type"]?.GetValue<string>();
        var config = authObj[type] as JsonObject;

        switch (type)
        {
            case "basic":
                return new AuthRequest
                {
                    AuthType = "basic",
                    ConfigJson = JsonSerializer.Serialize(new
                    {
                        username = config?["username"]?.GetValue<string>() ?? "",
                        password = config?["password"]?.GetValue<string>() ?? "",
                    }),
                };
            case "bearer":
                return new AuthRequest
                {
                    AuthType = "bearer",
                    ConfigJson = JsonSerializer.Serialize(new
                    {
                        token = config?["token"]?.GetValue<string>() ?? "",
                    }),
                };
            default:
                if (!string.IsNullOrWhiteSpace(type))
                {
                    warnings.Add($"Skipped auth type '{type}' for '{requestName}'.");
                }
                return null;
        }
    }

    // ---------- Bruno ----------

    private sealed class BrunoRequest
    {
        public string Method { get; set; } = "GET";
        public string Url { get; set; } = "";
        public string Name { get; set; } = "";
        public string BodyType { get; set; } = "none";
        public string? Body { get; set; }
        public List<(string Key, string Value)> Headers { get; set; } = [];
        public List<(string Key, string Value)> Params { get; set; } = [];
        public AuthRequest? Auth { get; set; }
    }

    private static BrunoRequest? ReadBrunoFile(string content)
    {
        var sections = ParseBrunoSections(content);
        if (sections.Count == 0) return null;

        var request = new BrunoRequest();

        var metaName = sections.TryGetValue("meta", out var metaLines)
            ? ParseBrunoEntries(metaLines).FirstOrDefault(e => e.Key.Equals("name", StringComparison.OrdinalIgnoreCase))
            : default;
        request.Name = metaName.Value ?? "";

        var methodSection = sections
            .Keys
            .FirstOrDefault(k => NormalizeHttpMethod(k) != null);

        if (methodSection != null)
        {
            var entries = ParseBrunoEntries(sections[methodSection]).ToList();
            var url = entries.FirstOrDefault(e => e.Key.Equals("url", StringComparison.OrdinalIgnoreCase)).Value;
            var bodyMode = entries.FirstOrDefault(e => e.Key.Equals("body", StringComparison.OrdinalIgnoreCase)).Value;

            request.Method = NormalizeHttpMethod(methodSection)!;
            request.Url = url ?? "";
            request.BodyType = bodyMode?.ToLowerInvariant() switch
            {
                "json" => "json",
                "xml" => "xml",
                "text" => "text",
                "form" => "form",
                _ => "none",
            };
        }

        if (string.IsNullOrWhiteSpace(request.Url)) return null;

        if (sections.TryGetValue("headers", out var headerLines))
        {
            request.Headers = ParseBrunoEntries(headerLines).ToList();
        }

        foreach (var paramSection in new[] { "query", "params" })
        {
            if (sections.TryGetValue(paramSection, out var paramLines))
            {
                request.Params.AddRange(ParseBrunoEntries(paramLines));
            }
        }

        foreach (var bodySection in new[] { "body:json", "body:xml", "body:text", "body:form-urlencoded", "body:multipart-form" })
        {
            if (sections.TryGetValue(bodySection, out var bodyLines))
            {
                request.Body = string.Join('\n', bodyLines).Trim();
                request.BodyType = bodySection switch
                {
                    "body:json" => "json",
                    "body:xml" => "xml",
                    "body:form-urlencoded" => "form",
                    "body:multipart-form" => "form",
                    _ => "text",
                };
                break;
            }
        }

        if (sections.TryGetValue("auth:basic", out var basicLines))
        {
            var entries = ParseBrunoEntries(basicLines).ToDictionary(e => e.Key, e => e.Value, StringComparer.OrdinalIgnoreCase);
            entries.TryGetValue("username", out var username);
            entries.TryGetValue("password", out var password);
            request.Auth = new AuthRequest
            {
                AuthType = "basic",
                ConfigJson = JsonSerializer.Serialize(new { username = username ?? "", password = password ?? "" }),
            };
        }
        else if (sections.TryGetValue("auth:bearer", out var bearerLines))
        {
            var entries = ParseBrunoEntries(bearerLines).ToDictionary(e => e.Key, e => e.Value, StringComparer.OrdinalIgnoreCase);
            entries.TryGetValue("token", out var token);
            request.Auth = new AuthRequest
            {
                AuthType = "bearer",
                ConfigJson = JsonSerializer.Serialize(new { token = token ?? "" }),
            };
        }

        return request;
    }

    private static Dictionary<string, List<string>> ParseBrunoSections(string content)
    {
        var sections = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        string? currentSection = null;

        foreach (var rawLine in content.Split('\n'))
        {
            var line = rawLine.TrimEnd('\r');
            var trimmed = line.Trim();

            var sectionMatch = System.Text.RegularExpressions.Regex.Match(trimmed, @"^([\w\-:]+)\s*\{$");
            if (sectionMatch.Success)
            {
                currentSection = sectionMatch.Groups[1].Value;
                sections[currentSection] = [];
                continue;
            }

            if (trimmed == "}")
            {
                currentSection = null;
                continue;
            }

            if (currentSection != null)
            {
                sections[currentSection].Add(line);
            }
        }

        return sections;
    }

    private static IEnumerable<(string Key, string Value)> ParseBrunoEntries(List<string> lines)
    {
        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (string.IsNullOrWhiteSpace(trimmed) || trimmed.StartsWith("//")) continue;

            var colonIndex = trimmed.IndexOf(':');
            if (colonIndex <= 0) continue;

            var key = trimmed[..colonIndex].Trim();
            var value = trimmed[(colonIndex + 1)..].Trim();

            if (value.Length >= 2 && value.StartsWith('"') && value.EndsWith('"'))
            {
                value = value[1..^1];
            }

            yield return (key, value);
        }
    }

    private async Task<ApiRequest?> ImportBrunoRequestAsync(string serviceId, string fileName, BrunoRequest request, List<string> warnings)
    {
        var name = string.IsNullOrWhiteSpace(request.Name) ? fileName.Replace(".bru", "", StringComparison.OrdinalIgnoreCase) : request.Name;

        var headers = request.Headers
            .Where(h => !string.IsNullOrWhiteSpace(h.Key))
            .Select(h => new KeyValuePairRequest { Key = h.Key.Trim(), Value = h.Value, Enabled = true })
            .ToList();

        var paramsList = request.Params
            .Where(p => !string.IsNullOrWhiteSpace(p.Key))
            .Select(p => new KeyValuePairRequest { Key = p.Key.Trim(), Value = p.Value, Enabled = true })
            .ToList();

        var created = await _requestRepository.CreateAsync(serviceId, new CreateApiRequestRequest
        {
            Name = name,
            Method = request.Method,
            Url = request.Url,
            Body = request.Body,
            BodyType = request.BodyType,
        });

        if (headers.Count > 0 || paramsList.Count > 0 || request.Auth != null)
        {
            await _requestRepository.UpdateAsync(created.Id, new UpdateApiRequestRequest
            {
                Name = created.Name,
                Method = created.Method,
                Url = created.Url,
                Body = created.Body,
                BodyType = created.BodyType,
                Headers = headers,
                Params = paramsList,
                Variables = [],
                Auth = request.Auth,
            });
        }

        return created;
    }

    // ---------- Shared ----------

    private async Task<string> ReadSourceAsync(ImportSpecificationRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Source))
        {
            throw new InvalidOperationException("Source is required.");
        }

        if (string.Equals(request.SourceType, "raw", StringComparison.OrdinalIgnoreCase))
        {
            return request.Source;
        }

        if (!Uri.TryCreate(request.Source, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new InvalidOperationException("Source URL must be an absolute http/https URL.");
        }

        var client = _httpClientFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Get, uri);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/plain"));

        using var response = await client.SendAsync(req);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Could not download source URL ({(int)response.StatusCode} {response.ReasonPhrase}).");
        }

        return await response.Content.ReadAsStringAsync();
    }

    private async Task<string> ResolveTargetServiceIdAsync(string workspaceId, string? serviceId, string fallbackName)
    {
        if (!string.IsNullOrWhiteSpace(serviceId))
        {
            var existing = await _serviceRepository.GetByIdAsync(serviceId);
            if (existing == null || !string.Equals(existing.WorkspaceId, workspaceId, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Target service was not found in this workspace.");
            }

            return existing.Id;
        }

        var created = await _serviceRepository.CreateAsync(
            workspaceId,
            fallbackName,
            "Imported collection",
            [],
            null);
        return created.Id;
    }

    private static string? NormalizeHttpMethod(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        return value.Trim().ToLowerInvariant() switch
        {
            "get" => "GET",
            "post" => "POST",
            "put" => "PUT",
            "patch" => "PATCH",
            "delete" => "DELETE",
            "options" => "OPTIONS",
            "head" => "HEAD",
            _ => null,
        };
    }

    private static string InferBodyTypeFromContentType(string? contentType)
    {
        if (string.IsNullOrWhiteSpace(contentType)) return "text";

        var lower = contentType.ToLowerInvariant();
        if (lower.Contains("json")) return "json";
        if (lower.Contains("xml")) return "xml";
        if (lower.Contains("x-www-form-urlencoded")) return "form";
        if (lower.Contains("multipart/form-data")) return "multipart";
        return "text";
    }
}
