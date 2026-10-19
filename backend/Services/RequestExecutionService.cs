using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Jint;
using Jint.Native;
using Jint.Runtime;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

public class RequestExecutionService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly VariableResolutionService _variableService;
    private readonly IEnvironmentRepository _environmentRepo;
    private readonly IServiceRepository _serviceRepo;
    private readonly IServiceVariableRepository _serviceVariableRepo;
    private readonly IRequestRepository _requestRepo;
    private readonly IHistoryRepository _historyRepo;
    private readonly SettingsService _settings;
    private readonly ILogger<RequestExecutionService> _logger;
    private readonly RuntimeVariableStore _runtimeVariableStore;
    private readonly OAuthTokenService _oauthTokenService;
    private readonly CookieJarService _cookieJar;
    private readonly RequestUploadService _uploadService;

    public RequestExecutionService(
        IHttpClientFactory httpClientFactory,
        VariableResolutionService variableService,
        IEnvironmentRepository environmentRepo,
        IServiceRepository serviceRepo,
        IServiceVariableRepository serviceVariableRepo,
        IRequestRepository requestRepo,
        IHistoryRepository historyRepo,
        SettingsService settings,
        ILogger<RequestExecutionService> logger,
        RuntimeVariableStore runtimeVariableStore,
        OAuthTokenService oauthTokenService,
        CookieJarService cookieJar,
        RequestUploadService uploadService)
    {
        _httpClientFactory = httpClientFactory;
        _variableService = variableService;
        _environmentRepo = environmentRepo;
        _serviceRepo = serviceRepo;
        _serviceVariableRepo = serviceVariableRepo;
        _requestRepo = requestRepo;
        _historyRepo = historyRepo;
        _settings = settings;
        _logger = logger;
        _runtimeVariableStore = runtimeVariableStore;
        _oauthTokenService = oauthTokenService;
        _cookieJar = cookieJar;
        _uploadService = uploadService;
    }

    public async Task<ExecuteResponse> ExecuteAsync(ExecuteRequestPayload payload, CancellationToken cancellationToken, RequestExecutionContext? executionContext = null)
    {
        var workspaceId = payload.WorkspaceId ?? "default";
        var requestRuntimeVariables = executionContext != null ? new Dictionary<string, RuntimeScriptVariable>(StringComparer.OrdinalIgnoreCase) : _runtimeVariableStore.GetRequest(
            workspaceId,
            payload.RequestId);
        var serviceRuntimeVariables = executionContext?.ServiceVariables != null ? CloneRuntimeVariables(executionContext.ServiceVariables) : _runtimeVariableStore.GetService(
            workspaceId,
            payload.ServiceId);
        var runtimeVariables = MergeRuntimeVariables(
            serviceRuntimeVariables,
            requestRuntimeVariables);
        var serviceVariablesToPersist = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var serviceVariablesToDelete = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var scriptLogs = new List<string>();
        var stopwatch = Stopwatch.StartNew();
        var urlForDiagnostics = payload.Url ?? "";

        try
        {
            var requestVariables = BuildRequestVariableMap(payload.Variables);
            var resolutionSession = await _variableService.CreateSessionAsync(
                workspaceId,
                payload.ServiceId,
                requestVariables,
                runtimeVariables.ToDictionary(pair => pair.Key, pair => pair.Value.Value, StringComparer.OrdinalIgnoreCase),
                executionContext?.EnvironmentId ?? payload.EnvironmentId);

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
            var preScriptResult = ExecuteScript(
                script: preRequestScript,
                requestState: requestState,
                responseState: null,
                runtimeVariables: runtimeVariables,
                requestRuntimeVariables: requestRuntimeVariables,
                serviceRuntimeVariables: serviceRuntimeVariables,
                serviceVariablesToPersist: serviceVariablesToPersist,
                serviceVariablesToDelete: serviceVariablesToDelete,
                resolutionSession: resolutionSession,
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
                    ServiceScriptVariables = CloneRuntimeVariables(serviceRuntimeVariables),
                    ScriptLogs = scriptLogs
                };
            }

            var serviceDefaults = !string.IsNullOrWhiteSpace(payload.ServiceId)
                ? await _serviceRepo.GetByIdAsync(payload.ServiceId)
                : null;
            var mergedHeaders = MergeHeaders(serviceDefaults?.Headers ?? [], requestState.Headers);
            var effectiveAuth = ResolveEffectiveAuth(payload.Auth, serviceDefaults?.Auth);

            // Resolve variables
            var resolvedUrl = resolutionSession.Resolve(requestState.Url);
            urlForDiagnostics = resolvedUrl;
            var resolvedBody = requestState.Body != null
                ? resolutionSession.Resolve(requestState.Body)
                : null;

            // Build query string from params
            if (requestState.Params.Count > 0)
            {
                var enabledParams = requestState.Params.Where(p => p.Enabled);
                foreach (var p in enabledParams)
                {
                    var key = resolutionSession.Resolve(p.Key);
                    var value = resolutionSession.Resolve(p.Value);
                    resolvedUrl = RequestUrl.AppendQueryParameter(resolvedUrl, key, value);
                }
                urlForDiagnostics = resolvedUrl;
            }

            // Create HttpClient
            var requestSettings = !string.IsNullOrWhiteSpace(payload.RequestId)
                ? await _requestRepo.GetSettingsAsync(payload.RequestId)
                : null;
            var followRedirects = requestSettings?.FollowRedirects ?? _settings.FollowRedirects;
            var maxRedirects = Math.Clamp(
                requestSettings?.MaxRedirects is > 0 ? requestSettings.MaxRedirects : _settings.MaxRedirects,
                1,
                SettingsService.MaxAllowedRedirects);
            var ignoreSsl = payload.IgnoreSslErrors
                || _settings.IgnoreSslErrors
                || (requestSettings?.IgnoreSslErrors ?? false);
            var useProxy = false;
            Uri? proxyUri = null;
            var proxyUsername = "";
            var proxyPassword = "";
            var proxyMode = requestSettings?.ProxyMode?.Trim().ToLowerInvariant() ?? "inherit";
            if (proxyMode == "custom")
            {
                if (Uri.TryCreate(requestSettings?.ProxyUrl, UriKind.Absolute, out var customProxyUri))
                {
                    useProxy = true;
                    proxyUri = customProxyUri;
                    proxyUsername = requestSettings?.ProxyUsername ?? "";
                    proxyPassword = requestSettings?.ProxyPassword ?? "";
                }
            }
            else if (proxyMode != "disabled" && _settings.ProxyEnabled &&
                Uri.TryCreate(_settings.ProxyUrl, UriKind.Absolute, out var parsedProxyUri))
            {
                useProxy = true;
                proxyUri = parsedProxyUri;
                proxyUsername = _settings.ProxyUsername;
                proxyPassword = _settings.ProxyPassword;
            }

            var handler = new HttpClientHandler
            {
                AllowAutoRedirect = followRedirects,
                UseProxy = useProxy,
                AutomaticDecompression = DecompressionMethods.All,
                MaxAutomaticRedirections = maxRedirects,
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

            if (useProxy && proxyUri != null)
            {
                handler.UseProxy = true;
                handler.Proxy = new WebProxy(proxyUri);
                if (!string.IsNullOrWhiteSpace(proxyUsername))
                {
                    handler.Proxy.Credentials = new NetworkCredential(proxyUsername, proxyPassword);
                }
            }

            using var client = new HttpClient(handler);

            var timeout = requestSettings?.TimeoutSeconds is > 0
                ? TimeSpan.FromSeconds(requestSettings.TimeoutSeconds.Value)
                : _settings.RequestTimeoutMs > 0
                    ? TimeSpan.FromMilliseconds(_settings.RequestTimeoutMs)
                    : Timeout.InfiniteTimeSpan;

            using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            if (timeout != Timeout.InfiniteTimeSpan) timeoutSource.CancelAfter(timeout);
            var transportToken = timeoutSource.Token;
            client.Timeout = Timeout.InfiniteTimeSpan;

            // Build request
            var httpMethod = new HttpMethod((requestState.Method ?? payload.Method).ToUpperInvariant());
            using var request = new HttpRequestMessage(httpMethod, resolvedUrl);

            var resolvedHeaders = new List<KeyValuePairRequest>();

            // Apply headers
            foreach (var h in mergedHeaders.Where(h => h.Enabled))
            {
                var headerKey = resolutionSession.Resolve(h.Key);
                var headerValue = resolutionSession.Resolve(h.Value);
                resolvedHeaders.Add(new KeyValuePairRequest { Key = headerKey, Value = headerValue, Enabled = true });
                request.Headers.TryAddWithoutValidation(headerKey, headerValue);
            }

            // Apply auth
            if (effectiveAuth != null && effectiveAuth.AuthType != "none")
            {
                if (IsAuthType(effectiveAuth.AuthType, "oauth2"))
                {
                    var oauthConfig = JsonSerializer.Deserialize<OAuth2Configuration>(
                        resolutionSession.Resolve(effectiveAuth.ConfigJson),
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                        ?? throw new InvalidOperationException("OAuth configuration is invalid.");
                    var runtimeToken = !string.IsNullOrWhiteSpace(oauthConfig.AccessTokenVariable)
                        ? resolutionSession.GetVariable(oauthConfig.AccessTokenVariable)
                        : null;

                    if (!string.IsNullOrWhiteSpace(runtimeToken) && !ContainsUnresolvedVariable(runtimeToken))
                    {
                        request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {runtimeToken}");
                    }
                    else
                    {
                        var oauthOwnerKey = ResolveOAuthOwnerKey(payload);
                        var oauthToken = await _oauthTokenService.GetAccessTokenAsync(
                            oauthOwnerKey,
                            oauthConfig,
                            cancellationToken);
                        request.Headers.TryAddWithoutValidation(
                            "Authorization",
                            $"{oauthToken.TokenType} {oauthToken.Value}");
                    }
                }
                else
                {
                    ApplyAuth(request, effectiveAuth, resolutionSession);
                }
                if (request.RequestUri != null)
                {
                    resolvedUrl = request.RequestUri.ToString();
                    urlForDiagnostics = resolvedUrl;
                }

                foreach (var header in request.Headers)
                {
                    var materialized = new KeyValuePairRequest
                    {
                        Key = header.Key,
                        Value = string.Join(", ", header.Value),
                        Enabled = true
                    };
                    var existing = resolvedHeaders.FirstOrDefault(item =>
                        string.Equals(item.Key, materialized.Key, StringComparison.OrdinalIgnoreCase));
                    if (existing == null)
                    {
                        resolvedHeaders.Add(materialized);
                    }
                    else
                    {
                        existing.Value = materialized.Value;
                    }
                }
            }

            if (_settings.PersistCookies && request.RequestUri != null && !request.Headers.Contains("Cookie"))
            {
                var cookieHeader = _cookieJar.GetCookieHeader(workspaceId, request.RequestUri);
                if (!string.IsNullOrWhiteSpace(cookieHeader))
                {
                    request.Headers.TryAddWithoutValidation("Cookie", cookieHeader);
                    resolvedHeaders.Add(new KeyValuePairRequest
                    {
                        Key = "Cookie",
                        Value = cookieHeader,
                        Enabled = true,
                    });
                }
            }

            // Apply body
            if (resolvedBody != null && httpMethod != HttpMethod.Get && httpMethod != HttpMethod.Head)
            {
                if (IsMultipartBodyType(requestState.BodyType))
                {
                    request.Content = await BuildMultipartContentAsync(
                        requestState.Body ?? "",
                        resolutionSession,
                        cancellationToken);
                    request.Headers.Remove("Content-Type");
                    resolvedHeaders.RemoveAll(header =>
                        string.Equals(header.Key, "Content-Type", StringComparison.OrdinalIgnoreCase));
                    var multipartContentType = request.Content.Headers.ContentType?.ToString();
                    if (!string.IsNullOrWhiteSpace(multipartContentType))
                    {
                        resolvedHeaders.Add(new KeyValuePairRequest
                        {
                            Key = "Content-Type",
                            Value = multipartContentType,
                            Enabled = true,
                        });
                    }
                }
                else
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
            }

            var requestHeaderNames = request.Headers.Select(header => header.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var header in resolvedHeaders.Where(h => !requestHeaderNames.Contains(h.Key)))
            {
                request.Content ??= new ByteArrayContent([]);
                request.Content.Headers.Remove(header.Key);
                if (!request.Content.Headers.TryAddWithoutValidation(header.Key, header.Value))
                    throw new ArgumentException($"Invalid request header: {header.Key}");
            }

            // Keep transport timeout/cancellation active while consuming the streamed body.
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, transportToken);
            if (_settings.PersistCookies && request.RequestUri != null &&
                response.Headers.TryGetValues("Set-Cookie", out var setCookieHeaders))
            {
                var responseUri = response.RequestMessage?.RequestUri ?? request.RequestUri;
                _cookieJar.StoreResponseCookies(workspaceId, responseUri, setCookieHeaders);
            }
            var maxBodyBytes = checked(_settings.MaxResponseBodySizeMb * 1024 * 1024);
            var (responseBody, bodyTruncated, responseSize) = await ResponseBodyReader.ReadAsync(response, maxBodyBytes, transportToken);
            stopwatch.Stop();
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
                ResponseSizeBytes = responseSize,
                IsTruncated = bodyTruncated
            };

            var postRequestScript = await ResolvePostRequestScriptAsync(payload);
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
                requestRuntimeVariables: requestRuntimeVariables,
                serviceRuntimeVariables: serviceRuntimeVariables,
                serviceVariablesToPersist: serviceVariablesToPersist,
                serviceVariablesToDelete: serviceVariablesToDelete,
                resolutionSession: resolutionSession,
                sourceLabel: "Post-request script");

            scriptLogs.AddRange(postScriptResult.Logs);
            if (!postScriptResult.Success)
            {
                scriptLogs.Add($"Post-request script failed: {postScriptResult.ErrorMessage}");
            }

            await PersistServiceRuntimeVariablesAsync(
                workspaceId,
                payload.ServiceId,
                serviceRuntimeVariables,
                serviceVariablesToPersist,
                serviceVariablesToDelete);

            if (executionContext == null)
            {
            _runtimeVariableStore.SetRequest(
                workspaceId,
                payload.RequestId,
                requestRuntimeVariables);
            _runtimeVariableStore.SetService(
                workspaceId,
                payload.ServiceId,
                serviceRuntimeVariables);
            }
            else executionContext.ServiceVariables = CloneRuntimeVariables(serviceRuntimeVariables);
            result.ScriptVariables = CloneRuntimeVariables(runtimeVariables);
            result.ServiceScriptVariables = CloneRuntimeVariables(serviceRuntimeVariables);
            result.ScriptLogs = scriptLogs;

            var testScript = await ResolveTestScriptAsync(payload);
            result.TestResults = TestScriptRunner.Run(testScript, result, resolutionSession.ToDictionary());

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
                    RequestHeadersJson = JsonSerializer.Serialize(resolvedHeaders),
                    RequestBody = resolvedBody,
                    ResponseStatus = result.StatusCode,
                    StatusText = result.StatusText,
                    ResponseHeadersJson = JsonSerializer.Serialize(responseHeaders),
                    ResponseBody = responseBody,
                    ContentType = result.ContentType,
                    ResponseTimeMs = result.ResponseTimeMs,
                    ResponseSizeBytes = result.ResponseSizeBytes,
                    IsTruncated = result.IsTruncated,
                    Error = result.Error,
                    IsSoapFault = result.IsSoapFault,
                    SoapFault = result.SoapFault,
                    ScriptVariables = result.ScriptVariables,
                    ServiceScriptVariables = result.ServiceScriptVariables,
                    ScriptLogs = result.ScriptLogs,
                    TestResults = result.TestResults,
                });
            }

            return result;
        }
        catch (OperationCanceledException)
        {
            stopwatch.Stop();
            return new ExecuteResponse
            {
                StatusCode = 0,
                StatusText = cancellationToken.IsCancellationRequested ? "Cancelled" : "Timeout",
                Error = cancellationToken.IsCancellationRequested ? "Request was cancelled" : "Request timed out",
                ResponseTimeMs = stopwatch.ElapsedMilliseconds,
                ScriptVariables = CloneRuntimeVariables(runtimeVariables),
                ServiceScriptVariables = CloneRuntimeVariables(serviceRuntimeVariables),
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
                ServiceScriptVariables = CloneRuntimeVariables(serviceRuntimeVariables),
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
        Dictionary<string, RuntimeScriptVariable> requestRuntimeVariables,
        Dictionary<string, RuntimeScriptVariable> serviceRuntimeVariables,
        HashSet<string> serviceVariablesToPersist,
        HashSet<string> serviceVariablesToDelete,
        TemplateResolutionSession resolutionSession,
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
            var availableVariables = resolutionSession.ToDictionary();
            var requestObject = new Dictionary<string, object?>
            {
                ["method"] = requestState.Method,
                ["url"] = requestState.Url,
                ["body"] = requestState.Body,
                ["bodyType"] = requestState.BodyType
            };

            engine.SetValue("setVar", new Action<string, object?>((key, value) =>
            {
                var normalizedKey = key?.Trim();
                if (string.IsNullOrWhiteSpace(normalizedKey)) return;

                var normalizedValue = value?.ToString() ?? "";
                var runtimeVariable = new RuntimeScriptVariable
                {
                    Value = normalizedValue,
                    Source = sourceLabel,
                    Scope = "request"
                };
                requestRuntimeVariables[normalizedKey] = runtimeVariable;
                runtimeVariables[normalizedKey] = runtimeVariable;
                resolutionSession.SetVariable(normalizedKey, normalizedValue);
                RefreshAvailableVariables(availableVariables, resolutionSession);
            }));

            engine.SetValue("setServiceVar", new Action<string, object?, object?>((key, value, persist) =>
            {
                var normalizedKey = key?.Trim();
                if (string.IsNullOrWhiteSpace(normalizedKey)) return;

                var normalizedValue = value?.ToString() ?? "";
                var shouldPersist = ReadScriptBoolean(persist);
                var runtimeVariable = new RuntimeScriptVariable
                {
                    Value = normalizedValue,
                    Source = sourceLabel,
                    Scope = "service"
                };
                serviceRuntimeVariables[normalizedKey] = runtimeVariable;
                if (shouldPersist)
                    serviceVariablesToPersist.Add(normalizedKey);
                else
                    serviceVariablesToPersist.Remove(normalizedKey);
                serviceVariablesToDelete.Remove(normalizedKey);
                if (!requestRuntimeVariables.ContainsKey(normalizedKey))
                {
                    runtimeVariables[normalizedKey] = runtimeVariable;
                    resolutionSession.SetVariable(normalizedKey, normalizedValue);
                }
                RefreshAvailableVariables(availableVariables, resolutionSession);
            }));

            engine.SetValue("getVar", new Func<string, string?>((key) =>
            {
                var normalizedKey = key?.Trim();
                if (string.IsNullOrWhiteSpace(normalizedKey)) return null;

                return resolutionSession.GetVariable(normalizedKey);
            }));

            engine.SetValue("unsetVar", new Action<string>((key) =>
            {
                var normalizedKey = key?.Trim();
                if (string.IsNullOrWhiteSpace(normalizedKey)) return;

                requestRuntimeVariables.Remove(normalizedKey);
                if (serviceRuntimeVariables.TryGetValue(normalizedKey, out var serviceVariable))
                {
                    runtimeVariables[normalizedKey] = serviceVariable;
                    resolutionSession.SetVariable(normalizedKey, serviceVariable.Value);
                }
                else
                {
                    runtimeVariables.Remove(normalizedKey);
                    resolutionSession.UnsetVariable(normalizedKey);
                }
                RefreshAvailableVariables(availableVariables, resolutionSession);
            }));

            engine.SetValue("unsetServiceVar", new Action<string>((key) =>
            {
                var normalizedKey = key?.Trim();
                if (string.IsNullOrWhiteSpace(normalizedKey)) return;

                serviceRuntimeVariables.Remove(normalizedKey);
                serviceVariablesToPersist.Remove(normalizedKey);
                serviceVariablesToDelete.Add(normalizedKey);
                if (requestRuntimeVariables.TryGetValue(normalizedKey, out var requestVariable))
                {
                    runtimeVariables[normalizedKey] = requestVariable;
                    resolutionSession.SetVariable(normalizedKey, requestVariable.Value);
                }
                else
                {
                    runtimeVariables.Remove(normalizedKey);
                    resolutionSession.UnsetVariable(normalizedKey);
                }
                RefreshAvailableVariables(availableVariables, resolutionSession);
            }));

            engine.SetValue("setUrl", new Action<string>((url) =>
            {
                requestState.Url = url ?? "";
                requestObject["url"] = requestState.Url;
            }));
            engine.SetValue("getUrl", new Func<string>(() => requestState.Url));

            engine.SetValue("setMethod", new Action<string>((method) =>
            {
                if (!string.IsNullOrWhiteSpace(method))
                {
                    requestState.Method = method.Trim().ToUpperInvariant();
                    requestObject["method"] = requestState.Method;
                }
            }));
            engine.SetValue("getMethod", new Func<string>(() => requestState.Method));

            engine.SetValue("setBody", new Action<JsValue>((body) =>
            {
                if (body == JsValue.Null || body == JsValue.Undefined)
                {
                    requestState.Body = null;
                }
                else if (body.Type == Types.String)
                {
                    requestState.Body = body.ToObject()?.ToString() ?? "";
                }
                else
                {
                    var stringify = engine.GetValue("JSON").AsObject().Get("stringify");
                    var serialized = engine.Invoke(stringify, new object[] { body }).ToObject()?.ToString();
                    if (serialized == null)
                    {
                        throw new InvalidOperationException("setBody could not serialize the supplied value");
                    }

                    requestState.Body = serialized;
                    requestState.BodyType = "json";
                }

                requestObject["body"] = requestState.Body;
                requestObject["bodyType"] = requestState.BodyType;
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

            engine.SetValue("vars", availableVariables);
            engine.SetValue("request", requestObject);

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
                    ["status"] = responseState.StatusCode,
                    ["statusCode"] = responseState.StatusCode,
                    ["statusText"] = responseState.StatusText,
                    ["body"] = responseState.Body,
                    ["contentType"] = responseState.ContentType,
                    ["headers"] = responseState.Headers.ToDictionary(
                        header => header.Key,
                        header => (object)string.Join(", ", header.Value),
                        StringComparer.OrdinalIgnoreCase)
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

    private async Task<HttpContent> BuildMultipartContentAsync(
        string body,
        TemplateResolutionSession resolutionSession,
        CancellationToken cancellationToken)
    {
        MultipartFormBody? multipart;
        try
        {
            multipart = JsonSerializer.Deserialize<MultipartFormBody>(body, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"Multipart body is not valid JSON: {ex.Message}", ex);
        }

        if (multipart == null)
            throw new InvalidOperationException("Multipart body is invalid.");

        var content = new MultipartFormDataContent();
        try
        {
            foreach (var field in multipart.Fields.Where(field => field.Enabled))
            {
                var name = resolutionSession.Resolve(field.Name).Trim();
                if (string.IsNullOrWhiteSpace(name)) continue;

                if (string.Equals(field.Kind, "file", StringComparison.OrdinalIgnoreCase))
                {
                    var path = _uploadService.ResolvePath(resolutionSession.Resolve(field.FilePath));
                    if (!File.Exists(path))
                        throw new InvalidOperationException($"Multipart file was not found: {field.FileName}");

                    var fileContent = new StreamContent(File.OpenRead(path));
                    if (MediaTypeHeaderValue.TryParse(field.ContentType, out var mediaType))
                    {
                        fileContent.Headers.ContentType = mediaType;
                    }

                    var fileName = resolutionSession.Resolve(field.FileName).Trim();
                    if (string.IsNullOrWhiteSpace(fileName)) fileName = Path.GetFileName(path);
                    content.Add(fileContent, name, fileName);
                }
                else
                {
                    var valueContent = new StringContent(resolutionSession.Resolve(field.Value), Encoding.UTF8);
                    content.Add(valueContent, name);
                }
            }

            cancellationToken.ThrowIfCancellationRequested();
            await Task.CompletedTask;
            return content;
        }
        catch
        {
            content.Dispose();
            throw;
        }
    }

    private static bool IsMultipartBodyType(string? bodyType) =>
        string.Equals(bodyType, "multipart", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(bodyType, "multipart/form-data", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(bodyType, "formdata", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(bodyType, "form-data", StringComparison.OrdinalIgnoreCase);

    private static void RefreshAvailableVariables(
        Dictionary<string, string> availableVariables,
        TemplateResolutionSession resolutionSession)
    {
        availableVariables.Clear();
        foreach (var (key, value) in resolutionSession.ToDictionary())
            availableVariables[key] = value;
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

    private static Dictionary<string, RuntimeScriptVariable> CloneRuntimeVariables(
        Dictionary<string, RuntimeScriptVariable> runtimeVariables)
    {
        return runtimeVariables.ToDictionary(
            pair => pair.Key,
            pair => new RuntimeScriptVariable
            {
                Value = pair.Value.Value,
                Source = pair.Value.Source,
                Scope = pair.Value.Scope
            },
            StringComparer.OrdinalIgnoreCase);
    }

    private static Dictionary<string, RuntimeScriptVariable> MergeRuntimeVariables(
        Dictionary<string, RuntimeScriptVariable> serviceRuntimeVariables,
        Dictionary<string, RuntimeScriptVariable> requestRuntimeVariables)
    {
        var merged = CloneRuntimeVariables(serviceRuntimeVariables);
        foreach (var (key, value) in requestRuntimeVariables)
            merged[key] = value;

        return merged;
    }

    private async Task PersistServiceRuntimeVariablesAsync(
        string workspaceId,
        string? serviceId,
        Dictionary<string, RuntimeScriptVariable> serviceRuntimeVariables,
        HashSet<string> serviceVariablesToPersist,
        HashSet<string> serviceVariablesToDelete)
    {
        if (string.IsNullOrWhiteSpace(serviceId))
            return;

        try
        {
            var activeEnvironmentId = (await _environmentRepo.GetByWorkspaceAsync(workspaceId))
                .FirstOrDefault(environment => environment.IsActive)?.Id;
            var persistedVariables = (await _serviceVariableRepo.GetByServiceAsync(serviceId)).ToList();

            foreach (var key in serviceVariablesToDelete)
            {
                var existing = FindServiceVariable(persistedVariables, key, activeEnvironmentId);
                if (existing != null)
                {
                    await _serviceVariableRepo.DeleteAsync(existing.Id);
                    persistedVariables.Remove(existing);
                }
            }

            foreach (var key in serviceVariablesToPersist)
            {
                if (!serviceRuntimeVariables.TryGetValue(key, out var runtimeVariable))
                    continue;

                var existing = FindServiceVariable(persistedVariables, key, activeEnvironmentId);
                var environmentId = existing?.EnvironmentId ?? activeEnvironmentId;
                var saved = await _serviceVariableRepo.UpsertAsync(
                    serviceId,
                    existing?.Id,
                    key,
                    runtimeVariable.Value,
                    existing?.IsSecret == true || IsSensitiveServiceVariable(key),
                    true,
                    environmentId);

                if (existing == null)
                    persistedVariables.Add(saved);
                else
                {
                    var index = persistedVariables.IndexOf(existing);
                    persistedVariables[index] = saved;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to persist service runtime variables for service {ServiceId}", serviceId);
        }
    }

    private static ServiceVariable? FindServiceVariable(
        IEnumerable<ServiceVariable> variables,
        string key,
        string? activeEnvironmentId)
    {
        return variables.FirstOrDefault(variable =>
                   variable.Key.Equals(key, StringComparison.OrdinalIgnoreCase) &&
                   variable.EnvironmentId == activeEnvironmentId)
            ?? variables.FirstOrDefault(variable =>
                variable.Key.Equals(key, StringComparison.OrdinalIgnoreCase) &&
                variable.EnvironmentId == null);
    }

    private static bool IsSensitiveServiceVariable(string key)
    {
        return key.Contains("token", StringComparison.OrdinalIgnoreCase)
            || key.Contains("secret", StringComparison.OrdinalIgnoreCase)
            || key.Contains("password", StringComparison.OrdinalIgnoreCase)
            || key.Contains("code", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ReadScriptBoolean(object? value)
    {
        return value switch
        {
            bool booleanValue => booleanValue,
            JsValue jsValue when jsValue.Type == Types.Boolean => jsValue.AsBoolean(),
            string stringValue when bool.TryParse(stringValue, out var booleanValue) => booleanValue,
            _ => false,
        };
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

    private static bool ContainsUnresolvedVariable(string value)
    {
        return value.Contains("{{", StringComparison.Ordinal) &&
            value.Contains("}}", StringComparison.Ordinal);
    }

    private static string ResolveOAuthOwnerKey(ExecuteRequestPayload payload)
    {
        var requestAuthIsExplicit = payload.Auth != null &&
            !IsAuthType(payload.Auth.AuthType, "inherit");

        if (requestAuthIsExplicit && !string.IsNullOrWhiteSpace(payload.RequestId))
            return $"request:{payload.RequestId}";

        if (!string.IsNullOrWhiteSpace(payload.ServiceId))
            return $"service:{payload.ServiceId}";

        if (!string.IsNullOrWhiteSpace(payload.RequestId))
            return $"request:{payload.RequestId}";

        throw new InvalidOperationException("OAuth authentication requires a saved request or service.");
    }

    private static void ApplyAuth(
        HttpRequestMessage request,
        AuthRequest auth,
        TemplateResolutionSession resolutionSession)
    {
        var config = JsonSerializer.Deserialize<JsonElement>(auth.ConfigJson);

        switch ((auth.AuthType ?? "").Trim().ToLowerInvariant())
        {
            case "basic":
                var username = resolutionSession.Resolve(config.GetProperty("username").GetString() ?? "");
                var password = resolutionSession.Resolve(config.GetProperty("password").GetString() ?? "");
                var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{username}:{password}"));
                request.Headers.TryAddWithoutValidation("Authorization", $"Basic {encoded}");
                break;

            case "bearer":
                var token = resolutionSession.Resolve(config.GetProperty("token").GetString() ?? "");
                if (!string.IsNullOrWhiteSpace(token) && !ContainsUnresolvedVariable(token))
                {
                    request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
                }
                break;

            case "apikey":
                var keyName = resolutionSession.Resolve(config.GetProperty("key").GetString() ?? "");
                var keyValue = resolutionSession.Resolve(config.GetProperty("value").GetString() ?? "");
                var location = resolutionSession.Resolve(config.GetProperty("in").GetString() ?? "header");
                if (string.Equals(location, "header", StringComparison.OrdinalIgnoreCase))
                {
                    request.Headers.TryAddWithoutValidation(keyName, keyValue);
                }
                else if (string.Equals(location, "query", StringComparison.OrdinalIgnoreCase) && request.RequestUri != null)
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
