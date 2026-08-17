using Microsoft.EntityFrameworkCore;
using RequestLoom.Api.Data.Entities;

namespace RequestLoom.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<WorkspaceRow> Workspaces => Set<WorkspaceRow>();
    public DbSet<EnvironmentRow> Environments => Set<EnvironmentRow>();
    public DbSet<EnvironmentVariableRow> EnvironmentVariables => Set<EnvironmentVariableRow>();
    public DbSet<ServiceRow> Services => Set<ServiceRow>();
    public DbSet<ApiRequestRow> Requests => Set<ApiRequestRow>();
    public DbSet<RequestHeaderRow> RequestHeaders => Set<RequestHeaderRow>();
    public DbSet<RequestParamRow> RequestParams => Set<RequestParamRow>();
    public DbSet<RequestVariableRow> RequestVariables => Set<RequestVariableRow>();
    public DbSet<RequestSettingsRow> RequestSettings => Set<RequestSettingsRow>();
    public DbSet<RequestAuthRow> RequestAuths => Set<RequestAuthRow>();
    public DbSet<ServiceHeaderRow> ServiceHeaders => Set<ServiceHeaderRow>();
    public DbSet<ServiceAuthRow> ServiceAuths => Set<ServiceAuthRow>();
    public DbSet<WorkspaceVariableRow> WorkspaceVariables => Set<WorkspaceVariableRow>();
    public DbSet<ServiceVariableRow> ServiceVariables => Set<ServiceVariableRow>();
    public DbSet<HistoryRow> History => Set<HistoryRow>();
    public DbSet<MockServerRow> MockServers => Set<MockServerRow>();
    public DbSet<MockServerEndpointRow> MockServerEndpoints => Set<MockServerEndpointRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<EnvironmentRow>()
            .HasOne<WorkspaceRow>()
            .WithMany()
            .HasForeignKey(e => e.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<EnvironmentVariableRow>()
            .HasOne<EnvironmentRow>()
            .WithMany()
            .HasForeignKey(v => v.EnvironmentId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ServiceRow>()
            .HasOne<WorkspaceRow>()
            .WithMany()
            .HasForeignKey(s => s.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ApiRequestRow>()
            .HasOne<ServiceRow>()
            .WithMany()
            .HasForeignKey(r => r.ServiceId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<RequestHeaderRow>()
            .HasOne<ApiRequestRow>()
            .WithMany()
            .HasForeignKey(h => h.RequestId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<RequestParamRow>()
            .HasOne<ApiRequestRow>()
            .WithMany()
            .HasForeignKey(p => p.RequestId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<RequestVariableRow>()
            .HasOne<ApiRequestRow>()
            .WithMany()
            .HasForeignKey(v => v.RequestId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<RequestSettingsRow>()
            .HasOne<ApiRequestRow>()
            .WithMany()
            .HasForeignKey(s => s.RequestId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<RequestAuthRow>()
            .HasOne<ApiRequestRow>()
            .WithMany()
            .HasForeignKey(a => a.RequestId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ServiceHeaderRow>()
            .HasOne<ServiceRow>()
            .WithMany()
            .HasForeignKey(h => h.ServiceId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ServiceAuthRow>()
            .HasOne<ServiceRow>()
            .WithMany()
            .HasForeignKey(a => a.ServiceId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<WorkspaceVariableRow>()
            .HasOne<WorkspaceRow>()
            .WithMany()
            .HasForeignKey(v => v.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<WorkspaceVariableRow>()
            .HasOne<EnvironmentRow>()
            .WithMany()
            .HasForeignKey(v => v.EnvironmentId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<ServiceVariableRow>()
            .HasOne<ServiceRow>()
            .WithMany()
            .HasForeignKey(v => v.ServiceId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<HistoryRow>()
            .HasOne<WorkspaceRow>()
            .WithMany()
            .HasForeignKey(h => h.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<HistoryRow>()
            .HasOne<ApiRequestRow>()
            .WithMany()
            .HasForeignKey(h => h.RequestId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<MockServerRow>()
            .HasOne<WorkspaceRow>()
            .WithMany()
            .HasForeignKey(m => m.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<MockServerEndpointRow>()
            .HasOne<MockServerRow>()
            .WithMany()
            .HasForeignKey(e => e.MockServerId)
            .OnDelete(DeleteBehavior.Cascade);

        // Unique constraints
        modelBuilder.Entity<EnvironmentVariableRow>()
            .HasIndex(v => new { v.EnvironmentId, v.Key })
            .IsUnique();

        modelBuilder.Entity<RequestAuthRow>()
            .HasIndex(a => a.RequestId)
            .IsUnique();

        modelBuilder.Entity<RequestSettingsRow>()
            .HasIndex(s => s.RequestId)
            .IsUnique();

        modelBuilder.Entity<ServiceAuthRow>()
            .HasIndex(a => a.ServiceId)
            .IsUnique();

        modelBuilder.Entity<MockServerRow>()
            .HasIndex(m => m.Slug)
            .IsUnique();

        // Query indexes
        modelBuilder.Entity<EnvironmentRow>().HasIndex(e => e.WorkspaceId);
        modelBuilder.Entity<ServiceRow>().HasIndex(s => s.WorkspaceId);
        modelBuilder.Entity<ApiRequestRow>().HasIndex(r => r.ServiceId);
        modelBuilder.Entity<RequestHeaderRow>().HasIndex(h => h.RequestId);
        modelBuilder.Entity<RequestParamRow>().HasIndex(p => p.RequestId);
        modelBuilder.Entity<ServiceHeaderRow>().HasIndex(h => h.ServiceId);
        modelBuilder.Entity<WorkspaceVariableRow>().HasIndex(v => v.WorkspaceId);
        modelBuilder.Entity<ServiceVariableRow>().HasIndex(v => v.ServiceId);
        modelBuilder.Entity<HistoryRow>().HasIndex(h => h.WorkspaceId);
        modelBuilder.Entity<HistoryRow>().HasIndex(h => h.ExecutedAt);
        modelBuilder.Entity<MockServerRow>().HasIndex(m => m.WorkspaceId);
        modelBuilder.Entity<MockServerEndpointRow>().HasIndex(e => e.MockServerId);
    }
}