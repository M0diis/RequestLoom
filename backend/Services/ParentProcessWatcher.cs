using System.Diagnostics;

namespace RequestLoom.Api.Services;

/// <summary>
/// When hosted by the desktop shell (REQUESTLOOM_PARENT_PID set), stops the backend
/// as soon as the shell process exits, so a crashed or force-killed shell never
/// leaves an orphaned backend holding the port, database and memory.
/// </summary>
public sealed class ParentProcessWatcher(IHostApplicationLifetime lifetime, ILogger<ParentProcessWatcher> logger) : BackgroundService
{
    public const string ParentPidVariable = "REQUESTLOOM_PARENT_PID";
    private static readonly TimeSpan ForcedExitDelay = TimeSpan.FromSeconds(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!int.TryParse(Environment.GetEnvironmentVariable(ParentPidVariable), out var parentPid)) return;

        Process parent;
        try
        {
            parent = Process.GetProcessById(parentPid);
        }
        catch (ArgumentException)
        {
            ShutDown(parentPid);
            return;
        }

        using (parent)
        {
            try
            {
                await parent.WaitForExitAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }

        ShutDown(parentPid);
    }

    private void ShutDown(int parentPid)
    {
        logger.LogWarning("Desktop shell process {ParentPid} is gone; shutting down.", parentPid);
        lifetime.StopApplication();

        // Graceful shutdown waits for in-flight work; never let it keep the process alive.
        _ = Task.Delay(ForcedExitDelay).ContinueWith(_ => Environment.Exit(1), TaskScheduler.Default);
    }
}
