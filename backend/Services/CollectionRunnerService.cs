using System.Diagnostics;
using System.Text.Json;
using Jint;
using Jint.Native;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

/// <summary>
/// Runs test scripts and executes collections (all requests in a service).
/// </summary>
public class CollectionRunnerService
{
    private readonly RequestExecutionService _executionService;
    private readonly IRequestRepository _requestRepo;
    private readonly IServiceRepository _serviceRepo;
    private readonly ILogger<CollectionRunnerService> _logger;

    public CollectionRunnerService(
        RequestExecutionService executionService,
        IRequestRepository requestRepo,
        IServiceRepository serviceRepo,
        ILogger<CollectionRunnerService> logger)
    {
        _executionService = executionService;
        _requestRepo = requestRepo;
        _serviceRepo = serviceRepo;
        _logger = logger;
    }

    /// <summary>
    /// Run all requests in a service sequentially, chaining variables and executing tests.
    /// </summary>
    public async Task<CollectionRunResult> RunServiceAsync(
        string serviceId, string? environmentId, bool stopOnFailure, CancellationToken cancellationToken)
    {
        var service = await _serviceRepo.GetByIdAsync(serviceId)
            ?? throw new InvalidOperationException("Service not found");
        var requests = await _requestRepo.GetByServiceIdAsync(serviceId);
        return await RunRequestsAsync(service, requests, null, environmentId, stopOnFailure, cancellationToken);
    }

    /// <summary>Run only the requests assigned to a folder.</summary>
    public async Task<CollectionRunResult> RunFolderAsync(
        string serviceId, string folderId, string? environmentId, bool stopOnFailure, CancellationToken cancellationToken)
    {
        var service = await _serviceRepo.GetByIdAsync(serviceId)
            ?? throw new InvalidOperationException("Service not found");
        var folder = service.Folders.FirstOrDefault(item => item.Id == folderId)
            ?? throw new InvalidOperationException("Folder not found");
        var requests = (await _requestRepo.GetByServiceIdAsync(serviceId))
            .Where(request => string.Equals(request.FolderId, folderId, StringComparison.Ordinal))
            .ToList();

        return await RunRequestsAsync(service, requests, folder, environmentId, stopOnFailure, cancellationToken);
    }

    private async Task<CollectionRunResult> RunRequestsAsync(
        Service service,
        IReadOnlyList<ApiRequest> requests,
        RequestFolder? folder,
        string? environmentId,
        bool stopOnFailure,
        CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();
        var result = new CollectionRunResult
        {
            ServiceId = service.Id,
            ServiceName = service.Name,
            FolderId = folder?.Id,
            FolderName = folder?.Name,
            TotalRequests = requests.Count,
            Results = []
        };

        // Chained variables across requests
        var chainedVariables = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var req in requests)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var requestResult = new CollectionRequestResult
            {
                RequestId = req.Id,
                RequestName = req.Name,
                Method = req.Method,
                Url = req.Url,
                Passed = true
            };

            try
            {
                var payload = BuildPayload(req, service.WorkspaceId, chainedVariables);
                var response = await _executionService.ExecuteAsync(payload, cancellationToken);

                requestResult.StatusCode = response.StatusCode;
                requestResult.ResponseTimeMs = response.ResponseTimeMs;

                if (response.Error != null)
                {
                    requestResult.Error = response.Error;
                    requestResult.Passed = false;
                }

                if (response.ScriptVariables != null)
                {
                    foreach (var (key, variable) in response.ScriptVariables)
                        chainedVariables[key] = variable.Value;
                }

                if (!string.IsNullOrWhiteSpace(req.TestScript) && string.IsNullOrWhiteSpace(response.Error))
                {
                    var tests = RunTests(req.TestScript, response, chainedVariables);
                    requestResult.Tests = tests;
                    if (tests.Any(t => !t.Passed))
                        requestResult.Passed = false;
                }

                if (requestResult.Passed)
                    result.PassedRequests++;
                else
                    result.FailedRequests++;
            }
            catch (Exception ex)
            {
                requestResult.Error = ex.Message;
                requestResult.Passed = false;
                result.FailedRequests++;
            }

            result.Results.Add(requestResult);

            if (stopOnFailure && !requestResult.Passed)
                break;
        }

        sw.Stop();
        result.TotalTimeMs = sw.ElapsedMilliseconds;
        return result;
    }

    /// <summary>
    /// Run only the test script for a request against a given response.
    /// </summary>
    public static List<TestResult> RunTests(string testScript, ExecuteResponse response, Dictionary<string, string>? variables = null)
    {
        return TestScriptRunner.Run(testScript, response, variables);
    }

    private static ExecuteRequestPayload BuildPayload(ApiRequest req, string workspaceId, Dictionary<string, string> chainedVars)
    {
        // Inject chained variables into request variable values
        var variables = req.Variables.Where(v => v.Enabled).Select(v =>
        {
            var value = v.Value;
            if (chainedVars.TryGetValue(v.Key, out var cv))
                value = cv;
            return new RequestVariableRequest { Key = v.Key, Value = value, Enabled = v.Enabled };
        }).ToList();

        return new ExecuteRequestPayload
        {
            Method = req.Method,
            Url = req.Url,
            Body = req.Body,
            BodyType = req.BodyType,
            PreRequestScript = req.PreRequestScript,
            PostRequestScript = req.PostRequestScript,
            TestScript = req.TestScript,
            Headers = req.Headers.Select(h => new KeyValuePairRequest { Key = h.Key, Value = h.Value, Enabled = h.Enabled }).ToList(),
            Params = req.Params.Select(p => new KeyValuePairRequest { Key = p.Key, Value = p.Value, Enabled = p.Enabled }).ToList(),
            Variables = variables,
            Auth = req.Auth != null ? new AuthRequest { AuthType = req.Auth.AuthType, ConfigJson = req.Auth.ConfigJson } : null,
            WorkspaceId = workspaceId,
            ServiceId = req.ServiceId,
            RequestId = req.Id,
        };
    }
}
