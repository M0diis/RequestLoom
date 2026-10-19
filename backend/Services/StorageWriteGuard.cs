namespace RequestLoom.Api.Services;

/// <summary>Admits writes together, or one migration after all writes have completed.</summary>
public sealed class StorageWriteGuard(SettingsService settings)
{
    private readonly object _sync = new();
    private int _writers;
    private bool _migrating;

    public IDisposable? TryEnter(bool migration)
    {
        lock (_sync)
        {
            if (_migrating || settings.RestartRequired || (migration && _writers != 0)) return null;
            if (migration) _migrating = true;
            else _writers++;
            return new Lease(() =>
            {
                lock (_sync)
                {
                    if (migration) _migrating = false;
                    else _writers--;
                }
            });
        }
    }

    private sealed class Lease(Action release) : IDisposable
    {
        private Action? _release = release;
        public void Dispose() => Interlocked.Exchange(ref _release, null)?.Invoke();
    }
}
