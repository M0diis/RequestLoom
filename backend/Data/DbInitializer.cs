using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data.Entities;

namespace RequestLoom.Api.Data;

public class DbInitializer
{
    private readonly AppDbContext _db;
    private readonly ILogger<DbInitializer> _logger;

    public DbInitializer(AppDbContext db, ILogger<DbInitializer> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task InitializeAsync()
    {
        await _db.Database.MigrateAsync();

        if (await _db.Workspaces.AnyAsync())
        {
            return;
        }

        _logger.LogInformation("Creating default workspace...");

        var now = DateTime.UtcNow.ToString("o");
        _db.Workspaces.Add(new WorkspaceRow
        {
            Id = "default",
            Name = "Default Workspace",
            CreatedAt = now,
            UpdatedAt = now,
        });

        _db.Environments.AddRange(
            new EnvironmentRow { Id = Guid.NewGuid().ToString("N"), WorkspaceId = "default", Name = "DEV", IsActive = true, SortOrder = 0, CreatedAt = now },
            new EnvironmentRow { Id = Guid.NewGuid().ToString("N"), WorkspaceId = "default", Name = "STG", IsActive = false, SortOrder = 1, CreatedAt = now },
            new EnvironmentRow { Id = Guid.NewGuid().ToString("N"), WorkspaceId = "default", Name = "PRD", IsActive = false, SortOrder = 2, CreatedAt = now });

        await _db.SaveChangesAsync();
    }
}