import { useEffect, useMemo, useState } from 'react';
import { useHistoryStore } from '../../stores/historyStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useRequestStore } from '../../stores/requestStore';
import { useUiStore } from '../../stores/uiStore';
import type { HistoryEntry, HttpMethod } from '../../types';
import { ResponseDiffPanel } from './ResponseDiffPanel';

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

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'border border-emerald-900 bg-emerald-950/30 text-emerald-300';
  if (status >= 300 && status < 400) return 'border border-sky-900 bg-sky-950/30 text-sky-300';
  if (status >= 400 && status < 500) return 'border border-amber-900 bg-amber-950/30 text-amber-300';
  if (status >= 500) return 'border border-rose-900 bg-rose-950/30 text-rose-300';
  return 'border border-gray-700 bg-gray-900 text-gray-300';
}

function compactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const shortPath = parsed.pathname.length > 48 ? `${parsed.pathname.slice(0, 45)}...` : parsed.pathname;
    return `${parsed.host}${shortPath}`;
  } catch {
    return url.length > 72 ? `${url.slice(0, 69)}...` : url;
  }
}

function normalizeDate(value: string): string {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;

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

export function HistoryPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { entries, loading, error, load, getById, clearAll, remove } = useHistoryStore();
  const { selectRequest, setResponseFromHistory } = useRequestStore();
  const { setSidebarTab, setServiceSettingsServiceId } = useUiStore();

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [methodFilter, setMethodFilter] = useState<'ALL' | HttpMethod>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [compareEntryIds, setCompareEntryIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<[HistoryEntry, HistoryEntry] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [comparisonError, setErrorForComparison] = useState<string | null>(null);

  useEffect(() => {
    void load(activeWorkspaceId);
    setCompareEntryIds([]);
    setComparison(null);
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

  const filteredEntries = useMemo(
    () => entries.filter((entry) => {
      if (methodFilter !== 'ALL' && entry.method !== methodFilter) return false;
      return matchesStatusFilter(entry.responseStatus, statusFilter);
    }),
    [entries, methodFilter, statusFilter]
  );

  useEffect(() => {
    const visibleIds = new Set(filteredEntries.map((entry) => entry.id));
    setCompareEntryIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [filteredEntries]);

  const selectedSummary = useMemo(
    () => filteredEntries.find((entry) => entry.id === selectedEntryId) ?? null,
    [filteredEntries, selectedEntryId]
  );

  const refresh = async () => {
    setBusy(true);
    try {
      await load(activeWorkspaceId);
    } finally {
      setBusy(false);
    }
  };

  const clearHistory = async () => {
    const confirmed = window.confirm('Clear all history for this workspace?');
    if (!confirmed) return;

    setBusy(true);
    try {
      await clearAll(activeWorkspaceId);
      setSelectedEntryId(null);
      setSelectedEntry(null);
      setCompareEntryIds([]);
      setComparison(null);
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (entryId: string) => {
    setBusy(true);
    try {
      await remove(activeWorkspaceId, entryId);
      if (selectedEntryId === entryId) {
        setSelectedEntryId(null);
        setSelectedEntry(null);
      }
      if (compareEntryIds.includes(entryId)) {
        setCompareEntryIds((current) => current.filter((id) => id !== entryId));
        setComparison(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleCompareEntry = (entryId: string) => {
    setComparison(null);
    setErrorForComparison(null);
    setCompareEntryIds((current) => {
      if (current.includes(entryId)) return current.filter((id) => id !== entryId);
      if (current.length >= 2) return current;
      return [...current, entryId];
    });
  };

  const compareSelectedEntries = async () => {
    if (compareEntryIds.length !== 2 || comparing) return;

    setComparing(true);
    setErrorForComparison(null);
    try {
      const [left, right] = await Promise.all(
        compareEntryIds.map((entryId) => getById(activeWorkspaceId, entryId)),
      );
      setComparison([left, right]);
    } catch (err) {
      setErrorForComparison(err instanceof Error ? err.message : 'Failed to load responses for comparison');
    } finally {
      setComparing(false);
    }
  };

  const openRequest = async () => {
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
    <div className="flex h-full flex-col overflow-hidden bg-[#0c0c0c] text-gray-200">
      <div className="border-b border-gray-800 bg-[#1b1b1b] px-4 py-3">
        <div className="mb-2 text-sm font-semibold">Execution History</div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value as 'ALL' | HttpMethod)}
            className="min-w-[90px] border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 outline-none"
            disabled={busy}
          >
            {METHOD_FILTERS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="min-w-[80px] border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 outline-none"
            disabled={busy}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
            className="border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50"
            disabled={busy || loading}
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={() => {
              void compareSelectedEntries();
            }}
            className="border border-[#ff6c37]/70 bg-[#ff6c37]/10 px-2 py-1 text-xs text-[#ffb59a] hover:bg-[#ff6c37]/20 disabled:opacity-50"
            disabled={compareEntryIds.length !== 2 || comparing || busy}
          >
            {comparing ? 'Comparing...' : `Compare (${compareEntryIds.length}/2)`}
          </button>

          {compareEntryIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setCompareEntryIds([]);
                setComparison(null);
                setErrorForComparison(null);
              }}
              className="border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-400 hover:bg-gray-800"
            >
              Clear selection
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              void clearHistory();
            }}
            className="border border-rose-900 bg-rose-950/20 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
            disabled={busy || entries.length === 0}
          >
            Clear Workspace History
          </button>

          <div className="ml-auto text-xs text-gray-500">
            {loading ? 'Loading...' : `${filteredEntries.length} / ${entries.length} entries`}
          </div>
        </div>
      </div>

      {error && (
        <div className="border-b border-rose-900 bg-rose-950/20 px-4 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      {comparisonError && (
        <div className="border-b border-rose-900 bg-rose-950/20 px-4 py-2 text-xs text-rose-300">
          {comparisonError}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[460px_1fr]">
        <div className="min-h-0 overflow-y-auto border-b border-gray-800 lg:border-b-0 lg:border-r">
          {filteredEntries.length === 0 ? (
            <div className="px-4 py-5 text-xs text-gray-500">No history entries found.</div>
          ) : (
            filteredEntries.map((entry) => {
              const isSelected = entry.id === selectedEntryId;
              const isMarkedForCompare = compareEntryIds.includes(entry.id);
              return (
                <div
                  key={entry.id}
                  className={`flex w-full items-start gap-2 border-b border-gray-900/80 px-4 py-2 text-left ${
                    isSelected ? 'bg-gray-800/70' : 'hover:bg-gray-900/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isMarkedForCompare}
                    onChange={() => toggleCompareEntry(entry.id)}
                    className="mt-1 h-3.5 w-3.5 accent-[#ff6c37]"
                    aria-label={`Select ${normalizeDate(entry.executedAt)} for comparison`}
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedEntryId(entry.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs">
                      <span className={`border border-gray-700 bg-gray-900 px-1.5 py-0.5 font-mono ${METHOD_COLORS[entry.method] ?? 'text-gray-200'}`}>
                        {entry.method}
                      </span>
                      <span className={`px-1.5 py-0.5 font-mono ${statusClass(entry.responseStatus)}`}>
                        {entry.responseStatus}
                      </span>
                      <span className="ml-auto text-gray-500">{entry.responseTimeMs} ms</span>
                    </div>
                    <div className="truncate font-mono text-[11px] text-gray-300" title={entry.url}>
                      {compactUrl(entry.url)}
                    </div>
                    <div className="mt-1 text-[10px] text-gray-500">{normalizeDate(entry.executedAt)}</div>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          {comparison ? (
            <ResponseDiffPanel
              left={comparison[0]}
              right={comparison[1]}
              onClose={() => setComparison(null)}
            />
          ) : comparing ? (
            <div className="text-xs text-gray-500">Loading responses for comparison...</div>
          ) : loadingDetails ? (
            <div className="text-xs text-gray-500">Loading details...</div>
          ) : !selectedSummary ? (
            <div className="text-xs text-gray-500">Select an entry to inspect request and response details.</div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`border border-gray-700 bg-gray-900 px-1.5 py-0.5 font-mono text-xs ${METHOD_COLORS[selectedSummary.method] ?? 'text-gray-200'}`}>
                  {selectedSummary.method}
                </span>
                <span className={`px-1.5 py-0.5 font-mono text-xs ${statusClass(selectedSummary.responseStatus)}`}>
                  {selectedSummary.responseStatus}
                </span>
                <span className="ml-auto text-xs text-gray-500">{selectedSummary.responseTimeMs} ms</span>
              </div>

              <div className="border border-gray-800 bg-gray-950/70 px-2 py-1 font-mono text-[11px] text-gray-400 break-all">
                {selectedSummary.url}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedEntry) {
                      setResponseFromHistory(selectedEntry);
                    }
                  }}
                  className="border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                  disabled={!selectedEntry}
                >
                  Show In Response Viewer
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void openRequest();
                  }}
                  className="border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                  disabled={busy || !selectedEntry?.requestId}
                >
                  Open Request
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (selectedSummary) {
                      void deleteEntry(selectedSummary.id);
                    }
                  }}
                  className="border border-rose-900 bg-rose-950/20 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
                  disabled={busy}
                >
                  Delete Entry
                </button>
              </div>

              {selectedEntry?.responseBody && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Response Preview</div>
                  <pre className="max-h-[520px] overflow-y-auto border border-gray-800 bg-gray-950/70 p-2 font-mono text-[11px] text-gray-300 whitespace-pre-wrap break-words">
                    {selectedEntry.responseBody.slice(0, 24000)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
