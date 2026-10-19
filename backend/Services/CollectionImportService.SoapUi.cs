using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using RequestLoom.Api.Data;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

public partial class CollectionImportService
{
    private sealed class SoapUiRequest
    {
        public string Name { get; init; } = "";
        public string? Folder { get; init; }
        public string Method { get; init; } = "POST";
        public string Url { get; init; } = "";
        public string? Body { get; init; }
        public string BodyType { get; init; } = "none";
        public List<KeyValuePairRequest> Headers { get; init; } = [];
        public List<KeyValuePairRequest> Params { get; init; } = [];
        public AuthRequest? Auth { get; init; }
    }

    public async Task<ImportSpecificationResult> ImportSoapUiAsync(string workspaceId, ImportSpecificationRequest request)
    {
        var source = await ReadSourceAsync(request);
        var root = ParseSoapUiProject(source);

        var warnings = new List<string>();
        var serviceName = request.ServiceName;
        if (string.IsNullOrWhiteSpace(serviceName))
        {
            serviceName = (string?)root.Attribute("name");
            if (string.IsNullOrWhiteSpace(serviceName)) serviceName = "SoapUI Import";
        }

        var requests = new List<SoapUiRequest>();
        foreach (var iface in Kids(root, "interface"))
        {
            var kind = (string?)iface.Attributes().FirstOrDefault(a => a.Name.LocalName == "type" && a.Name.Namespace != XNamespace.None) ?? "";
            var isRest = kind.Contains("Rest", StringComparison.OrdinalIgnoreCase)
                || string.Equals((string?)iface.Attribute("type"), "rest", StringComparison.OrdinalIgnoreCase);
            if (isRest) CollectSoapUiRest(iface, requests, warnings);
            else CollectSoapUiSoap(iface, requests, warnings);
        }

        CollectSoapUiTestSteps(root, requests, warnings);
        if (Kids(root, "testSuite").Any()) warnings.Add("Test suite requests were imported under 'Test Suites'; assertions, scripts and other step types were not.");
        if (Kids(root, "mockService").Any()) warnings.Add("Mock services were not imported.");
        if (Kids(root, "properties").Any(p => Kids(p, "property").Any())) warnings.Add("Project properties were not imported.");
        if (requests.Any(r => r.Url.Contains("${") || (r.Body?.Contains("${") ?? false)))
            warnings.Add("Some requests contain SoapUI property expansions (${...}) that were left as-is.");

        if (requests.Count == 0)
        {
            throw new InvalidOperationException("No requests found in the SoapUI project.");
        }

        var serviceId = request.TopLevel
            ? null
            : await ResolveTargetServiceIdAsync(workspaceId, request.ServiceId, serviceName!);

        var folderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (serviceId != null)
        {
            var targetService = await _serviceRepository.GetByIdAsync(serviceId)
                ?? throw new InvalidOperationException("Service not found");
            foreach (var folder in targetService.Folders)
                folderIds[JsonDataStore.BuildFolderPath(targetService.Folders, folder)] = folder.Id;

            // Folder paths are "/"-separated (e.g. "Test Suites/Suite/Case"); create each missing level.
            foreach (var folderPath in requests.Select(r => r.Folder).Where(n => !string.IsNullOrWhiteSpace(n))
                .Select(n => n!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                string? parentId = null;
                var prefix = "";
                foreach (var segment in folderPath.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    prefix = prefix.Length == 0 ? segment : prefix + "/" + segment;
                    if (!folderIds.TryGetValue(prefix, out var existingId))
                    {
                        var folder = await _serviceRepository.CreateFolderAsync(workspaceId, serviceId, segment, parentId)
                            ?? throw new InvalidOperationException($"Could not create SoapUI folder '{prefix}'.");
                        existingId = folder.Id;
                        folderIds[prefix] = existingId;
                    }
                    parentId = existingId;
                }
            }
        }
        else if (requests.Any(r => !string.IsNullOrWhiteSpace(r.Folder)))
        {
            warnings.Add("Interfaces were flattened because top-level requests cannot use request folders.");
        }

        var created = 0;
        foreach (var item in requests)
        {
            string? folderId = null;
            if (serviceId != null && !string.IsNullOrWhiteSpace(item.Folder))
            {
                var key = string.Join('/', item.Folder.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
                folderIds.TryGetValue(key, out folderId);
            }

            var createRequest = new CreateApiRequestRequest
            {
                Name = item.Name,
                Method = item.Method,
                Url = item.Url,
                Body = item.Body,
                BodyType = item.BodyType,
                FolderId = folderId,
            };
            var apiRequest = serviceId == null
                ? await _requestRepository.CreateTopLevelAsync(workspaceId, createRequest)
                : await _requestRepository.CreateAsync(serviceId, createRequest);

            if (item.Headers.Count > 0 || item.Params.Count > 0 || item.Auth != null)
            {
                await _requestRepository.UpdateAsync(apiRequest.Id, new UpdateApiRequestRequest
                {
                    Name = apiRequest.Name,
                    Method = apiRequest.Method,
                    Url = apiRequest.Url,
                    Body = apiRequest.Body,
                    BodyType = apiRequest.BodyType,
                    Headers = item.Headers,
                    Params = item.Params,
                    Variables = [],
                    Auth = item.Auth,
                });
            }
            created++;
        }

        return new ImportSpecificationResult
        {
            ServiceId = serviceId ?? "",
            CreatedRequests = created,
            Warnings = warnings,
        };
    }

    private static XElement ParseSoapUiProject(string source)
    {
        try
        {
            using var stringReader = new StringReader(source.TrimStart('﻿'));
            using var xmlReader = XmlReader.Create(stringReader, new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null,
            });
            var root = XDocument.Load(xmlReader).Root;
            if (root == null || root.Name.LocalName != "soapui-project")
            {
                throw new InvalidOperationException("The file is not a SoapUI project (missing soapui-project root element).");
            }
            return root;
        }
        catch (XmlException ex)
        {
            throw new InvalidOperationException($"Could not parse the SoapUI project as XML: {ex.Message}");
        }
    }

    private static IEnumerable<XElement> Kids(XElement parent, string localName) =>
        parent.Elements().Where(e => e.Name.LocalName == localName);

    private static string? KidText(XElement parent, string localName) =>
        Kids(parent, localName).FirstOrDefault()?.Value;

    private static string? FirstEndpoint(XElement element) =>
        Kids(element, "endpoints").SelectMany(e => Kids(e, "endpoint")).Select(e => e.Value.Trim())
            .FirstOrDefault(v => v.Length > 0);

    private static AuthRequest? SoapUiAuth(XElement element)
    {
        var credentials = Kids(element, "credentials").FirstOrDefault();
        var username = credentials == null ? null : KidText(credentials, "username");
        if (string.IsNullOrWhiteSpace(username)) return null;

        return new AuthRequest
        {
            AuthType = "basic",
            ConfigJson = JsonSerializer.Serialize(new
            {
                username,
                password = KidText(credentials!, "password") ?? "",
            }),
        };
    }

    // ---------- SOAP (WSDL) interfaces ----------

    private static void CollectSoapUiSoap(XElement iface, List<SoapUiRequest> output, List<string> warnings)
    {
        var interfaceName = SafeFolderName((string?)iface.Attribute("name"), "Interface");
        var soapVersion = (string?)iface.Attribute("soapVersion") ?? "1.1";
        var isSoap12 = soapVersion.Contains("1.2");
        var interfaceEndpoint = FirstEndpoint(iface);

        foreach (var operation in Kids(iface, "operation"))
        {
            var operationName = (string?)operation.Attribute("name") ?? "Operation";
            var action = (string?)operation.Attribute("action") ?? "";

            foreach (var call in Kids(operation, "call"))
            {
                var callName = (string?)call.Attribute("name");
                var name = string.IsNullOrWhiteSpace(callName) || callName == operationName
                    ? operationName
                    : $"{operationName} - {callName}";

                var url = Kids(call, "endpoint").FirstOrDefault()?.Value.Trim();
                if (string.IsNullOrWhiteSpace(url)) url = interfaceEndpoint;
                if (string.IsNullOrWhiteSpace(url))
                {
                    warnings.Add($"Skipped '{name}' because it has no endpoint.");
                    continue;
                }

                var headers = SoapUiSoapHeaders(isSoap12, action);

                output.Add(new SoapUiRequest
                {
                    Name = name,
                    Folder = interfaceName,
                    Method = "POST",
                    Url = url,
                    Body = KidText(call, "request") ?? "",
                    BodyType = "xml",
                    Headers = headers,
                    Auth = SoapUiAuth(call),
                });
            }
        }
    }

    // ---------- REST interfaces ----------

    private static void CollectSoapUiRest(XElement iface, List<SoapUiRequest> output, List<string> warnings)
    {
        var interfaceName = SafeFolderName((string?)iface.Attribute("name"), "REST");
        var basePath = (string?)iface.Attribute("basePath") ?? "";
        var interfaceEndpoint = FirstEndpoint(iface);

        foreach (var resource in Kids(iface, "resource"))
        {
            WalkSoapUiResource(resource, interfaceName, interfaceEndpoint, basePath, [], output, warnings);
        }
    }

    private static void WalkSoapUiResource(
        XElement resource,
        string interfaceName,
        string? interfaceEndpoint,
        string parentPath,
        List<XElement> parameterSources,
        List<SoapUiRequest> output,
        List<string> warnings)
    {
        var path = JoinUrlPath(parentPath, (string?)resource.Attribute("path") ?? "");
        var sources = new List<XElement>(parameterSources);
        sources.AddRange(Kids(resource, "parameters"));

        foreach (var child in Kids(resource, "resource"))
        {
            WalkSoapUiResource(child, interfaceName, interfaceEndpoint, path, sources, output, warnings);
        }

        foreach (var method in Kids(resource, "method"))
        {
            var methodName = NormalizeHttpMethod((string?)method.Attribute("method"));
            var resourceName = (string?)resource.Attribute("name") ?? path;
            if (methodName == null)
            {
                warnings.Add($"Skipped method '{(string?)method.Attribute("name")}' of '{resourceName}' because the HTTP method is not recognized.");
                continue;
            }

            var methodSources = new List<XElement>(sources);
            methodSources.AddRange(Kids(method, "parameters"));

            foreach (var call in Kids(method, "request"))
            {
                var callSources = new List<XElement>(methodSources);
                callSources.AddRange(Kids(call, "parameters"));

                var endpoint = Kids(call, "endpoint").FirstOrDefault()?.Value.Trim();
                if (string.IsNullOrWhiteSpace(endpoint)) endpoint = interfaceEndpoint;
                if (string.IsNullOrWhiteSpace(endpoint))
                {
                    warnings.Add($"Skipped '{resourceName}' because it has no endpoint.");
                    continue;
                }

                // Later (more specific) levels override earlier ones.
                var values = new Dictionary<string, (string Style, string Value)>(StringComparer.Ordinal);
                foreach (var param in callSources.SelectMany(p => Kids(p, "parameter")))
                {
                    var paramName = KidText(param, "name") ?? (string?)param.Attribute("name");
                    if (string.IsNullOrWhiteSpace(paramName)) continue;
                    values[paramName] = (
                        (KidText(param, "style") ?? "QUERY").ToUpperInvariant(),
                        KidText(param, "value") ?? KidText(param, "default") ?? "");
                }

                // Request-level values are stored as <con:entry key="" value=""/> under <con:parameters>.
                foreach (var entry in callSources.SelectMany(p => Kids(p, "entry")))
                {
                    var key = (string?)entry.Attribute("key");
                    if (string.IsNullOrWhiteSpace(key)) continue;
                    var entryValue = (string?)entry.Attribute("value") ?? "";
                    values[key] = (values.TryGetValue(key, out var known) ? known.Style : "QUERY", entryValue);
                }

                var resolvedPath = path;
                var headers = new List<KeyValuePairRequest>();
                var queryParams = new List<KeyValuePairRequest>();
                foreach (var (paramName, (style, value)) in values)
                {
                    switch (style)
                    {
                        case "TEMPLATE":
                            resolvedPath = resolvedPath.Replace("{" + paramName + "}", value);
                            break;
                        case "HEADER":
                            headers.Add(new KeyValuePairRequest { Key = paramName, Value = value, Enabled = true });
                            break;
                        case "QUERY":
                            queryParams.Add(new KeyValuePairRequest { Key = paramName, Value = value, Enabled = true });
                            break;
                        default:
                            warnings.Add($"Parameter '{paramName}' of '{resourceName}' was skipped because style '{style}' is not supported.");
                            break;
                    }
                }

                var body = KidText(call, "request");
                var mediaType = (string?)call.Attribute("mediaType");
                if (!string.IsNullOrWhiteSpace(body) && !string.IsNullOrWhiteSpace(mediaType)
                    && !headers.Any(h => string.Equals(h.Key, "Content-Type", StringComparison.OrdinalIgnoreCase)))
                {
                    headers.Add(new KeyValuePairRequest { Key = "Content-Type", Value = mediaType, Enabled = true });
                }

                var methodLabel = (string?)method.Attribute("name");
                var callLabel = (string?)call.Attribute("name");
                var name = string.Join(" - ", new[] { resourceName, methodLabel, callLabel }
                    .Where(s => !string.IsNullOrWhiteSpace(s)).Distinct());

                output.Add(new SoapUiRequest
                {
                    Name = name,
                    Folder = interfaceName,
                    Method = methodName,
                    Url = endpoint!.TrimEnd('/') + resolvedPath,
                    Body = string.IsNullOrWhiteSpace(body) ? null : body,
                    BodyType = string.IsNullOrWhiteSpace(body) ? "none" : InferBodyTypeFromContentType(mediaType),
                    Headers = headers,
                    Params = queryParams,
                    Auth = SoapUiAuth(call),
                });
            }
        }
    }

    private static string SafeFolderName(string? name, string fallback) =>
        string.IsNullOrWhiteSpace(name) ? fallback : name.Replace('/', '-').Trim();

    private static List<KeyValuePairRequest> SoapUiSoapHeaders(bool isSoap12, string action)
    {
        var headers = new List<KeyValuePairRequest>();
        if (isSoap12)
        {
            var contentType = "application/soap+xml; charset=utf-8";
            if (!string.IsNullOrWhiteSpace(action)) contentType += $"; action=\"{action}\"";
            headers.Add(new KeyValuePairRequest { Key = "Content-Type", Value = contentType, Enabled = true });
        }
        else
        {
            headers.Add(new KeyValuePairRequest { Key = "Content-Type", Value = "text/xml; charset=utf-8", Enabled = true });
            headers.Add(new KeyValuePairRequest { Key = "SOAPAction", Value = $"\"{action}\"", Enabled = true });
        }
        return headers;
    }

    // ---------- Test suite request steps ----------

    private static void CollectSoapUiTestSteps(XElement root, List<SoapUiRequest> output, List<string> warnings)
    {
        var interfaces = Kids(root, "interface").ToList();

        foreach (var suite in Kids(root, "testSuite"))
        {
            var suiteName = SafeFolderName((string?)suite.Attribute("name"), "Test Suite");
            foreach (var testCase in Kids(suite, "testCase"))
            {
                var folder = $"Test Suites/{suiteName}/{SafeFolderName((string?)testCase.Attribute("name"), "Test Case")}";
                foreach (var step in Kids(testCase, "testStep"))
                {
                    var stepName = (string?)step.Attribute("name") ?? "Step";
                    var type = ((string?)step.Attribute("type") ?? "").ToLowerInvariant();
                    var config = Kids(step, "config").FirstOrDefault();
                    if (config == null) continue;

                    if (type == "request") AddSoapUiSoapStep(config, stepName, folder, interfaces, output, warnings);
                    else if (type == "restrequest") AddSoapUiRestStep(config, stepName, folder, interfaces, output, warnings);
                }
            }
        }
    }

    private static void AddSoapUiSoapStep(
        XElement config, string stepName, string folder, List<XElement> interfaces,
        List<SoapUiRequest> output, List<string> warnings)
    {
        var call = Kids(config, "request").FirstOrDefault();
        if (call == null) return;

        var iface = interfaces.FirstOrDefault(i => (string?)i.Attribute("name") == KidText(config, "interface"));
        var operationName = KidText(config, "operation");
        var operation = iface == null ? null : Kids(iface, "operation").FirstOrDefault(o => (string?)o.Attribute("name") == operationName);
        var action = (string?)operation?.Attribute("action") ?? "";
        var isSoap12 = ((string?)iface?.Attribute("soapVersion") ?? "1.1").Contains("1.2");

        var url = Kids(call, "endpoint").FirstOrDefault()?.Value.Trim();
        if (string.IsNullOrWhiteSpace(url) && iface != null) url = FirstEndpoint(iface);
        if (string.IsNullOrWhiteSpace(url))
        {
            warnings.Add($"Skipped test step '{stepName}' because it has no endpoint.");
            return;
        }

        output.Add(new SoapUiRequest
        {
            Name = stepName,
            Folder = folder,
            Method = "POST",
            Url = url,
            Body = KidText(call, "request") ?? "",
            BodyType = "xml",
            Headers = SoapUiSoapHeaders(isSoap12, action),
            Auth = SoapUiAuth(call),
        });
    }

    private static void AddSoapUiRestStep(
        XElement config, string stepName, string folder, List<XElement> interfaces,
        List<SoapUiRequest> output, List<string> warnings)
    {
        var call = Kids(config, "restRequest").FirstOrDefault();
        if (call == null) return;

        var iface = interfaces.FirstOrDefault(i => (string?)i.Attribute("name") == (string?)config.Attribute("service"));
        var method = NormalizeHttpMethod((string?)call.Attribute("method"));
        if (method == null)
        {
            warnings.Add($"Skipped test step '{stepName}' because the HTTP method is not recognized.");
            return;
        }

        var endpoint = Kids(call, "endpoint").FirstOrDefault()?.Value.Trim();
        if (string.IsNullOrWhiteSpace(endpoint) && iface != null) endpoint = FirstEndpoint(iface);
        if (string.IsNullOrWhiteSpace(endpoint))
        {
            warnings.Add($"Skipped test step '{stepName}' because it has no endpoint.");
            return;
        }

        var path = JoinUrlPath((string?)iface?.Attribute("basePath") ?? "", (string?)config.Attribute("resourcePath") ?? "");
        var queryParams = new List<KeyValuePairRequest>();
        foreach (var entry in Kids(call, "parameters").SelectMany(p => Kids(p, "entry")))
        {
            var key = (string?)entry.Attribute("key");
            if (string.IsNullOrWhiteSpace(key)) continue;
            var value = (string?)entry.Attribute("value") ?? "";
            if (path.Contains("{" + key + "}")) path = path.Replace("{" + key + "}", value);
            else queryParams.Add(new KeyValuePairRequest { Key = key, Value = value, Enabled = true });
        }

        var body = KidText(call, "request");
        var mediaType = (string?)call.Attribute("mediaType");
        var headers = new List<KeyValuePairRequest>();
        if (!string.IsNullOrWhiteSpace(body) && !string.IsNullOrWhiteSpace(mediaType))
            headers.Add(new KeyValuePairRequest { Key = "Content-Type", Value = mediaType, Enabled = true });

        output.Add(new SoapUiRequest
        {
            Name = stepName,
            Folder = folder,
            Method = method,
            Url = endpoint!.TrimEnd('/') + path,
            Body = string.IsNullOrWhiteSpace(body) ? null : body,
            BodyType = string.IsNullOrWhiteSpace(body) ? "none" : InferBodyTypeFromContentType(mediaType),
            Headers = headers,
            Params = queryParams,
            Auth = SoapUiAuth(call),
        });
    }

    private static string JoinUrlPath(string parent, string child)
    {
        if (string.IsNullOrEmpty(child)) return parent;
        if (string.IsNullOrEmpty(parent)) return child.StartsWith('/') ? child : "/" + child;
        return parent.TrimEnd('/') + "/" + child.TrimStart('/');
    }
}
