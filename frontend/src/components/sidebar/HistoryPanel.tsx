import { useEffect, useMemo, useState } from 'react';
import { useHistoryStore } from '../../stores/historyStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useRequestStore } from '../../stores/requestStore';
import { useUiStore } from '../../stores/uiStore';
import type { HistoryEntry, HttpMethod } from '../../types';

const METHOD_FILTERS: Array<'ALL' | HttpMethod> = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const STATUS_FILTERS = ['ALL', '2xx', '3xx', '4xx', '5xx'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-300',
  PATCH: 'text-violet-300',
  DELETE: 'text-rose-400',
  OPTIONS: 'text-gray-400',
  HEAD: 'text-gray-400',
};

function matchesStatusFilter(status: number, filter: StatusFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === '2xx') return status >= 200 && status < 300;
  if (filter === '3xx') return status >= 300 && status < 400;
  if (filter === '4xx') return status >= 400 && status < 500;
  return status >= 500;
}

function getStatusClass(status: number): string {
  if (status >= 200 && status < 300) return 'border border-emerald-900 bg-emerald-950/30 text-emerald-300';
  if (status >= 300 && status < 400) return 'border border-sky-900 bg-sky-950/30 text-sky-300';
  if (status >= 400 && status < 500) return 'border border-amber-900 bg-amber-950/30 text-amber-300';
  if (status >= 500) return 'border border-rose-900 bg-rose-950/30 text-rose-300';
  return 'border border-gray-700 bg-gray-900 text-gray-300';
}

function formatExecutedAt(value: string): string {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString([], {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function compactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const compactPath = parsed.pathname.length > 40
      ? `${parsed.pathname.slice(0, 37)}...`
      : parsed.pathname;
    return `${parsed.host}${compactPath}`;
  } catch {
    return url.length > 60 ? `${url.slice(0, 57)}...` : url;
  }
}

export function HistoryPanel() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { entries, loading, error, load, getById, remove, clearAll } = useHistoryStore();
  const { selectRequest } = useRequestStore();
  const { setSidebarTab, setServiceSettingsServiceId } = useUiStore();

  const [methodFilter, setMethodFilter] = useState<'ALL' | HttpMethod>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load(activeWorkspaceId);
  }, [activeWorkspaceId, load]);

  useEffect(() => {
    const timer = setInterval(() => {
      void load(activeWorkspaceId);
    }, 7000);

    return () => clearInterval(timer);
  }, [activeWorkspaceId, load]);

  useEffect(() => {
    const handleHistoryUpdate = () => {
      void load(activeWorkspaceId);
    };

    window.addEventListener('history:updated', handleHistoryUpdate);
    return () => window.removeEventListener('history:updated', handleHistoryUpdate);
  }, [activeWorkspaceId, load]);

  useEffect(() => {
    if (!selectedEntryId) {
      setSelectedEntry(null);
      return;
    }

    setLoadingDetails(true);
    getById(activeWorkspaceId, selectedEntryId)
      .then((entry) => setSelectedEntry(entry))
      .catch(() => setSelectedEntry(null))
      .finally(() => setLoadingDetails(false));
  }, [activeWorkspaceId, getById, selectedEntryId]);

  useEffect(() => {
    if (!selectedEntryId) return;
    if (!entries.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(null);
      setSelectedEntry(null);
    }
  }, [entries, selectedEntryId]);

  const filteredEntries = useMemo(
    () => entries.filter((entry) => {
      if (methodFilter !== 'ALL' && entry.method !== methodFilter) return false;
      return matchesStatusFilter(entry.responseStatus, statusFilter);
    }),
    [entries, methodFilter, statusFilter]
  );

  const handleRefresh = async () => {
    setBusy(true);
    try {
      await load(activeWorkspaceId);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    setBusy(true);
    try {
      await remove(activeWorkspaceId, entryId);
      if (selectedEntryId === entryId) {
        setSelectedEntryId(null);
        setSelectedEntry(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    const confirmed = window.confirm('Clear all history for this workspace?');
    if (!confirmed) return;

    setBusy(true);
    try {
      await clearAll(activeWorkspaceId);
      setSelectedEntryId(null);
      setSelectedEntry(null);
    } finally {
      setBusy(false);
    }
  };

  const openLinkedRequest = async () => {
    if (!selectedEntry?.requestId) return;

    setBusy(true);
    try {
      setServiceSettingsServiceId(null);
      await selectRequest(selectedEntry.requestId);
      setSidebarTab('services');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#111111] text-gray-200">
      <div className="border-b border-gray-800 px-3 py-2">
        <div className="mb-2 flex items-center gap-2">
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value as 'ALL' | HttpMethod)}
            className="min-w-[84px] border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-200 outline-none"
            disabled={busy}
          >
            {METHOD_FILTERS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="min-w-[74px] border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-200 outline-none"
            disabled={busy}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <button
            onClick={handleRefresh}
            disabled={busy || loading}
            className="ml-auto border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-200 hover:bg-gray-800 disabled:opacity-50"
          >
            Refresh
          </button>

          <button
            onClick={handleClear}
            disabled={busy || entries.length === 0}
            className="border border-rose-900 bg-rose-950/20 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
          >
            Clear
          </button>
        </div>

        <div className="text-[11px] text-gray-500">
          {loading ? 'Loading...' : `${filteredEntries.length} / ${entries.length} entries`}
        </div>

        {error && (
          <div className="mt-2 border border-rose-900 bg-rose-950/20 px-2 py-1 text-[11px] text-rose-300">
            {error}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <div className="px-3 py-4 text-xs text-gray-500">
            No history entries yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-900/70">
            {filteredEntries.map((entry) => {
              const selected = selectedEntryId === entry.id;
              return (
                <button
                  key={entry.id}
                  onClick={() => setSelectedEntryId(entry.id)}
                  className={`w-full border-l-2 px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-slate-300 bg-gray-900/80'
                      : 'border-transparent bg-[#111111] hover:bg-gray-900/40'
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px]">
                    <span className={`border border-gray-700 bg-gray-900 px-1.5 py-0.5 font-mono ${METHOD_COLORS[entry.method] ?? 'text-gray-200'}`}>
                      {entry.method}
                    </span>
                    <span className={`px-1.5 py-0.5 font-mono ${getStatusClass(entry.responseStatus)}`}>
                      {entry.responseStatus}
                    </span>
                    <span className="ml-auto text-gray-500">{entry.responseTimeMs} ms</span>
                  </div>

                  <div className="truncate font-mono text-[11px] text-gray-300" title={entry.url}>
                    {compactUrl(entry.url)}
                  </div>

                  <div className="mt-1 text-[10px] text-gray-500">
                    {formatExecutedAt(entry.executedAt)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 p-3">
        {loadingDetails ? (
          <div className="text-[11px] text-gray-500">Loading details...</div>
        ) : !selectedEntry ? (
          <div className="text-[11px] text-gray-500">Select an entry to inspect request and response details.</div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`border border-gray-700 bg-gray-900 px-1.5 py-0.5 font-mono text-[10px] ${METHOD_COLORS[selectedEntry.method] ?? 'text-gray-200'}`}>
                {selectedEntry.method}
              </span>
              <span className={`px-1.5 py-0.5 font-mono text-[10px] ${getStatusClass(selectedEntry.responseStatus)}`}>
                {selectedEntry.responseStatus}
              </span>
              <span className="ml-auto text-[10px] text-gray-500">{selectedEntry.responseTimeMs} ms</span>
            </div>

            <div className="max-h-16 overflow-y-auto border border-gray-800 bg-gray-950/60 px-2 py-1 font-mono text-[10px] text-gray-400">
              {selectedEntry.url}
            </div>

            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => void handleDeleteEntry(selectedEntry.id)}
                disabled={busy}
                className="border border-rose-900 bg-rose-950/20 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
              >
                Delete Entry
              </button>

              <button
                onClick={openLinkedRequest}
                disabled={busy || !selectedEntry.requestId}
                className="border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-200 hover:bg-gray-800 disabled:opacity-50"
              >
                Open Request
              </button>
            </div>

            {selectedEntry.responseBody && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Response Preview</div>
                <pre className="max-h-32 overflow-y-auto border border-gray-800 bg-gray-950/60 p-2 font-mono text-[10px] text-gray-400 whitespace-pre-wrap break-words">
                  {selectedEntry.responseBody.slice(0, 1200)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
