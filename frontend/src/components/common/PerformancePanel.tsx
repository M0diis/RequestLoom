import { useMemo } from 'react';
import { useDevToolsStore } from '../../stores/devToolsStore';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PerformancePanel() {
  const entries = useDevToolsStore((state) => state.networkEntries);
  const stats = useMemo(() => {
    const completed = entries.filter((entry) => entry.status >= 200 && entry.status < 400);
    const failed = entries.filter((entry) => Boolean(entry.error) || entry.status === 0 || entry.status >= 400);
    const totalDuration = entries.reduce((total, entry) => total + entry.durationMs, 0);
    const totalSize = entries.reduce((total, entry) => total + entry.sizeBytes, 0);

    return {
      total: entries.length,
      completed: completed.length,
      failed: failed.length,
      averageDuration: entries.length ? Math.round(totalDuration / entries.length) : 0,
      totalSize,
    };
  }, [entries]);

  const recentEntries = entries.slice(0, 8).reverse();
  const maxDuration = Math.max(...recentEntries.map((entry) => entry.durationMs), 1);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-[#0b0b0b] p-3 text-xs text-gray-300">
      <div className="grid flex-shrink-0 grid-cols-5 gap-2">
        {[
          ['Requests', stats.total.toString()],
          ['Completed', stats.completed.toString()],
          ['Failed', stats.failed.toString()],
          ['Avg. duration', `${stats.averageDuration} ms`],
          ['Transferred', formatBytes(stats.totalSize)],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-gray-800 bg-[#151515] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-600">{label}</div>
            <div className="mt-1 text-sm text-gray-200">{value}</div>
          </div>
        ))}
      </div>

      {recentEntries.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-gray-600">
          Performance data will appear after requests run.
        </div>
      ) : (
        <div className="mt-3 min-h-0 flex-1 rounded border border-gray-800 bg-[#111111] p-3">
          <div className="mb-3 text-[10px] uppercase tracking-wide text-gray-500">Recent latency</div>
          <div className="space-y-2">
            {recentEntries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2">
                <span className="w-14 truncate text-gray-400">{entry.method}</span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-gray-800">
                  <div
                    className={`h-full rounded ${entry.error || entry.status === 0 || entry.status >= 400 ? 'bg-rose-400' : 'bg-[#ff6c37]'}`}
                    style={{ width: `${Math.max(2, (entry.durationMs / maxDuration) * 100)}%` }}
                  />
                </div>
                <span className="w-16 text-right text-gray-300">{entry.durationMs} ms</span>
                <span className="w-20 truncate text-right text-gray-600">{entry.domain}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
