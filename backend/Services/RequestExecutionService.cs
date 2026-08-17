using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Jint;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

public class RequestExecutionService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly VariableResolutionService _variableService;
    private readonly IServiceRepository _serviceRepo;
    private readonly IRequestRepository _requestRepo;
    private readonly IHistoryRepository _historyRepo;
    private readonly SettingsService _settings;
    private readonly ILogger<RequestExecutionService> _logger;

    private static readonly ConcurrentDictionary<string, Dictionary<string, RuntimeScriptVariable>> RuntimeVariablesByScope =
        new(StringComparer.OrdinalIgnoreCase);

    public RequestExecutionService(
        IHttpClientFactory httpClientFactory,
        VariableResolutionService variableService,
        IServiceRepository serviceRepo,
        IRequestRepository requestRepo,
        IHistoryRepository historyRepo,
        SettingsService settings,
        ILogger<RequestExecutionService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _variableService = variableService;
        _serviceRepo = serviceRepo;
        _requestRepo = requestRepo;
        _historyRepo = historyRepo;
        _settings = settings;
        _logger = logger;
    }

    public async Task<ExecuteResponse> ExecuteAsync(ExecuteRequestPayload payload, CancellationToken cancellationToken)
    {
        var workspaceId = payload.WorkspaceId ?? "default";
        var runtimeScopeKey = BuildRuntimeScopeKey(workspaceId, payload.RequestId);
        var runtimeVariables = GetRuntimeVariables(runtimeScopeKey);
        var scriptLogs = new List<string>();
        var stopwatch = Stopwatch.StartNew();
        var urlForDiagnostics = payload.Url ?? "";

        try
        {
            var requestVariables = BuildRequestVariableMap(payload.Variables);

            foreach (var (key, variable) in runtimeVariables)
            {
                requestVariables[key] = variable.Value;
            }

            var requestState = new ScriptRequestState
            {
                Method = payload.Method,
                Url = payload.Url,
                Body = payload.Body,
                BodyType = payload.BodyType,
                Headers = CloneKeyValueRequests(payload.Headers),
                Params = CloneKeyValueRequests(payload.Params)
            };

            var preRequestScript = await ResolvePreRequestScriptAsync(payload);
            var preScriptVariables = await _variableService.BuildVariableMapAsync(workspaceId, payload.ServiceId, requestVariables);
            var preScriptResult = ExecuteScript(
                script: preRequestScript,
                requestState: requestState,
                responseState: null,
                runtimeVariables: runtimeVariables,
                availableVariables: preScriptVariables,
                sourceLabel: "Pre-request script");

            scriptLogs.AddRange(preScriptResult.Logs);

            if (!preScriptResult.Success)
            {
                stopwatch.Stop();
                return new ExecuteResponse
                {
                    StatusCode = 0,
                    StatusText = "Script Error",
                    Error = $"Pre-request script failed: {preScriptResult.ErrorMessage}",
                    ResponseTimeMs = stopwatch.ElapsedMilliseconds,
                    ScriptVariables = CloneRuntimeVariables(runtimeVariables),
                    ScriptLogs = scriptLogs
                };
            }

            requestVariables = BuildRequestVariableMap(payload.Variables);
            foreach (var (key, variable) in runtimeVariables)
            {
                requestVariables[key] = variable.Value;
            }

            var serviceDefaults = !string.IsNullOrWhiteSpace(payload.ServiceId)
                ? await _serviceRepo.GetByIdAsync(payload.ServiceId)
                : null;
            var mergedHeaders = MergeHeaders(serviceDefaults?.Headers ?? [], requestState.Headers);
            var effectiveAuth = ResolveEffectiveAuth(payload.Auth, serviceDefaults?.Auth);

            // Resolve variables
            var resolvedUrl = await _variableService.ResolveAsync(requestState.Url, workspaceId, payload.ServiceId, requestVariables);
            urlForDiagnostics = resolvedUrl;
            var resolvedBody = requestState.Body != null
                ? await _variableService.ResolveAsync(requestState.Body, workspaceId, payload.ServiceId, requestVariables)
                : null;

            // Build query string from params
            if (requestState.Params.Count > 0)
            {
                var enabledParams = requestState.Params.Where(p => p.Enabled);
                var queryParts = new List<string>();
                foreach (var p in enabledParams)
                {
                    var key = await _variableService.ResolveAsync(p.Key, workspaceId, payload.ServiceId, requestVariables);
                    var value = await _variableService.ResolveAsync(p.Value, workspaceId, payload.ServiceId, requestVariables);
                    queryParts.Add($"{Uri.EscapeDataString(key)}={Uri.EscapeDataString(value)}");
                }
                if (queryParts.Count > 0)
                {
                    resolvedUrl += (resolvedUrl.Contains('?') ? "&" : "?") + string.Join("&", queryParts);
                    urlForDiagnostics = resolvedUrl;
                }
            }

            // Create HttpClient
            var requestSettings = !string.IsNullOrWhiteSpace(payload.RequestId)
                ? await _requestRepo.GetSettingsAsync(payload.RequestId)
                : null;
            var followRedirects = requestSettings?.FollowRedirects ?? true;
            var ignoreSsl = payload.IgnoreSslErrors
                || _settings.IgnoreSslErrors
                || (requestSettings?.IgnoreSslErrors ?? false);
            var useProxy = false;
            Uri? proxyUri = null;
            if (_settings.ProxyEnabled && Uri.TryCreate(_settings.ProxyUrl, UriKind.Absolute, out var parsedProxyUri))
            {
                useProxy = true;
                proxyUri = parsedProxyUri;
            }

            HttpClient client;
            if (ignoreSsl || payload.Mtls != null || useProxy || !followRedirects)
            {
                var handler = new HttpClientHandler
                {
                    AllowAutoRedirect = followRedirects
                };

                if (ignoreSsl)
                {
                    handler.ServerCertificateCustomValidationCallback = (_, _, _, _) => true;
                }

                if (payload.Mtls != null)
                {
                    var cert = X509Certificate2.CreateFromPemFile(payload.Mtls.CertPath, payload.Mtls.KeyPath);
                    handler.ClientCertificates.Add(cert);
                }

                if (useProxy)
                {
                    handler.UseProxy = true;
                    handler.Proxy = new WebProxy(proxyUri);
                    if (!string.IsNullOrWhiteSpace(_settings.ProxyUsername))
                    {
                        handler.Proxy.Credentials = new NetworkCredential(_settings.ProxyUsername, _settings.ProxyPassword);
                    }
                }

                client = new HttpClient(handler);
            }
            else
            {
                client = _httpClientFactory.CreateClient();
            }

            client.Timeout = requestSettings?.TimeoutSeconds is > 0
                ? TimeSpan.FromSeconds(requestSettings.TimeoutSeconds.Value)
                : _settings.RequestTimeoutMs > 0
                    ? TimeSpan.FromMilliseconds(_settings.RequestTimeoutMs)
                    : Timeout.InfiniteTimeSpan;

            // Build request
            var httpMethod = new HttpMethod((requestState.Method ?? payload.Method).ToUpperInvariant());
            var request = new HttpRequestMessage(httpMethod, resolvedUrl);

            // Apply headers
            foreach (var h in mergedHeaders.Where(h => h.Enabled))
            {
                var headerKey = await _variableService.ResolveAsync(h.Key, workspaceId, payload.ServiceId, requestVariables);
                var headerValue = await _variableService.ResolveAsync(h.Value, workspaceId, payload.ServiceId, requestVariables);
                request.Headers.TryAddWithoutValidation(headerKey, headerValue);
            }

            // Apply auth
            if (effectiveAuth != null && effectiveAuth.AuthType != "none")
            {
                await ApplyAuthAsync(request, effectiveAuth, workspaceId, payload.ServiceId, requestVariables);
            }

            // Apply body
            if (resolvedBody != null && httpMethod != HttpMethod.Get && httpMethod != HttpMethod.Head)
            {
                var contentType = requestState.BodyType switch
                {
                    "json" => "application/json",
                    "xml" => "text/xml",
                    "text" => "text/plain",
                    "form" => "application/x-www-form-urlencoded",
                    _ => "text/plain"
                };
                request.Content = new StringContent(resolvedBody, Encoding.UTF8, contentType);
            }

            // Execute
            var response = await client.SendAsync(request, cancellationToken);
            stopwatch.Stop();

            var maxBodyBytes = _settings.MaxResponseBodySizeMb * 1024 * 1024;
            var (responseBody, bodyTruncated) = await ReadResponseBodyAsync(response, maxBodyBytes, cancellationToken);
            var responseHeaders = response.Headers
                .Concat(response.Content.Headers)
                .ToDictionary(h => h.Key, h => h.Value.ToArray(), StringComparer.OrdinalIgnoreCase);

            var result = new ExecuteResponse
            {
                StatusCode = (int)response.StatusCode,
                StatusText = response.ReasonPhrase ?? "",
                Headers = responseHeaders,
                Body = responseBody,
                ContentType = response.Content.Headers.ContentType?.MediaType ?? "",
                ResponseTimeMs = stopwatch.ElapsedMilliseconds,
                ResponseSizeBytes = bodyTruncated && response.Content.Headers.ContentLength is long contentLength
                    ? contentLength
                    : Encoding.UTF8.GetByteCount(responseBody),
                IsTruncated = bodyTruncated
            };

            var postRequestScript = await ResolvePostRequestScriptAsync(payload);
            var postScriptVariables = await _variableService.BuildVariableMapAsync(workspaceId, payload.ServiceId, requestVariables);
            var postScriptResult = ExecuteScript(
                script: postRequestScript,
                requestState: requestState,
                responseState: new ScriptResponseState
                {
                    StatusCode = result.StatusCode,
                    StatusText = result.StatusText,
                    Body = result.Body,
                    ContentType = result.ContentType,
                    Headers = responseHeaders
                },
                runtimeVariables: runtimeVariables,
                availableVariables: postScriptVariables,
                sourceLabel: "Post-request script");

            scriptLogs.AddRange(postScriptResult.Logs);
            if (!postScriptResult.Success)
            {
                scriptLogs.Add($"Post-request script failed: {postScriptResult.ErrorMessage}");
            }

            SetRuntimeVariables(runtimeScopeKey, runtimeVariables);
            result.ScriptVariables = CloneRuntimeVariables(runtimeVariables);
            result.ScriptLogs = scriptLogs;

            var testScript = await ResolveTestScriptAsync(payload);
            var testVariables = await _variableService.BuildVariableMapAsync(workspaceId, payload.ServiceId, requestVariables);
            result.TestResults = TestScriptRunner.Run(testScript, result, testVariables);

            // Check for SOAP fault
            if (result.ContentType.Contains("xml"))
            {
                DetectSoapFault(result, responseBody);
            }

            // Store in history
            if (_settings.SaveHistory)
            {
                await _historyRepo.CreateAsync(new HistoryEntry
                {
                    WorkspaceId = workspaceId,
                    RequestId = payload.RequestId,
                    Method = requestState.Method,
                    Url = resolvedUrl,
                    RequestHeadersJson = JsonSerializer.Serialize(mergedHeaders),
                    RequestBody = resolvedBody,
                    ResponseStatus = result.StatusCode,
                    ResponseHeadersJson = JsonSerializer.Serialize(responseHeaders),
                    ResponseBody = responseBody,
                    ResponseTimeMs = result.ResponseTimeMs,
                    ResponseSizeBytes = result.ResponseSizeBytes
                });
            }

            return result;
        }
        catch (TaskCanceledException)
        {
            stopwatch.Stop();
            return new ExecuteResponse
            {
                StatusCode = 0,
                StatusText = "Cancelled",
                Error = "Request was cancelled",
                ResponseTimeMs = stopwatch.ElapsedMilliseconds,
                ScriptVariables = CloneRuntimeVariables(runtimeVariables),
                ScriptLogs = scriptLogs
            };
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            _logger.LogError(ex, "Request execution failed");
            return new ExecuteResponse
            {
                StatusCode = 0,
                StatusText = "Error",
                Error = BuildErrorMessageWithUrl(ex.Message, urlForDiagnostics),
                ResponseTimeMs = stopwatch.ElapsedMilliseconds,
                ScriptVariables = CloneRuntimeVariables(runtimeVariables),
                ScriptLogs = scriptLogs
            };
        }
    }

    private static string BuildErrorMessageWithUrl(string message, string attemptedUrl)
    {
        if (string.IsNullOrWhiteSpace(attemptedUrl))
        {
            return message;
        }

        return $"{message} (URL: {attemptedUrl})";
    }

    private static async Task<(string Body, bool Truncated)> ReadResponseBodyAsync(
        HttpResponseMessage response,
        long maxBytes,
        CancellationToken cancellationToken)
    {
        var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream);

        if (maxBytes <= 0)
        {
            return (await reader.ReadToEndAsync(cancellationToken), false);
        }

        var sb = new StringBuilder((int)Math.Min(maxBytes, 8192));
        var buffer = new char[8192];
        var total = 0L;

        while (total < maxBytes)
        {
            var toRead = (int)Math.Min(buffer.Length, maxBytes - total);
            var read = await reader.ReadAsync(buffer.AsMemory(0, toRead), cancellationToken);
            if (read == 0) break;
            sb.Append(buffer, 0, read);
            total += read;
        }

        return (sb.ToString(), total > 0 && reader.Peek() >= 0);
    }

    private async Task<string> ResolvePreRequestScriptAsync(ExecuteRequestPayload payload)
    {
        if (payload.PreRequestScript != null)
        {
            return payload.PreRequestScript;
        }

        if (string.IsNullOrWhiteSpace(payload.RequestId))
        {
            return "";
        }

        var request = await _requestRepo.GetByIdAsync(payload.RequestId);
        return request?.PreRequestScript ?? "";
    }

    private async Task<string> ResolvePostRequestScriptAsync(ExecuteRequestPayload payload)
    {
        if (payload.PostRequestScript != null)
        {
            return payload.PostRequestScript;
        }

        if (string.IsNullOrWhiteSpace(payload.RequestId))
        {
            return "";
        }

        var request = await _requestRepo.GetByIdAsync(payload.RequestId);
        return request?.PostRequestScript ?? "";
    }

    private async Task<string> ResolveTestScriptAsync(ExecuteRequestPayload payload)
    {
        if (payload.TestScript != null)
        {
            return payload.TestScript;
        }

        if (string.IsNullOrWhiteSpace(payload.RequestId))
        {
            return "";
        }

        var request = await _requestRepo.GetByIdAsync(payload.RequestId);
        return request?.TestScript ?? "";
    }

    private static ScriptExecutionResult ExecuteScript(
        string script,
        ScriptRequestState requestState,
        ScriptResponseState? responseState,
        Dictionary<string, RuntimeScriptVariable> runtimeVariables,
        Dictionary<string, string> availableVariables,
        string sourceLabel)
    {
        var logs = new List<string>();

        if (string.IsNullOrWhiteSpace(script))
        {
            return ScriptExecutionResult.CreateSuccess(logs);
        }

        try
        {
            var engine = new Engine(options => options.TimeoutInterval(TimeSpan.FromMilliseconds(500)));

            engine.SetValue("setVar", new Action<string, object?>((key, value) =>
            {
                var normalizedKey = key?.Trim();
                if (string.IsNullOrWhiteSpace(normalizedKey)) return;

                var normalizedValue = value?.ToString() ?? "";
                runtimeVariables[normalizedKey] = new RuntimeScriptVariable
                {
                    Value = normalizedValue,
                    Source = sourceLabel
                };
                availableVariables[normalizedKey] = normalizedValue;
            }));

            engine.SetValue("getVar", new Func<string, string?>((key) =>
            {
                var normalizedKey = key?.Trim();
                if (string.IsNullOrWhiteSpace(normalizedKey)) return null;

                if (runtimeVariables.TryGetValue(normalizedKey, out var runtimeVar))
                {
                    return runtimeVar.Value;
                }

                return availableVariables.TryGetValue(normalizedKey, out var value)
                    ? value
                    : null;
            }));

            engine.SetValue("unsetVar", new Action<string>((key) =>
            {
                var normalizedKey = key?.Trim();
                if (string.IsNullOrWhiteSpace(normalizedKey)) return;

                runtimeVariables.Remove(normalizedKey);
                availableVariables.Remove(normalizedKey);
            }));

            engine.SetValue("setUrl", new Action<string>((url) =>
            {
                requestState.Url = url ?? "";
            }));
            engine.SetValue("getUrl", new Func<string>(() => requestState.Url));

            engine.SetValue("setMethod", new Action<string>((method) =>
            {
                if (!string.IsNullOrWhiteSpace(method))
                {
                    requestState.Method = method.Trim().ToUpperInvariant();
                }
            }));
            engine.SetValue("getMethod", new Func<string>(() => requestState.Method));

            engine.SetValue("setBody", new Action<string?>((body) =>
            {
                requestState.Body = body;
            }));
            engine.SetValue("getBody", new Func<string?>(() => requestState.Body));

            engine.SetValue("setHeader", new Action<string, object?>((key, value) =>
            {
                UpsertKeyValue(requestState.Headers, key, value?.ToString() ?? "");
            }));
            engine.SetValue("removeHeader", new Action<string>((key) =>
            {
                RemoveKeyValue(requestState.Headers, key);
            }));
            engine.SetValue("getHeader", new Func<string, string?>((key) =>
            {
                return GetKeyValue(requestState.Headers, key);
            }));

            engine.SetValue("setParam", new Action<string, object?>((key, value) =>
            {
                UpsertKeyValue(requestState.Params, key, value?.ToString() ?? "");
            }));
            engine.SetValue("removeParam", new Action<string>((key) =>
            {
                RemoveKeyValue(requestState.Params, key);
            }));
            engine.SetValue("getParam", new Func<string, string?>((key) =>
            {
                return GetKeyValue(requestState.Params, key);
            }));

            engine.SetValue("log", new Action<object?>((value) =>
            {
                logs.Add(value?.ToString() ?? "null");
            }));

            engine.SetValue("request", new Dictionary<string, object?>
            {
                ["method"] = requestState.Method,
                ["url"] = requestState.Url,
                ["body"] = requestState.Body,
                ["bodyType"] = requestState.BodyType
            });

            if (responseState != null)
            {
                engine.SetValue("getResponseStatus", new Func<int>(() => responseState.StatusCode));
                engine.SetValue("getResponseBody", new Func<string>(() => responseState.Body));
                engine.SetValue("getResponseHeader", new Func<string, string?>((key) =>
                {
                    if (string.IsNullOrWhiteSpace(key)) return null;
                    return responseState.Headers.TryGetValue(key.Trim(), out var values)
                        ? string.Join(", ", values)
                        : null;
                }));

                engine.SetValue("response", new Dictionary<string, object?>
                {
                    ["statusCode"] = responseState.StatusCode,
                    ["statusText"] = responseState.StatusText,
                    ["contentType"] = responseState.ContentType
                });
            }

            engine.Execute(script);
            return ScriptExecutionResult.CreateSuccess(logs);
        }
        catch (Exception ex)
        {
            return ScriptExecutionResult.CreateFailure(logs, ex.Message);
        }
    }

    private static List<KeyValuePairRequest> CloneKeyValueRequests(IEnumerable<KeyValuePairRequest>? source)
    {
        if (source == null)
        {
            return [];
        }

        return source.Select(entry => new KeyValuePairRequest
        {
            Key = entry.Key,
            Value = entry.Value,
            Enabled = entry.Enabled
        }).ToList();
    }

    private static void UpsertKeyValue(List<KeyValuePairRequest> collection, string key, string value)
    {
        if (string.IsNullOrWhiteSpace(key)) return;

        var normalizedKey = key.Trim();
        var existing = collection.FirstOrDefault(entry =>
            string.Equals(entry.Key?.Trim(), normalizedKey, StringComparison.OrdinalIgnoreCase));

        if (existing != null)
        {
            existing.Value = value;
            existing.Enabled = true;
            return;
        }

        collection.Add(new KeyValuePairRequest
        {
            Key = normalizedKey,
            Value = value,
            Enabled = true
        });
    }

    private static void RemoveKeyValue(List<KeyValuePairRequest> collection, string key)
    {
        if (string.IsNullOrWhiteSpace(key)) return;
        var normalizedKey = key.Trim();
        collection.RemoveAll(entry => string.Equals(entry.Key?.Trim(), normalizedKey, StringComparison.OrdinalIgnoreCase));
    }

    private static string? GetKeyValue(List<KeyValuePairRequest> collection, string key)
    {
        if (string.IsNullOrWhiteSpace(key)) return null;
        var normalizedKey = key.Trim();
        return collection.FirstOrDefault(entry =>
            string.Equals(entry.Key?.Trim(), normalizedKey, StringComparison.OrdinalIgnoreCase))?.Value;
    }

    private static string BuildRuntimeScopeKey(string workspaceId, string? requestId)
    {
        if (string.IsNullOrWhiteSpace(requestId))
        {
            return $"{workspaceId}::adhoc";
        }

        return $"{workspaceId}::{requestId.Trim()}";
    }

    private static Dictionary<string, RuntimeScriptVariable> GetRuntimeVariables(string scopeKey)
    {
        if (!RuntimeVariablesByScope.TryGetValue(scopeKey, out var variables))
        {
            return new Dictionary<string, RuntimeScriptVariable>(StringComparer.OrdinalIgnoreCase);
        }

        return CloneRuntimeVariables(variables);
    }

    private static void SetRuntimeVariables(string scopeKey, Dictionary<string, RuntimeScriptVariable> runtimeVariables)
    {
        RuntimeVariablesByScope[scopeKey] = CloneRuntimeVariables(runtimeVariables);
    }

    private static Dictionary<string, RuntimeScriptVariable> CloneRuntimeVariables(
        Dictionary<string, RuntimeScriptVariable> runtimeVariables)
    {
        return runtimeVariables.ToDictionary(
            pair => pair.Key,
            pair => new RuntimeScriptVariable
            {
                Value = pair.Value.Value,
                Source = pair.Value.Source
            },
            StringComparer.OrdinalIgnoreCase);
    }

    private static List<KeyValuePairRequest> MergeHeaders(
        IEnumerable<RequestLoom.Api.Models.KeyValuePair> serviceHeaders,
        IEnumerable<KeyValuePairRequest> requestHeaders)
    {
        var merged = new Dictionary<string, KeyValuePairRequest>(StringComparer.OrdinalIgnoreCase);

        foreach (var serviceHeader in serviceHeaders.Where(h => h.Enabled && !string.IsNullOrWhiteSpace(h.Key)))
        {
            var normalizedKey = serviceHeader.Key.Trim();
            merged[normalizedKey] = new KeyValuePairRequest
            {
                Key = normalizedKey,
                Value = serviceHeader.Value ?? "",
                Enabled = true
            };
        }

        foreach (var requestHeader in requestHeaders.Where(h => !string.IsNullOrWhiteSpace(h.Key)))
        {
            var normalizedKey = requestHeader.Key.Trim();

            if (!requestHeader.Enabled)
            {
                merged.Remove(normalizedKey);
                continue;
            }

            merged[normalizedKey] = new KeyValuePairRequest
            {
                Key = normalizedKey,
                Value = requestHeader.Value ?? "",
                Enabled = true
            };
        }

        return merged.Values.ToList();
    }

    private static AuthRequest? ResolveEffectiveAuth(AuthRequest? requestAuth, ServiceAuth? serviceAuth)
    {
        if (requestAuth == null || IsAuthType(requestAuth.AuthType, "inherit"))
        {
            if (serviceAuth == null || IsAuthType(serviceAuth.AuthType, "none"))
            {
                return null;
            }

            return new AuthRequest
            {
                AuthType = serviceAuth.AuthType,
                ConfigJson = serviceAuth.ConfigJson
            };
        }

        if (IsAuthType(requestAuth.AuthType, "none"))
        {
            return null;
        }

        return requestAuth;
    }

    private static bool IsAuthType(string? authType, string expected)
    {
        return string.Equals(authType?.Trim(), expected, StringComparison.OrdinalIgnoreCase);
    }

    private async Task ApplyAuthAsync(
        HttpRequestMessage request,
        AuthRequest auth,
        string workspaceId,
        string? serviceId,
        Dictionary<string, string> requestVariables)
    {
        var config = JsonSerializer.Deserialize<JsonElement>(auth.ConfigJson);

        switch ((auth.AuthType ?? "").Trim().ToLowerInvariant())
        {
            case "basic":
                var username = await _variableService.ResolveAsync(
                    config.GetProperty("username").GetString() ?? "", workspaceId, serviceId, requestVariables);
                var password = await _variableService.ResolveAsync(
                    config.GetProperty("password").GetString() ?? "", workspaceId, serviceId, requestVariables);
                var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{username}:{password}"));
                request.Headers.TryAddWithoutValidation("Authorization", $"Basic {encoded}");
                break;

            case "bearer":
                var token = await _variableService.ResolveAsync(
                    config.GetProperty("token").GetString() ?? "", workspaceId, serviceId, requestVariables);
                request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
                break;

            case "apikey":
                var keyName = await _variableService.ResolveAsync(
                    config.GetProperty("key").GetString() ?? "", workspaceId, serviceId, requestVariables);
                var keyValue = await _variableService.ResolveAsync(
                    config.GetProperty("value").GetString() ?? "", workspaceId, serviceId, requestVariables);
                var location = config.GetProperty("in").GetString() ?? "header";
                if (location == "header")
                {
                    request.Headers.TryAddWithoutValidation(keyName, keyValue);
                }
                else if (location == "query" && request.RequestUri != null)
                {
                    var uriBuilder = new UriBuilder(request.RequestUri);
                    var queryPrefix = string.IsNullOrEmpty(uriBuilder.Query) || uriBuilder.Query == "?"
                        ? ""
                        : uriBuilder.Query.TrimStart('?') + "&";
                    uriBuilder.Query = queryPrefix + $"{Uri.EscapeDataString(keyName)}={Uri.EscapeDataString(keyValue)}";
                    request.RequestUri = uriBuilder.Uri;
                }
                break;
        }
    }

    private static Dictionary<string, string> BuildRequestVariableMap(IEnumerable<RequestVariableRequest> variables)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var variable in variables)
        {
            if (!variable.Enabled) continue;
            if (string.IsNullOrWhiteSpace(variable.Key)) continue;
            map[variable.Key.Trim()] = variable.Value ?? "";
        }

        return map;
    }

    private static void DetectSoapFault(ExecuteResponse result, string body)
    {
        try
        {
            var doc = XDocument.Parse(body);
            XNamespace soapNs = "http://schemas.xmlsoap.org/soap/envelope/";
            XNamespace soap12Ns = "http://www.w3.org/2003/05/soap-envelope";

            var fault = doc.Descendants(soapNs + "Fault").FirstOrDefault()
                ?? doc.Descendants(soap12Ns + "Fault").FirstOrDefault();

            if (fault != null)
            {
                result.IsSoapFault = true;
                result.SoapFault = new SoapFaultInfo
                {
                    FaultCode = fault.Element("faultcode")?.Value
                        ?? fault.Element(soap12Ns + "Code")?.Value ?? "",
                    FaultString = fault.Element("faultstring")?.Value
                        ?? fault.Element(soap12Ns + "Reason")?.Value ?? "",
                    Detail = fault.Element("detail")?.ToString()
                        ?? fault.Element(soap12Ns + "Detail")?.ToString()
                };
            }
        }
        catch
        {
            // Not valid XML, skip fault detection
        }
    }

    private sealed class ScriptRequestState
    {
        public string Method { get; set; } = "GET";
        public string Url { get; set; } = "";
        public string? Body { get; set; }
        public string BodyType { get; set; } = "none";
        public List<KeyValuePairRequest> Headers { get; set; } = [];
        public List<KeyValuePairRequest> Params { get; set; } = [];
    }

    private sealed class ScriptResponseState
    {
        public int StatusCode { get; set; }
        public string StatusText { get; set; } = "";
        public string Body { get; set; } = "";
        public string ContentType { get; set; } = "";
        public Dictionary<string, string[]> Headers { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class ScriptExecutionResult
    {
        public bool Success { get; private init; }
        public string? ErrorMessage { get; private init; }
        public List<string> Logs { get; private init; } = [];

        public static ScriptExecutionResult CreateSuccess(List<string> logs)
        {
            return new ScriptExecutionResult
            {
                Success = true,
                Logs = logs
            };
        }

        public static ScriptExecutionResult CreateFailure(List<string> logs, string errorMessage)
        {
            return new ScriptExecutionResult
            {
                Success = false,
                ErrorMessage = errorMessage,
                Logs = logs
            };
        }
    }
}
