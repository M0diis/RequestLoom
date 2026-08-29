using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data;
using RequestLoom.Api.Data.Repositories;
using RequestLoom.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// JSON serialization
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    });

builder.Services.AddOpenApi();

// CORS for Vite dev server
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:5173")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// HttpClient for request proxying
builder.Services.AddHttpClient();

// Storage configuration
var settingsService = new SettingsService(builder.Configuration);
builder.Services.AddSingleton(settingsService);
builder.Services.AddSingleton<JsonDataStore>();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(new SqliteConnectionStringBuilder { DataSource = settingsService.DatabasePath }.ToString()));

// Repositories (storage mode dependent)
if (settingsService.UseJson)
{
    builder.Services.AddScoped<IWorkspaceRepository, JsonWorkspaceRepository>();
    builder.Services.AddScoped<IEnvironmentRepository, JsonEnvironmentRepository>();
    builder.Services.AddScoped<IServiceRepository, JsonServiceRepository>();
    builder.Services.AddScoped<IServiceVariableRepository, JsonServiceVariableRepository>();
    builder.Services.AddScoped<IRequestRepository, JsonRequestRepository>();
    builder.Services.AddScoped<IHistoryRepository, JsonHistoryRepository>();
    builder.Services.AddScoped<IWorkspaceVariableRepository, JsonWorkspaceVariableRepository>();
    builder.Services.AddScoped<IMockServerRepository, JsonMockServerRepository>();
}
else
{
    builder.Services.AddScoped<DbInitializer>();
    builder.Services.AddScoped<IWorkspaceRepository, WorkspaceRepository>();
    builder.Services.AddScoped<IEnvironmentRepository, EnvironmentRepository>();
    builder.Services.AddScoped<IServiceRepository, ServiceRepository>();
    builder.Services.AddScoped<IServiceVariableRepository, ServiceVariableRepository>();
    builder.Services.AddScoped<IRequestRepository, RequestRepository>();
    builder.Services.AddScoped<IHistoryRepository, HistoryRepository>();
    builder.Services.AddScoped<IWorkspaceVariableRepository, WorkspaceVariableRepository>();
    builder.Services.AddScoped<IMockServerRepository, MockServerRepository>();
}

// Services
builder.Services.AddScoped<VariableResolutionService>();
builder.Services.AddSingleton<RuntimeVariableStore>();
builder.Services.AddSingleton<OAuthTokenService>();
builder.Services.AddSingleton<CookieJarService>();
builder.Services.AddSingleton<RequestUploadService>();
builder.Services.AddScoped<RequestExecutionService>();
builder.Services.AddScoped<SpecificationImportService>();
    builder.Services.AddScoped<CollectionImportService>();
builder.Services.AddScoped<ExportImportService>();
builder.Services.AddScoped<ToolsService>();
builder.Services.AddScoped<CollectionRunnerService>();
builder.Services.AddScoped<JavaScriptRunnerService>();
builder.Services.AddScoped<MockServerService>();
builder.Services.AddScoped<ExampleDataService>();

var app = builder.Build();

// Initialize the active storage
using (var scope = app.Services.CreateScope())
{
    if (settingsService.UseJson)
    {
        var jsonStore = scope.ServiceProvider.GetRequiredService<JsonDataStore>();
        jsonStore.Initialize();
    }
    else
    {
        var dbInit = scope.ServiceProvider.GetRequiredService<DbInitializer>();
        dbInit.InitializeAsync().GetAwaiter().GetResult();
    }
}

// Middleware pipeline
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();

// Mock Server middleware: intercepts /mock/* before static files/SPA fallback
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? "";
    if (path.StartsWith("/mock/", StringComparison.OrdinalIgnoreCase) ||
        path.Equals("/mock", StringComparison.OrdinalIgnoreCase))
    {
        // Handle CORS preflight
        if (context.Request.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = 200;
            context.Response.Headers["Access-Control-Allow-Origin"] = "*";
            context.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD";
            context.Response.Headers["Access-Control-Allow-Headers"] = "*";
            return;
        }

        var mockService = context.RequestServices.GetRequiredService<MockServerService>();

        // Extract serverId: /mock/{serverId}[/{**rest}]
        var segments = path.TrimStart('/').Split('/', 3);
        // segments[0] = "mock", segments[1] = serverId, segments[2] = optional rest
        if (segments.Length < 2 || string.IsNullOrWhiteSpace(segments[1]))
        {
            context.Response.StatusCode = 400;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync("""{"error":"Missing mock server ID"}""");
            return;
        }

        var serverId = segments[1];
        var restPath = segments.Length > 2 ? "/" + segments[2] : "/";
        if (context.Request.QueryString.HasValue)
            restPath += context.Request.QueryString.Value;

        // Read body if present
        string? body = null;
        if (context.Request.ContentLength > 0)
        {
            using var reader = new StreamReader(context.Request.Body);
            body = await reader.ReadToEndAsync();
        }

        var response = await mockService.HandleRequestAsync(
            serverId, context.Request.Method, restPath, body, context.Request.Headers);

        context.Response.StatusCode = response.StatusCode;

        foreach (var header in response.Headers)
        {
            context.Response.Headers[header.Key] = header.Value;
        }

        if (!string.IsNullOrEmpty(response.Body))
        {
            await context.Response.WriteAsync(response.Body);
        }

        return;
    }

    await next();
});

// Serve frontend static files in production
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();

// SPA fallback: serve index.html for non-API routes
app.MapFallbackToFile("index.html");

app.Run();
