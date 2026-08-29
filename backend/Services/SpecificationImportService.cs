using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;
using YamlDotNet.Serialization;

namespace RequestLoom.Api.Services;

public class SpecificationImportService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IServiceRepository _serviceRepository;
    private readonly IRequestRepository _requestRepository;

    public SpecificationImportService(
        IHttpClientFactory httpClientFactory,
        IServiceRepository serviceRepository,
        IRequestRepository requestRepository)
    {
        _httpClientFactory = httpClientFactory;
        _serviceRepository = serviceRepository;
        _requestRepository = requestRepository;
    }

    public async Task<ImportSpecificationResult> ImportOpenApiAsync(string workspaceId, ImportSpecificationRequest request)
    {
        var source = await ReadSourceAsync(request);
        var root = ParseSpecDocument(source);

        var (serverUrl, operations, warnings) = ParseHttpOperations(root);
        if (operations.Count == 0)
        {
            throw new InvalidOperationException("No HTTP operations found. Ensure the document has a valid 'paths' section.");
        }

        var serviceName = request.ServiceName;
        if (string.IsNullOrWhiteSpace(serviceName))
        {
            var detectedTitle = ReadString(root, "info", "title");
            serviceName = string.IsNullOrWhiteSpace(detectedTitle)
                ? "OpenAPI Import"
                : detectedTitle;
        }

        var serviceId = await ResolveTargetServiceIdAsync(workspaceId, request.ServiceId, serviceName!);
        var createdRequests = 0;

        foreach (var operation in operations)
        {
            var bodyTemplate = operation.BodyType switch
            {
                "json" => "{}",
                "xml" => "<root></root>",
                "form" => "",
                "multipart" => "{\"fields\":[]}",
                "text" => "",
                _ => null,
            };

            var created = await _requestRepository.CreateAsync(serviceId, new CreateApiRequestRequest
            {
                Name = operation.Name,
                Method = operation.Method,
                Url = BuildImportedUrl(serverUrl, operation.Path),
                Body = bodyTemplate,
                BodyType = operation.BodyType,
            });

            var headers = new List<KeyValuePairRequest>();
            if (operation.BodyType == "json")
            {
                headers.Add(new KeyValuePairRequest { Key = "Content-Type", Value = "application/json", Enabled = true });
            }
            if (operation.BodyType == "xml")
            {
                headers.Add(new KeyValuePairRequest { Key = "Content-Type", Value = "text/xml; charset=utf-8", Enabled = true });
            }
            if (operation.BodyType == "form")
            {
                headers.Add(new KeyValuePairRequest { Key = "Content-Type", Value = "application/x-www-form-urlencoded", Enabled = true });
            }
            if (operation.BodyType == "multipart")
            {
                headers.Add(new KeyValuePairRequest { Key = "Content-Type", Value = "multipart/form-data", Enabled = true });
            }

            if (headers.Count > 0)
            {
                await _requestRepository.UpdateAsync(created.Id, new UpdateApiRequestRequest
                {
                    Name = created.Name,
                    Method = created.Method,
                    Url = created.Url,
                    Body = created.Body,
                    BodyType = created.BodyType,
                    Headers = headers,
                    Params = [],
                    Variables = [],
                    Auth = null,
                });
            }

            createdRequests++;
        }

        return new ImportSpecificationResult
        {
            ServiceId = serviceId,
            CreatedRequests = createdRequests,
            Warnings = warnings,
        };
    }

    public async Task<ImportSpecificationResult> ImportWsdlAsync(string workspaceId, ImportSpecificationRequest request)
    {
        var source = await ReadSourceAsync(request);
        var doc = XDocument.Parse(source);

        XNamespace wsdl = "http://schemas.xmlsoap.org/wsdl/";
        XNamespace soap = "http://schemas.xmlsoap.org/wsdl/soap/";
        XNamespace soap12 = "http://schemas.xmlsoap.org/wsdl/soap12/";

        var warnings = new List<string>();

        var serviceName = request.ServiceName;
        if (string.IsNullOrWhiteSpace(serviceName))
        {
            serviceName = doc.Descendants(wsdl + "service").Attributes("name").Select(a => a.Value).FirstOrDefault();
        }
        if (string.IsNullOrWhiteSpace(serviceName)) serviceName = "WSDL Import";

        var serviceId = await ResolveTargetServiceIdAsync(workspaceId, request.ServiceId, serviceName!);

        var endpoint = doc.Descendants(soap + "address").Attributes("location").Select(a => a.Value).FirstOrDefault();
        if (string.IsNullOrWhiteSpace(endpoint))
        {
            endpoint = doc.Descendants(soap12 + "address").Attributes("location").Select(a => a.Value).FirstOrDefault();
        }
        if (string.IsNullOrWhiteSpace(endpoint)) endpoint = "{{baseUrl}}";

        var targetNamespace = doc.Root?.Attribute("targetNamespace")?.Value ?? "urn:imported";
        var operations = doc.Descendants(wsdl + "portType")
            .Descendants(wsdl + "operation")
            .Attributes("name")
            .Select(a => a.Value)
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (operations.Count == 0)
        {
            warnings.Add("No WSDL operations found in portType definitions.");
        }

        var createdRequests = 0;

        foreach (var operation in operations)
        {
            var body = BuildSoapEnvelope(targetNamespace, operation);

            var created = await _requestRepository.CreateAsync(serviceId, new CreateApiRequestRequest
            {
                Name = operation,
                Method = "POST",
                Url = endpoint,
                Body = body,
                BodyType = "xml",
            });

            await _requestRepository.UpdateAsync(created.Id, new UpdateApiRequestRequest
            {
                Name = created.Name,
                Method = created.Method,
                Url = created.Url,
                Body = created.Body,
                BodyType = created.BodyType,
                Headers =
                [
                    new KeyValuePairRequest { Key = "Content-Type", Value = "text/xml; charset=utf-8", Enabled = true },
                    new KeyValuePairRequest { Key = "SOAPAction", Value = $"\"{targetNamespace}/{operation}\"", Enabled = true },
                ],
                Params = [],
                Variables = [],
                Auth = null,
            });

            createdRequests++;
        }

        return new ImportSpecificationResult
        {
            ServiceId = serviceId,
            CreatedRequests = createdRequests,
            Warnings = warnings,
        };
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
            "Imported specification",
            [],
            null);
        return created.Id;
    }

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
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/yaml"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/yaml"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/plain"));

        using var response = await client.SendAsync(req);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Could not download source URL ({(int)response.StatusCode} {response.ReasonPhrase}).");
        }

        return await response.Content.ReadAsStringAsync();
    }

    private static JsonObject ParseSpecDocument(string source)
    {
        // JSON first
        try
        {
            var jsonNode = JsonNode.Parse(source) as JsonObject;
            if (jsonNode != null)
            {
                return jsonNode;
            }
        }
        catch
        {
            // Fall through to YAML parse
        }

        // YAML fallback
        try
        {
            var yamlDeserializer = new DeserializerBuilder().Build();
            var yamlObject = yamlDeserializer.Deserialize(new StringReader(source));
            var yamlSerializer = new SerializerBuilder().JsonCompatible().Build();
            var yamlAsJson = yamlSerializer.Serialize(yamlObject);
            var yamlNode = JsonNode.Parse(yamlAsJson) as JsonObject;

            if (yamlNode != null)
            {
                return yamlNode;
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not parse specification as JSON or YAML. {ex.Message}");
        }

        throw new InvalidOperationException("Could not parse specification as a JSON/YAML object.");
    }

    private static (string? ServerUrl, List<ParsedOperation> Operations, List<string> Warnings) ParseHttpOperations(JsonObject root)
    {
        var warnings = new List<string>();
        var operations = new List<ParsedOperation>();

        if (root["paths"] is not JsonObject paths)
        {
            throw new InvalidOperationException("Specification is missing a valid 'paths' object.");
        }

        var globalConsumes = ReadStringArray(root["consumes"]);
        var serverUrl = ResolveServerUrl(root);

        foreach (var pathEntry in paths)
        {
            var path = pathEntry.Key;
            if (pathEntry.Value is not JsonObject pathItem)
            {
                warnings.Add($"Skipped path '{path}' because it is not an object.");
                continue;
            }

            foreach (var operationEntry in pathItem)
            {
                var method = NormalizeHttpMethod(operationEntry.Key);
                if (method == null)
                {
                    continue;
                }

                if (operationEntry.Value is not JsonObject operationObj)
                {
                    warnings.Add($"Skipped operation '{operationEntry.Key}' in path '{path}' because it is not an object.");
                    continue;
                }

                var name = ReadString(operationObj, "summary")
                    ?? ReadString(operationObj, "operationId")
                    ?? $"{method} {path}";

                var bodyType = InferBodyType(root, pathItem, operationObj, globalConsumes);

                operations.Add(new ParsedOperation
                {
                    Method = method,
                    Path = path,
                    Name = name,
                    BodyType = bodyType,
                });
            }
        }

        return (serverUrl, operations, warnings);
    }

    private static string? ResolveServerUrl(JsonObject root)
    {
        // OpenAPI 3.x style
        if (root["servers"] is JsonArray servers)
        {
            foreach (var server in servers)
            {
                if (server is not JsonObject serverObj) continue;
                var url = ReadString(serverObj, "url");
                if (!string.IsNullOrWhiteSpace(url)) return url;
            }
        }

        // Swagger 2.x style
        var host = ReadString(root, "host");
        if (!string.IsNullOrWhiteSpace(host))
        {
            var scheme = ReadStringArray(root["schemes"]).FirstOrDefault() ?? "https";
            var basePath = ReadString(root, "basePath") ?? string.Empty;
            var normalizedBasePath = string.IsNullOrWhiteSpace(basePath)
                ? string.Empty
                : (basePath.StartsWith('/') ? basePath : "/" + basePath);
            return $"{scheme}://{host}{normalizedBasePath}";
        }

        return null;
    }

    private static string InferBodyType(
        JsonObject root,
        JsonObject pathItem,
        JsonObject operationObj,
        IReadOnlyList<string> globalConsumes)
    {
        // OpenAPI 3.x requestBody
        if (operationObj["requestBody"] is JsonObject requestBody
            && requestBody["content"] is JsonObject content)
        {
            var bodyType = InferBodyTypeFromMediaTypes(content.Select(c => c.Key));
            if (bodyType != "none") return bodyType;
        }

        // Swagger 2.x parameters/consumes
        var parameterNodes = new List<JsonNode>();

        if (pathItem["parameters"] is JsonArray pathParameters)
        {
            parameterNodes.AddRange(pathParameters.Where(p => p != null)!);
        }
        if (operationObj["parameters"] is JsonArray operationParameters)
        {
            parameterNodes.AddRange(operationParameters.Where(p => p != null)!);
        }

        var hasBodyParameter = false;
        var hasFormParameter = false;

        foreach (var parameterNode in parameterNodes)
        {
            if (parameterNode is not JsonObject parameterObj) continue;
            var location = ReadString(parameterObj, "in");
            if (string.Equals(location, "body", StringComparison.OrdinalIgnoreCase))
            {
                hasBodyParameter = true;
            }
            if (string.Equals(location, "formData", StringComparison.OrdinalIgnoreCase))
            {
                hasFormParameter = true;
            }
        }

        if (hasFormParameter)
        {
            var hasFileParameter = parameterNodes
                .OfType<JsonObject>()
                .Any(parameter =>
                    string.Equals(ReadString(parameter, "in"), "formData", StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(ReadString(parameter, "type"), "file", StringComparison.OrdinalIgnoreCase));
            return hasFileParameter ? "multipart" : "form";
        }

        var operationConsumes = ReadStringArray(operationObj["consumes"]);
        var consumes = operationConsumes.Count > 0 ? operationConsumes : globalConsumes;

        if (hasBodyParameter)
        {
            var bodyType = InferBodyTypeFromMediaTypes(consumes);
            return bodyType == "none" ? "json" : bodyType;
        }

        return "none";
    }

    private static string InferBodyTypeFromMediaTypes(IEnumerable<string> mediaTypes)
    {
        var types = mediaTypes
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Select(t => t.ToLowerInvariant())
            .ToList();

        if (types.Any(t => t.Contains("json"))) return "json";
        if (types.Any(t => t.Contains("xml"))) return "xml";
        if (types.Any(t => t.Contains("multipart/form-data"))) return "multipart";
        if (types.Any(t => t.Contains("x-www-form-urlencoded"))) return "form";
        if (types.Count > 0) return "text";

        return "none";
    }

    private static string? NormalizeHttpMethod(string value)
    {
        return value.ToLowerInvariant() switch
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

    private static List<string> ReadStringArray(JsonNode? node)
    {
        var result = new List<string>();
        if (node is not JsonArray array) return result;

        foreach (var valueNode in array)
        {
            if (valueNode == null) continue;
            if (valueNode is JsonValue jsonValue
                && jsonValue.TryGetValue<string>(out var value)
                && !string.IsNullOrWhiteSpace(value))
            {
                result.Add(value);
            }
        }

        return result;
    }

    private static string? ReadString(JsonObject root, params string[] path)
    {
        JsonNode? current = root;

        foreach (var segment in path)
        {
            if (current is not JsonObject obj) return null;
            current = obj[segment];
            if (current == null) return null;
        }

        if (current is JsonValue currentValue && currentValue.TryGetValue<string>(out var result))
        {
            return string.IsNullOrWhiteSpace(result) ? null : result;
        }

        return null;
    }

    private static string BuildImportedUrl(string? serverUrl, string path)
    {
        var normalizedPath = path.StartsWith('/') ? path : $"/{path}";

        if (string.IsNullOrWhiteSpace(serverUrl))
        {
            return $"{{{{baseUrl}}}}{normalizedPath}";
        }

        return $"{serverUrl.TrimEnd('/')}{normalizedPath}";
    }

    private static string BuildSoapEnvelope(string targetNamespace, string operation)
    {
        return $"""
<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:tns=\"{targetNamespace}\">
  <soapenv:Header/>
  <soapenv:Body>
    <tns:{operation}></tns:{operation}>
  </soapenv:Body>
</soapenv:Envelope>
""";
    }

    private sealed class ParsedOperation
    {
        public string Method { get; set; } = "GET";
        public string Path { get; set; } = "";
        public string Name { get; set; } = "";
        public string BodyType { get; set; } = "none";
    }
}
