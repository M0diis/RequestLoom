using System.Text.Json;
using RequestLoom.Api.Data;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

/// <summary>
/// Generates a rich example workspace ("Sandbox") with services, requests,
/// variables, mock servers, and environments covering all major features.
/// Also provides a method to clear all user data.
/// </summary>
public class ExampleDataService
{
    private readonly IWorkspaceRepository _workspaceRepo;
    private readonly IEnvironmentRepository _envRepo;
    private readonly IServiceRepository _serviceRepo;
    private readonly IServiceVariableRepository _svcVarRepo;
    private readonly IRequestRepository _requestRepo;
    private readonly IWorkspaceVariableRepository _wsVarRepo;
    private readonly IMockServerRepository _mockRepo;
    private readonly IHistoryRepository _historyRepo;
    private readonly AppDbContext? _db;
    private readonly JsonDataStore? _jsonStore;
    private readonly SettingsService _settings;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ExampleDataService> _logger;

    public ExampleDataService(
        IWorkspaceRepository workspaceRepo,
        IEnvironmentRepository envRepo,
        IServiceRepository serviceRepo,
        IServiceVariableRepository svcVarRepo,
        IRequestRepository requestRepo,
        IWorkspaceVariableRepository wsVarRepo,
        IMockServerRepository mockRepo,
        IHistoryRepository historyRepo,
        SettingsService settings,
        IConfiguration configuration,
        IServiceProvider sp,
        ILogger<ExampleDataService> logger)
    {
        _workspaceRepo = workspaceRepo;
        _envRepo = envRepo;
        _serviceRepo = serviceRepo;
        _svcVarRepo = svcVarRepo;
        _requestRepo = requestRepo;
        _wsVarRepo = wsVarRepo;
        _mockRepo = mockRepo;
        _historyRepo = historyRepo;
        _settings = settings;
        _configuration = configuration;
        _logger = logger;

        if (_settings.UseJson)
            _jsonStore = sp.GetRequiredService<JsonDataStore>();
        else
            _db = sp.GetRequiredService<AppDbContext>();
    }

    /// <summary>
    /// Generates the "Sandbox" workspace with example data and returns its ID.
    /// </summary>
    public async Task<string> GenerateExamplesAsync()
    {
        var existingSandbox = (await _workspaceRepo.GetAllAsync())
            .Where(workspace => string.Equals(workspace.Name, "Sandbox", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(workspace => workspace.CreatedAt)
            .FirstOrDefault();

        if (existingSandbox != null)
        {
            var services = await _serviceRepo.GetByWorkspaceAsync(existingSandbox.Id);
            var mockServers = await _mockRepo.GetByWorkspaceAsync(existingSandbox.Id);
            if (services.Count() >= 3 && mockServers.Count() >= 3)
            {
                await RepairSandboxMockUrlsAsync(existingSandbox.Id, services, mockServers);
                _logger.LogInformation("Sandbox example data already exists: workspace={WorkspaceId}", existingSandbox.Id);
                return existingSandbox.Id;
            }
        }

        _logger.LogInformation("Generating example data in Sandbox workspace...");

        // 1. Create workspace (repository auto-seeds DEV / STG / PRD environments)
        var workspace = await _workspaceRepo.CreateAsync("Sandbox");
        var workspaceId = workspace.Id;

        // 2. Grab the auto-created environments (DEV is already active)
        var envs = (await _envRepo.GetByWorkspaceAsync(workspaceId)).ToList();
        var envDev = envs.First(e => e.Name == "DEV");
        var envStg = envs.First(e => e.Name == "STG");
        var envPrd = envs.First(e => e.Name == "PRD");

        // 3. Workspace variables (environment-scoped)
        var wsVars = new (string key, string devVal, string stgVal, string prdVal, bool secret)[]
        {
            ("api_version", "v1", "v1", "v1", false),
            ("api_token", "dev-secret-token-12345", "stg-secret-token-67890", "{{PRD_TOKEN_PLACEHOLDER}}", true),
            ("pagination_limit", "20", "50", "100", false),
            ("feature_flags", "debug,verbose", "verbose", "none", false),
        };

        foreach (var (key, devVal, stgVal, prdVal, secret) in wsVars)
        {
            await _wsVarRepo.UpsertAsync(workspaceId, null, key, devVal, secret, true, envDev.Id);
            await _wsVarRepo.UpsertAsync(workspaceId, null, key, stgVal, secret, true, envStg.Id);
            await _wsVarRepo.UpsertAsync(workspaceId, null, key, prdVal, secret, true, envPrd.Id);
        }

        // Also a global (non-environment) workspace variable
        await _wsVarRepo.UpsertAsync(workspaceId, null, "app_name", "RequestLoom Sandbox", false, true, null);

        // 4. Create Services with requests and mock servers
        var usersService = await CreateUsersExample(workspaceId, envDev.Id, envStg.Id, envPrd.Id);
        var postsService = await CreatePostsExample(workspaceId, envDev.Id);
        var authService = await CreateAuthExample(workspaceId, envDev.Id);

        _logger.LogInformation("Example data generated: workspace={WorkspaceId}, services=3, mockServers=3", workspaceId);

        return workspaceId;
    }

    private async Task<Service> CreateUsersExample(string workspaceId, string devEnvId, string stgEnvId, string prdEnvId)
    {
        var mockSlug = await GetAvailableMockSlugAsync("sandbox-users");
        // Mock servers are accessed via the app's /mock/{slug} middleware, not a separate port
        var baseUrl = GetMockBaseUrl(mockSlug);

        // Mock server
        var mockServer = await _mockRepo.CreateAsync(workspaceId,
            "Sandbox Users Mock",
            $"Mock server for the Users API example. Returns realistic user data. Accessed at /mock/{mockSlug}",
            mockSlug, 0);

        // Mock endpoints — static list and create, dynamic for parameterized ones
        var usersJson = JsonSerializer.Serialize(new[]
        {
            new { id = 1, name = "Jane Doe", email = "jane@example.com", role = "admin" },
            new { id = 2, name = "John Smith", email = "john@example.com", role = "user" },
            new { id = 3, name = "Alice Johnson", email = "alice@example.com", role = "user" },
        });

        var createResponse = JsonSerializer.Serialize(new { id = 4, name = "New User", email = "new@example.com", role = "user", created_at = "2026-08-11T12:00:00Z" });

        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "GET", Path = "/api/users",
            StatusCode = 200, ContentType = "application/json",
            ResponseBody = usersJson, DelayMs = 50
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "GET", Path = "/api/users/{id}",
            StatusCode = 200, ContentType = "application/json",
            ResponseBody = "{}", DelayMs = 30,
            ScriptEnabled = true,
            Script = @"// Return a single user by ID — responds dynamically to the {id} path param
var id = request.pathParams['id'] || '1';
var users = {
    '1': { id: 1, name: 'Jane Doe', email: 'jane@example.com', role: 'admin', created_at: '2026-01-15T10:30:00Z' },
    '2': { id: 2, name: 'John Smith', email: 'john@example.com', role: 'user', created_at: '2026-02-20T14:00:00Z' },
    '3': { id: 3, name: 'Alice Johnson', email: 'alice@example.com', role: 'user', created_at: '2026-03-10T09:15:00Z' }
};
var user = users[id];
if (!user) {
    response.statusCode = 404;
    response.body = JSON.stringify({ error: 'User not found', id: parseInt(id) });
} else {
    response.statusCode = 200;
    response.body = JSON.stringify(user);
}"
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "POST", Path = "/api/users",
            StatusCode = 201, ContentType = "application/json",
            ResponseBody = createResponse, DelayMs = 100
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "PUT", Path = "/api/users/{id}",
            StatusCode = 200, ContentType = "application/json",
            ResponseBody = "{}", DelayMs = 80,
            ScriptEnabled = true,
            Script = @"// Return the updated user — reflects the ID and request body
var id = request.pathParams['id'] || '0';
var body = {};
try { body = JSON.parse(request.body || '{}'); } catch(e) {}
response.body = JSON.stringify({
    id: parseInt(id),
    name: body.name || 'Updated User',
    email: body.email || 'updated@example.com',
    role: body.role || 'user',
    updated_at: new Date().toISOString()
});"
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "DELETE", Path = "/api/users/{id}",
            StatusCode = 204, ContentType = "application/json",
            ResponseBody = "", DelayMs = 60,
            ScriptEnabled = true,
            Script = @"// Confirm deletion of the specified user
var id = request.pathParams['id'] || '0';
if (parseInt(id) > 100) {
    response.statusCode = 404;
    response.body = JSON.stringify({ error: 'User not found', id: parseInt(id) });
} else {
    response.statusCode = 204;
    response.body = '';
}"
        });

        // Service
        var service = await _serviceRepo.CreateAsync(workspaceId,
            "Users API",
            "Manage users - list, get, create, update, and delete. Demonstrates RESTful CRUD with path parameters, environment-scoped variables, and mock server integration.",
            new List<KeyValuePairRequest> { new() { Key = "Accept", Value = "application/json", Enabled = true } },
            null);

        // Service variables (environment-scoped) — mock URL changes per environment
        await _svcVarRepo.UpsertAsync(service.Id, null, "base_url", baseUrl, false, true, devEnvId);
        await _svcVarRepo.UpsertAsync(service.Id, null, "base_url", baseUrl, false, true, stgEnvId);
        await _svcVarRepo.UpsertAsync(service.Id, null, "base_url", "https://api.example.com", false, true, prdEnvId);

        // Requests
        var r1 = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "List All Users", Method = "GET",
            Url = $"{{{{base_url}}}}/api/users?limit={{{{pagination_limit}}}}",
            Body = null, BodyType = "none"
        });
        await _requestRepo.UpdateAsync(r1.Id, new UpdateApiRequestRequest
        {
            Name = "List All Users", Method = "GET",
            Url = $"{{{{base_url}}}}/api/users?limit={{{{pagination_limit}}}}",
            Body = null, BodyType = "none",
            Headers = new List<KeyValuePairRequest> { new() { Key = "X-API-Version", Value = "{{api_version}}", Enabled = true } },
            Params = new List<KeyValuePairRequest>(),
            Variables = new List<RequestVariableRequest> { new() { Key = "pagination_limit", Value = "10", Enabled = true } },
            Auth = null,
            TestScript = @"// Verify the response is a valid user array
test('Status is 200', () => {
    expect(response.status).toBe(200);
});
test('Content type is JSON', () => {
    expect(response.contentType).toContain('application/json');
});
test('Body is a non-empty array', () => {
    const json = JSON.parse(response.body);
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
});"
        });

        var r2 = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "Get User by ID", Method = "GET",
            Url = "{{base_url}}/api/users/{{user_id}}",
            Body = null, BodyType = "none"
        });
        await _requestRepo.UpdateAsync(r2.Id, new UpdateApiRequestRequest
        {
            Name = "Get User by ID", Method = "GET",
            Url = "{{base_url}}/api/users/{{user_id}}",
            Body = null, BodyType = "none",
            Headers = new List<KeyValuePairRequest>(),
            Params = new List<KeyValuePairRequest>(),
            Variables = new List<RequestVariableRequest> { new() { Key = "user_id", Value = "1", Enabled = true } },
            Auth = null,
            TestScript = @"test('Status is 200', () => {
    expect(response.status).toBe(200);
});
test('User has required fields', () => {
    const user = JSON.parse(response.body);
    expect(user.hasOwnProperty('id')).toBe(true);
    expect(typeof user.name).toBe('string');
    expect(user.name.length).toBeGreaterThan(0);
    expect(typeof user.email).toBe('string');
    expect(user.email).toContain('@');
});"
        });

        var r3 = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "Create User", Method = "POST",
            Url = "{{base_url}}/api/users",
            Body = JsonSerializer.Serialize(new { name = "New User", email = "new@example.com", role = "user" }),
            BodyType = "json"
        });
        await _requestRepo.UpdateAsync(r3.Id, new UpdateApiRequestRequest
        {
            Name = "Create User", Method = "POST",
            Url = "{{base_url}}/api/users",
            Body = JsonSerializer.Serialize(new { name = "New User", email = "new@example.com", role = "user" }),
            BodyType = "json",
            Headers = new List<KeyValuePairRequest> { new() { Key = "Content-Type", Value = "application/json", Enabled = true } },
            Params = new List<KeyValuePairRequest>(),
            Variables = new List<RequestVariableRequest>(),
            Auth = null,
            PreRequestScript = @"// Tag the request with a timestamp
const iso = new Date().toISOString();
setVar('requested_at', iso);
log('Sending create user request @ ' + iso);
// Set a custom header for idempotency
setHeader('X-Idempotency-Key', 'create-user-' + Date.now());",
            TestScript = @"test('Status is 201 Created', () => {
    expect(response.status).toBe(201);
});
test('Response contains created user', () => {
    const user = JSON.parse(response.body);
    expect(user.name).toBe('New User');
    expect(typeof user.id).toBe('number');
});"
        });

        var r4 = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "Update User", Method = "PUT",
            Url = "{{base_url}}/api/users/{{user_id}}",
            Body = JsonSerializer.Serialize(new { name = "Jane Doe Updated", email = "jane.updated@example.com", role = "admin" }),
            BodyType = "json"
        });
        await _requestRepo.UpdateAsync(r4.Id, new UpdateApiRequestRequest
        {
            Name = "Update User", Method = "PUT",
            Url = "{{base_url}}/api/users/{{user_id}}",
            Body = JsonSerializer.Serialize(new { name = "Jane Doe Updated", email = "jane.updated@example.com", role = "admin" }),
            BodyType = "json",
            Headers = new List<KeyValuePairRequest> { new() { Key = "Content-Type", Value = "application/json", Enabled = true } },
            Params = new List<KeyValuePairRequest>(),
            Variables = new List<RequestVariableRequest> { new() { Key = "user_id", Value = "1", Enabled = true } },
            Auth = null,
            TestScript = @"test('Status is 200', () => {
    expect(response.status).toBe(200);
});
test('Response contains updated user', () => {
    const user = JSON.parse(response.body);
    expect(user.name).toContain('Updated');
});"
        });

        await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "Delete User", Method = "DELETE",
            Url = "{{base_url}}/api/users/{{user_id}}",
            Body = null, BodyType = "none"
        });

        return service;
    }

    private async Task<Service> CreatePostsExample(string workspaceId, string devEnvId)
    {
        var mockSlug = await GetAvailableMockSlugAsync("sandbox-posts");
        var baseUrl = GetMockBaseUrl(mockSlug);

        // Mock server
        var mockServer = await _mockRepo.CreateAsync(workspaceId,
            "Sandbox Posts Mock",
            $"Mock server for the Posts API example. Simulates a blog post service with pagination. Accessed at /mock/{mockSlug}",
            mockSlug, 0);

        var postsJson = JsonSerializer.Serialize(new[]
        {
            new { id = 1, title = "Getting Started with APIs", author = "Jane Doe", body = "APIs are the backbone of modern web development...", tags = new[] { "api", "beginners" }, created_at = "2026-06-01T08:00:00Z" },
            new { id = 2, title = "Understanding REST", author = "John Smith", body = "REST stands for Representational State Transfer...", tags = new[] { "rest", "architecture" }, created_at = "2026-06-15T12:00:00Z" },
            new { id = 3, title = "GraphQL vs REST", author = "Alice Johnson", body = "When should you choose GraphQL over REST?...", tags = new[] { "graphql", "rest", "comparison" }, created_at = "2026-07-20T16:30:00Z" },
        });

        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "GET", Path = "/api/posts",
            StatusCode = 200, ContentType = "application/json",
            ResponseBody = postsJson, DelayMs = 40
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "GET", Path = "/api/posts/{id}",
            StatusCode = 200, ContentType = "application/json",
            ResponseBody = "{}", DelayMs = 30,
            ScriptEnabled = true,
            Script = @"// Return a single post by ID with comments
var id = request.pathParams['id'] || '1';
var posts = {
    '1': { id: 1, title: 'Getting Started with APIs', author: 'Jane Doe', body: 'APIs are the backbone of modern web development...', tags: ['api', 'beginners'], comments: [{ user: 'bob', text: 'Great article!' }, { user: 'charlie', text: 'Very helpful, thanks!' }], created_at: '2026-06-01T08:00:00Z', updated_at: '2026-07-01T10:00:00Z' },
    '2': { id: 2, title: 'Understanding REST', author: 'John Smith', body: 'REST stands for Representational State Transfer...', tags: ['rest', 'architecture'], comments: [{ user: 'alice', text: 'Finally makes sense!' }], created_at: '2026-06-15T12:00:00Z', updated_at: '2026-06-15T12:00:00Z' },
    '3': { id: 3, title: 'GraphQL vs REST', author: 'Alice Johnson', body: 'When should you choose GraphQL over REST?...', tags: ['graphql', 'rest', 'comparison'], comments: [], created_at: '2026-07-20T16:30:00Z', updated_at: '2026-07-20T16:30:00Z' }
};
var post = posts[id];
if (!post) {
    response.statusCode = 404;
    response.body = JSON.stringify({ error: 'Post not found', id: parseInt(id) });
} else {
    response.statusCode = 200;
    response.body = JSON.stringify(post);
}"
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "POST", Path = "/api/posts",
            StatusCode = 201, ContentType = "application/json",
            ResponseBody = "{\"id\":4,\"title\":\"New Post\",\"author\":\"Current User\",\"created_at\":\"2026-08-11T12:00:00Z\"}",
            DelayMs = 80
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "PATCH", Path = "/api/posts/{id}",
            StatusCode = 200, ContentType = "application/json",
            ResponseBody = "{}", DelayMs = 70,
            ScriptEnabled = true,
            Script = @"// Return the updated post — reflects ID and partial body
var id = request.pathParams['id'] || '1';
var body = {};
try { body = JSON.parse(request.body || '{}'); } catch(e) {}
response.body = JSON.stringify({
    id: parseInt(id),
    title: body.title || 'Updated Post',
    author: 'Jane Doe',
    body: body.body || 'Post content...',
    tags: body.tags || ['api'],
    updated_at: new Date().toISOString()
});"
        });

        // Bearer token config
        var authConfig = JsonSerializer.Serialize(new { token = "{{api_token}}" });

        // Service with Bearer auth
        var service = await _serviceRepo.CreateAsync(workspaceId,
            "Posts API",
            "Blog post management with bearer token authentication. Demonstrates authenticated endpoints, pagination, and PATCH for partial updates.",
            new List<KeyValuePairRequest> { new() { Key = "Accept", Value = "application/json", Enabled = true } },
            new AuthRequest { AuthType = "bearer", ConfigJson = authConfig });

        await _svcVarRepo.UpsertAsync(service.Id, null, "base_url", baseUrl, false, true, devEnvId);

        await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "List All Posts", Method = "GET",
            Url = $"{{{{base_url}}}}/api/posts?_page=1&_limit={{{{pagination_limit}}}}",
            Body = null, BodyType = "none"
        });

        var p2 = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "Get Post with Comments", Method = "GET",
            Url = "{{base_url}}/api/posts/{{post_id}}",
            Body = null, BodyType = "none"
        });
        await _requestRepo.UpdateAsync(p2.Id, new UpdateApiRequestRequest
        {
            Name = "Get Post with Comments", Method = "GET",
            Url = "{{base_url}}/api/posts/{{post_id}}",
            Body = null, BodyType = "none",
            Headers = new List<KeyValuePairRequest>(),
            Params = new List<KeyValuePairRequest>(),
            Variables = new List<RequestVariableRequest> { new() { Key = "post_id", Value = "1", Enabled = true } },
            Auth = null,
            TestScript = @"test('Status is 200', () => {
    expect(response.status).toBe(200);
});
test('Post has comments', () => {
    const post = JSON.parse(response.body);
    expect(Array.isArray(post.comments)).toBe(true);
    expect(post.comments.length).toBeGreaterThan(0);
});"
        });

        await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "Create Post", Method = "POST",
            Url = "{{base_url}}/api/posts",
            Body = JsonSerializer.Serialize(new { title = "My New Post", body = "Post content here...", tags = new[] { "api" } }),
            BodyType = "json"
        });

        var p4 = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "Update Post Title", Method = "PATCH",
            Url = "{{base_url}}/api/posts/{{post_id}}",
            Body = JsonSerializer.Serialize(new { title = "Updated Post Title" }),
            BodyType = "json"
        });
        await _requestRepo.UpdateAsync(p4.Id, new UpdateApiRequestRequest
        {
            Name = "Update Post Title", Method = "PATCH",
            Url = "{{base_url}}/api/posts/{{post_id}}",
            Body = JsonSerializer.Serialize(new { title = "Updated Post Title" }),
            BodyType = "json",
            Headers = new List<KeyValuePairRequest> { new() { Key = "Content-Type", Value = "application/json", Enabled = true } },
            Params = new List<KeyValuePairRequest>(),
            Variables = new List<RequestVariableRequest> { new() { Key = "post_id", Value = "1", Enabled = true } },
            Auth = null
        });

        return service;
    }

    private async Task<Service> CreateAuthExample(string workspaceId, string devEnvId)
    {
        var mockSlug = await GetAvailableMockSlugAsync("sandbox-auth");
        var baseUrl = GetMockBaseUrl(mockSlug);

        // Mock server
        var mockServer = await _mockRepo.CreateAsync(workspaceId,
            "Sandbox Auth Mock",
            $"Mock server for the Auth API example. Simulates login, registration, profile, OAuth2 authorization-code, and OIDC discovery endpoints. Accessed at /mock/{mockSlug}",
            mockSlug, 0);

        var oauthConfig = JsonSerializer.Serialize(new
        {
            issuer = baseUrl,
            clientId = "requestloom-sandbox-client",
            clientSecret = "requestloom-sandbox-secret",
            scope = "openid profile email",
            subject = "sandbox-user",
            name = "Jane Doe",
            preferredUsername = "jane.doe",
            email = "jane@example.com",
            tokenTtlSeconds = 3600,
        });

        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "GET", Path = "/.well-known/openid-configuration",
            ContentType = "application/json",
            Behavior = MockEndpointBehaviors.OidcDiscovery,
            BehaviorConfigJson = oauthConfig,
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "GET", Path = "/oauth/authorize",
            ContentType = "text/plain",
            Behavior = MockEndpointBehaviors.OAuth2Authorization,
            BehaviorConfigJson = oauthConfig,
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "POST", Path = "/oauth/token",
            ContentType = "application/json",
            Behavior = MockEndpointBehaviors.OAuth2Token,
            BehaviorConfigJson = oauthConfig,
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "GET", Path = "/userinfo",
            ContentType = "application/json",
            Behavior = MockEndpointBehaviors.OidcUserInfo,
            BehaviorConfigJson = oauthConfig,
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "GET", Path = "/.well-known/jwks.json",
            ContentType = "application/json",
            Behavior = MockEndpointBehaviors.OidcJwks,
            BehaviorConfigJson = oauthConfig,
        });

        var loginResponse = JsonSerializer.Serialize(new
        {
            access_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-token",
            token_type = "Bearer",
            expires_in = 3600,
            refresh_token = "refresh-mock-token-abcdef"
        });

        var registerResponse = JsonSerializer.Serialize(new
        {
            id = 42,
            username = "newuser",
            email = "newuser@example.com",
            message = "Registration successful. Please check your email to verify your account."
        });

        var profileResponse = JsonSerializer.Serialize(new
        {
            id = 1,
            username = "johndoe",
            email = "john@example.com",
            full_name = "John Doe",
            avatar_url = "https://www.gravatar.com/avatar/00000000000000000000000000000000",
            roles = new[] { "user", "editor" },
            last_login = "2026-08-10T18:30:00Z"
        });

        // Endpoint with script to simulate auth behavior
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "POST", Path = "/api/auth/login",
            StatusCode = 200, ContentType = "application/json",
            ResponseBody = loginResponse, DelayMs = 150
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "POST", Path = "/api/auth/register",
            StatusCode = 201, ContentType = "application/json",
            ResponseBody = registerResponse, DelayMs = 200
        });
        await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
        {
            Method = "GET", Path = "/api/auth/me",
            StatusCode = 200, ContentType = "application/json",
            ResponseBody = profileResponse, DelayMs = 50,
            ScriptEnabled = true,
            Script = @"// Simulate auth check: return 401 if no Authorization header
const auth = request.headers['Authorization'] || request.headers['authorization'];
if (!auth || !auth.startsWith('Bearer ')) {
    response.statusCode = 401;
    response.body = JSON.stringify({ error: 'Unauthorized', message: 'Missing or invalid token' });
} else {
    response.statusCode = 200;
    response.body = JSON.stringify({
        id: 1, username: 'johndoe', email: 'john@example.com',
        full_name: 'John Doe',
        roles: ['user', 'editor'],
        last_login: new Date().toISOString()
    });
}"
        });

        // Service
        var service = await _serviceRepo.CreateAsync(workspaceId,
            "Auth API",
            "Authentication endpoints - login, register, and profile. Demonstrates form-encoded bodies, token extraction via post-request scripts, and mock server scripting.",
            new List<KeyValuePairRequest>(),
            null);

        await _svcVarRepo.UpsertAsync(service.Id, null, "base_url", baseUrl, false, true, devEnvId);
        await _svcVarRepo.UpsertAsync(service.Id, null, "oidc_issuer", baseUrl, false, true, devEnvId);
        await _svcVarRepo.UpsertAsync(service.Id, null, "oauth_client_id", "requestloom-sandbox-client", false, true, devEnvId);
        await _svcVarRepo.UpsertAsync(service.Id, null, "oauth_client_secret", "requestloom-sandbox-secret", true, true, devEnvId);
        await _svcVarRepo.UpsertAsync(service.Id, null, "oauth_scope", "openid profile email", false, true, devEnvId);
        await _svcVarRepo.UpsertAsync(service.Id, null, "oauth_redirect_uri", "http://localhost:5173/oauth/callback", false, true, devEnvId);
        await _svcVarRepo.UpsertAsync(service.Id, null, "oauth_code_verifier", "requestloom-sandbox-pkce", false, true, devEnvId);

        // Login (form-urlencoded body)
        var loginReq = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "Login", Method = "POST",
            Url = "{{base_url}}/api/auth/login",
            Body = "username=johndoe&password=secret123",
            BodyType = "form-urlencoded"
        });
        await _requestRepo.UpdateAsync(loginReq.Id, new UpdateApiRequestRequest
        {
            Name = "Login", Method = "POST",
            Url = "{{base_url}}/api/auth/login",
            Body = "username=johndoe&password=secret123",
            BodyType = "form-urlencoded",
            Headers = new List<KeyValuePairRequest> { new() { Key = "Content-Type", Value = "application/x-www-form-urlencoded", Enabled = true } },
            Params = new List<KeyValuePairRequest>(),
            Variables = new List<RequestVariableRequest>(),
            Auth = null,
            PostRequestScript = @"// Extract token from login response and store it as a variable
const json = JSON.parse(response.body);
if (json.access_token) {
    setVar('access_token', String(json.access_token));
    setVar('refresh_token', String(json.refresh_token || ''));
    log('Token stored for subsequent requests');
}",
            TestScript = @"test('Login successful', () => {
    expect(response.status).toBe(200);
});
test('Returns access token', () => {
    const json = JSON.parse(response.body);
    expect(typeof json.access_token).toBe('string');
    expect(json.token_type).toBe('Bearer');
});"
        });

        // Register
        await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "Register", Method = "POST",
            Url = "{{base_url}}/api/auth/register",
            Body = JsonSerializer.Serialize(new { username = "newuser", email = "newuser@example.com", password = "securePass456" }),
            BodyType = "json"
        });

        // Get Current User Profile using the token extracted by Login
        var profileReq = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
        {
            Name = "Get My Profile", Method = "GET",
            Url = "{{base_url}}/api/auth/me",
            Body = null, BodyType = "none"
        });
        await _requestRepo.UpdateAsync(profileReq.Id, new UpdateApiRequestRequest
        {
            Name = "Get My Profile", Method = "GET",
            Url = "{{base_url}}/api/auth/me",
            Body = null, BodyType = "none",
            Headers = new List<KeyValuePairRequest>(),
            Params = new List<KeyValuePairRequest>(),
            Variables = new List<RequestVariableRequest>
            {
                new() { Key = "access_token", Value = "", Enabled = true }
            },
            Auth = new AuthRequest
            {
                AuthType = "bearer",
                ConfigJson = JsonSerializer.Serialize(new { token = "{{access_token}}" })
            },
            TestScript = @"test('Profile request authenticated', () => {
    expect(response.status).toBe(200);
});
test('Returns the current user', () => {
    const json = JSON.parse(response.body);
    expect(json.username).toBe('johndoe');
});"
        });

        await EnsureSandboxOAuthRequestsAsync(service);

        return service;
    }

    private async Task<string> GetAvailableMockSlugAsync(string preferredSlug)
    {
        var normalizedSlug = preferredSlug.Trim().ToLowerInvariant();
        if (await _mockRepo.GetBySlugAsync(normalizedSlug) == null)
        {
            return normalizedSlug;
        }

        var suffix = Guid.NewGuid().ToString("N")[..8];
        return $"{normalizedSlug}-{suffix}";
    }

    private string GetMockBaseUrl(string slug)
    {
        var configured = _configuration["RequestLoom:PublicUrl"] ??
            System.Environment.GetEnvironmentVariable("REQUESTLOOM_PUBLIC_URL");
        var baseUrl = NormalizePublicUrl(configured);

        if (baseUrl == null)
        {
            var urls = System.Environment.GetEnvironmentVariable("ASPNETCORE_URLS")?
                .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ?? [];
            baseUrl = urls.Select(NormalizePublicUrl).FirstOrDefault(url => url != null);
        }

        return $"{(baseUrl ?? "http://localhost:5056").TrimEnd('/')}/mock/{slug}";
    }

    private async Task RepairSandboxMockUrlsAsync(
        string workspaceId,
        IEnumerable<Service> services,
        IEnumerable<MockServer> mockServers)
    {
        var environments = (await _envRepo.GetByWorkspaceAsync(workspaceId)).ToList();
        var environmentIds = environments
            .Where(environment => environment.Name is "DEV" or "STG")
            .Select(environment => environment.Id)
            .ToList();

        var sandboxMocks = mockServers
            .Where(server => server.Slug.StartsWith("sandbox-", StringComparison.OrdinalIgnoreCase))
            .ToList();

        var authMock = sandboxMocks.FirstOrDefault(server =>
            server.Slug.StartsWith("sandbox-auth", StringComparison.OrdinalIgnoreCase));
        if (authMock != null)
        {
            await EnsureSandboxOAuthEndpointsAsync(authMock);
        }

        foreach (var service in services)
        {
            var mock = sandboxMocks.FirstOrDefault(server =>
                service.Name switch
                {
                    "Users API" => server.Slug.StartsWith("sandbox-users", StringComparison.OrdinalIgnoreCase),
                    "Posts API" => server.Slug.StartsWith("sandbox-posts", StringComparison.OrdinalIgnoreCase),
                    "Auth API" => server.Slug.StartsWith("sandbox-auth", StringComparison.OrdinalIgnoreCase),
                    _ => false,
                });
            if (mock == null) continue;

            foreach (var environmentId in environmentIds)
            {
                await _svcVarRepo.UpsertAsync(
                    service.Id,
                    null,
                    "base_url",
                    GetMockBaseUrl(mock.Slug),
                    false,
                    true,
                    environmentId);

                if (service.Name == "Auth API")
                {
                    var authBaseUrl = GetMockBaseUrl(mock.Slug);
                    await _svcVarRepo.UpsertAsync(service.Id, null, "oidc_issuer", authBaseUrl, false, true, environmentId);
                    await _svcVarRepo.UpsertAsync(service.Id, null, "oauth_client_id", "requestloom-sandbox-client", false, true, environmentId);
                    await _svcVarRepo.UpsertAsync(service.Id, null, "oauth_client_secret", "requestloom-sandbox-secret", true, true, environmentId);
                    await _svcVarRepo.UpsertAsync(service.Id, null, "oauth_scope", "openid profile email", false, true, environmentId);
                    await _svcVarRepo.UpsertAsync(service.Id, null, "oauth_redirect_uri", "http://localhost:5173/oauth/callback", false, true, environmentId);
                    await _svcVarRepo.UpsertAsync(service.Id, null, "oauth_code_verifier", "requestloom-sandbox-pkce", false, true, environmentId);
                    await EnsureSandboxOAuthRequestsAsync(service);
                }
            }
        }
    }

    private async Task EnsureSandboxOAuthEndpointsAsync(MockServer mockServer)
    {
        var endpoints = (await _mockRepo.GetEndpointsAsync(mockServer.Id)).ToList();
        var config = JsonSerializer.Serialize(new
        {
            issuer = GetMockBaseUrl(mockServer.Slug),
            clientId = "requestloom-sandbox-client",
            clientSecret = "requestloom-sandbox-secret",
            scope = "openid profile email",
            subject = "sandbox-user",
            name = "Jane Doe",
            preferredUsername = "jane.doe",
            email = "jane@example.com",
            tokenTtlSeconds = 3600,
        });

        var builtIns = new (string method, string path, string behavior)[]
        {
            ("GET", "/.well-known/openid-configuration", MockEndpointBehaviors.OidcDiscovery),
            ("GET", "/oauth/authorize", MockEndpointBehaviors.OAuth2Authorization),
            ("POST", "/oauth/token", MockEndpointBehaviors.OAuth2Token),
            ("GET", "/userinfo", MockEndpointBehaviors.OidcUserInfo),
            ("GET", "/.well-known/jwks.json", MockEndpointBehaviors.OidcJwks),
        };

        foreach (var (method, path, behavior) in builtIns)
        {
            if (endpoints.Any(endpoint =>
                    endpoint.Method.Equals(method, StringComparison.OrdinalIgnoreCase) &&
                    endpoint.Path.Equals(path, StringComparison.OrdinalIgnoreCase)))
                continue;

            await _mockRepo.CreateEndpointAsync(mockServer.Id, new CreateMockEndpointRequest
            {
                Method = method,
                Path = path,
                ContentType = "application/json",
                Behavior = behavior,
                BehaviorConfigJson = config,
            });
        }
    }

    private async Task EnsureSandboxOAuthRequestsAsync(Service service)
    {
        var requests = await _requestRepo.GetByServiceIdAsync(service.Id);

        var profile = requests.FirstOrDefault(request =>
            request.Name.Equals("Get My Profile", StringComparison.OrdinalIgnoreCase));
        if (profile != null && profile.Auth == null &&
            !profile.Variables.Any(variable => variable.Key.Equals("access_token", StringComparison.OrdinalIgnoreCase)))
        {
            await _requestRepo.UpdateAsync(profile.Id, new UpdateApiRequestRequest
            {
                Name = profile.Name,
                Method = profile.Method,
                Url = profile.Url,
                Body = profile.Body,
                BodyType = profile.BodyType,
                PreRequestScript = profile.PreRequestScript,
                PostRequestScript = profile.PostRequestScript,
                TestScript = string.IsNullOrWhiteSpace(profile.TestScript)
                    ? @"test('Profile request authenticated', () => {
    expect(response.status).toBe(200);
});"
                    : profile.TestScript,
                Notes = profile.Notes,
                Headers = profile.Headers.Select(header => new KeyValuePairRequest
                {
                    Key = header.Key, Value = header.Value, Enabled = header.Enabled
                }).ToList(),
                Params = profile.Params.Select(param => new KeyValuePairRequest
                {
                    Key = param.Key, Value = param.Value, Enabled = param.Enabled
                }).ToList(),
                Variables = profile.Variables.Select(variable => new RequestVariableRequest
                {
                    Key = variable.Key, Value = variable.Value, Enabled = variable.Enabled
                }).Append(new RequestVariableRequest
                {
                    Key = "access_token", Value = "", Enabled = true
                }).ToList(),
                Auth = new AuthRequest
                {
                    AuthType = "bearer",
                    ConfigJson = JsonSerializer.Serialize(new { token = "{{access_token}}" })
                }
            });
        }

        var existingNames = requests
            .Select(request => request.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (!existingNames.Contains("OIDC Discovery"))
        {
            var request = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
            {
                Name = "OIDC Discovery",
                Method = "GET",
                Url = "{{oidc_issuer}}/.well-known/openid-configuration",
                BodyType = "none"
            });
            await _requestRepo.UpdateAsync(request.Id, new UpdateApiRequestRequest
            {
                Name = "OIDC Discovery",
                Method = "GET",
                Url = "{{oidc_issuer}}/.well-known/openid-configuration",
                BodyType = "none",
                Headers = new List<KeyValuePairRequest>(),
                Params = new List<KeyValuePairRequest>(),
                Variables = new List<RequestVariableRequest>(),
                Auth = new AuthRequest { AuthType = "none", ConfigJson = "{}" },
                TestScript = @"test('OIDC discovery is available', () => {
    expect(response.status).toBe(200);
});
test('Publishes OAuth2 endpoints', () => {
    const json = JSON.parse(response.body);
    expect(json.authorization_endpoint).toContain('/oauth/authorize');
    expect(json.token_endpoint).toContain('/oauth/token');
    expect(json.userinfo_endpoint).toContain('/userinfo');
});"
            });
        }

        if (!existingNames.Contains("OAuth2 Authorize (PKCE)"))
        {
            var request = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
            {
                Name = "OAuth2 Authorize (PKCE)",
                Method = "GET",
                Url = "{{base_url}}/oauth/authorize",
                BodyType = "none"
            });
            await _requestRepo.UpdateAsync(request.Id, new UpdateApiRequestRequest
            {
                Name = "OAuth2 Authorize (PKCE)",
                Method = "GET",
                Url = "{{base_url}}/oauth/authorize",
                BodyType = "none",
                Headers = new List<KeyValuePairRequest>(),
                Params = new List<KeyValuePairRequest>
                {
                    new() { Key = "response_type", Value = "code", Enabled = true },
                    new() { Key = "client_id", Value = "{{oauth_client_id}}", Enabled = true },
                    new() { Key = "redirect_uri", Value = "{{oauth_redirect_uri}}", Enabled = true },
                    new() { Key = "scope", Value = "{{oauth_scope}}", Enabled = true },
                    new() { Key = "state", Value = "sandbox-state", Enabled = true },
                    new() { Key = "code_challenge", Value = "{{oauth_code_verifier}}", Enabled = true },
                    new() { Key = "code_challenge_method", Value = "plain", Enabled = true }
                },
                Variables = new List<RequestVariableRequest>(),
                Auth = new AuthRequest { AuthType = "none", ConfigJson = "{}" },
                PostRequestScript = @"const location = getResponseHeader('Location') || '';
const match = /[?&]code=([^&]+)/.exec(location);
if (match) {
    setVar('oauth_code', decodeURIComponent(match[1]));
    log('Authorization code stored for token exchange');
} else {
    log('Authorization response did not contain a code');
}",
                TestScript = @"test('Authorization request returned a code redirect', () => {
    expect(response.status).toBe(302);
});
test('Authorization response contains a code', () => {
    expect(response.headers['Location'] || response.headers['location']).toContain('code=');
});"
            });
            await _requestRepo.SaveSettingsAsync(request.Id, new ApiRequestSettings
            {
                RequestId = request.Id,
                FollowRedirects = false,
                MaxRedirects = 10
            });
        }

        if (!existingNames.Contains("OAuth2 Token Exchange"))
        {
            var request = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
            {
                Name = "OAuth2 Token Exchange",
                Method = "POST",
                Url = "{{base_url}}/oauth/token",
                Body = "grant_type=authorization_code&code={{oauth_code}}&redirect_uri={{oauth_redirect_uri}}&client_id={{oauth_client_id}}&client_secret={{oauth_client_secret}}&code_verifier={{oauth_code_verifier}}",
                BodyType = "form"
            });
            await _requestRepo.UpdateAsync(request.Id, new UpdateApiRequestRequest
            {
                Name = "OAuth2 Token Exchange",
                Method = "POST",
                Url = "{{base_url}}/oauth/token",
                Body = "grant_type=authorization_code&code={{oauth_code}}&redirect_uri={{oauth_redirect_uri}}&client_id={{oauth_client_id}}&client_secret={{oauth_client_secret}}&code_verifier={{oauth_code_verifier}}",
                BodyType = "form",
                Headers = new List<KeyValuePairRequest>
                {
                    new() { Key = "Content-Type", Value = "application/x-www-form-urlencoded", Enabled = true }
                },
                Params = new List<KeyValuePairRequest>(),
                Variables = new List<RequestVariableRequest>
                {
                    new() { Key = "oauth_code", Value = "", Enabled = true }
                },
                Auth = new AuthRequest { AuthType = "none", ConfigJson = "{}" },
                PostRequestScript = @"const json = JSON.parse(response.body);
if (json.access_token) {
    setVar('access_token', String(json.access_token));
    setVar('id_token', String(json.id_token || ''));
    setVar('refresh_token', String(json.refresh_token || ''));
    log('OAuth2 access token and OIDC ID token stored');
}",
                TestScript = @"test('Token exchange succeeded', () => {
    expect(response.status).toBe(200);
});
test('Returns OAuth2 and OIDC tokens', () => {
    const json = JSON.parse(response.body);
    expect(json.token_type).toBe('Bearer');
    expect(typeof json.access_token).toBe('string');
    expect(typeof json.id_token).toBe('string');
});"
            });
        }

        if (!existingNames.Contains("OIDC UserInfo"))
        {
            var request = await _requestRepo.CreateAsync(service.Id, new CreateApiRequestRequest
            {
                Name = "OIDC UserInfo",
                Method = "GET",
                Url = "{{base_url}}/userinfo",
                BodyType = "none"
            });
            await _requestRepo.UpdateAsync(request.Id, new UpdateApiRequestRequest
            {
                Name = "OIDC UserInfo",
                Method = "GET",
                Url = "{{base_url}}/userinfo",
                BodyType = "none",
                Headers = new List<KeyValuePairRequest>(),
                Params = new List<KeyValuePairRequest>(),
                Variables = new List<RequestVariableRequest>
                {
                    new() { Key = "access_token", Value = "", Enabled = true }
                },
                Auth = new AuthRequest
                {
                    AuthType = "bearer",
                    ConfigJson = JsonSerializer.Serialize(new { token = "{{access_token}}" })
                },
                TestScript = @"test('UserInfo accepts the OAuth2 access token', () => {
    expect(response.status).toBe(200);
});
test('Returns OIDC claims', () => {
    const json = JSON.parse(response.body);
    expect(json.sub).toBe('sandbox-user');
    expect(json.email).toBe('jane@example.com');
});"
            });
        }
    }

    private static string? NormalizePublicUrl(string? value)
    {
        if (!Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            return null;

        var host = uri.Host switch
        {
            "0.0.0.0" or "*" or "+" => "localhost",
            _ => uri.Host,
        };
        var builder = new UriBuilder(uri.Scheme, host, uri.Port);
        return builder.Uri.GetLeftPart(UriPartial.Authority);
    }

    /// <summary>
    /// Clears ALL user data: workspaces, environments, services, requests,
    /// variables, mock servers, and history. Resets to completely empty state.
    /// </summary>
    public async Task<int> ClearAllDataAsync()
    {
        _logger.LogWarning("Clearing ALL data...");

        if (_settings.UseJson)
        {
            return ClearJsonData();
        }
        else
        {
            return await ClearSqliteDataAsync();
        }
    }

    private int ClearJsonData()
    {
        var count = 0;
        _jsonStore!.Mutate(doc =>
        {
            count = doc.Workspaces.Count + doc.Environments.Count + doc.EnvironmentVariables.Count
                    + doc.Services.Count + doc.Requests.Count + doc.RequestSettings.Count
                    + doc.WorkspaceVariables.Count + doc.ServiceVariables.Count
                    + doc.History.Count + doc.MockServers.Count;

            doc.Workspaces.Clear();
            doc.Environments.Clear();
            doc.EnvironmentVariables.Clear();
            doc.Services.Clear();
            doc.Requests.Clear();
            doc.RequestSettings.Clear();
            doc.WorkspaceVariables.Clear();
            doc.ServiceVariables.Clear();
            doc.History.Clear();
            doc.MockServers.Clear();
        });

        _logger.LogInformation("Cleared {Count} JSON records", count);
        return count;
    }

    private async Task<int> ClearSqliteDataAsync()
    {
        var db = _db!;
        var count = 0;

        // Delete in dependency order (children first)
        db.RequestHeaders.RemoveRange(db.RequestHeaders);
        db.RequestParams.RemoveRange(db.RequestParams);
        db.RequestVariables.RemoveRange(db.RequestVariables);
        db.RequestSettings.RemoveRange(db.RequestSettings);
        db.RequestAuths.RemoveRange(db.RequestAuths);
        db.ServiceHeaders.RemoveRange(db.ServiceHeaders);
        db.ServiceAuths.RemoveRange(db.ServiceAuths);
        db.EnvironmentVariables.RemoveRange(db.EnvironmentVariables);
        db.WorkspaceVariables.RemoveRange(db.WorkspaceVariables);
        db.ServiceVariables.RemoveRange(db.ServiceVariables);
        db.History.RemoveRange(db.History);
        db.MockServerEndpoints.RemoveRange(db.MockServerEndpoints);
        db.MockServers.RemoveRange(db.MockServers);
        db.Requests.RemoveRange(db.Requests);
        db.Services.RemoveRange(db.Services);
        db.Environments.RemoveRange(db.Environments);
        db.Workspaces.RemoveRange(db.Workspaces);

        count = await db.SaveChangesAsync();
        _logger.LogInformation("Cleared {Count} database rows", count);
        return count;
    }
}
