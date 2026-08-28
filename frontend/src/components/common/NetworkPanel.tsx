import { useDevToolsStore } from '../../stores/devToolsStore';

function formatBytes(bytes: number) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function methodClass(method: string) {
  switch (method) {
    case 'GET': return 'text-emerald-300';
    case 'POST': return 'text-sky-300';
    case 'PUT':
    case 'PATCH': return 'text-amber-300';
    case 'DELETE': return 'text-rose-300';
    default: return 'text-gray-300';
  }
}

function statusClass(status: number) {
  if (status >= 200 && status < 300) return 'text-emerald-300';
  if (status >= 300 && status < 400) return 'text-sky-300';
  if (status >= 400 && status < 500) return 'text-amber-300';
  return 'text-rose-300';
}

export function NetworkPanel() {
  const entries = useDevToolsStore((state) => state.networkEntries);
  const clearNetworkEntries = useDevToolsStore((state) => state.clearNetworkEntries);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0b0b] font-mono text-xs text-gray-300">
      <div className="flex h-8 flex-shrink-0 items-center border-b border-gray-800 px-3">
        <span className="text-gray-400">{entries.length} request{entries.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          onClick={clearNetworkEntries}
          disabled={entries.length === 0}
          className="ml-auto text-gray-500 hover:text-gray-200 disabled:cursor-default disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-gray-600">
          Send a request to capture network activity.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-[#171717] text-[10px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 font-medium">Path</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Size</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-gray-900 hover:bg-[#191919]" title={entry.error || entry.url}>
                  <td className={`whitespace-nowrap px-3 py-2 font-semibold ${methodClass(entry.method)}`}>{entry.method}</td>
                  <td className={`whitespace-nowrap px-3 py-2 font-semibold ${statusClass(entry.status)}`}>
                    {entry.status || 'ERR'}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-gray-300">{entry.domain}</td>
                  <td className="max-w-[320px] truncate px-3 py-2 text-gray-400">{entry.path}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                    {new Date(entry.startedAt).toLocaleTimeString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-300">{entry.durationMs} ms</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">{formatBytes(entry.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

