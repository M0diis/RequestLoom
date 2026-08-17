import { useEffect, useState } from 'react';
import type { HistoryEntry } from '../../types';
import { historyApi } from '../../services/api';
import { useRequestStore } from '../../stores/requestStore';

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-300',
  PATCH: 'text-violet-300',
  DELETE: 'text-rose-400',
  OPTIONS: 'text-gray-400',
  HEAD: 'text-gray-400',
};

interface Props {
  workspaceId: string;
  requestId: string;
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
    const shortPath = parsed.pathname.length > 44 ? `${parsed.pathname.slice(0, 41)}...` : parsed.pathname;
    return `${parsed.host}${shortPath}`;
  } catch {
    return url.length > 64 ? `${url.slice(0, 61)}...` : url;
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

export function RequestHistoryTab({ workspaceId, requestId }: Props) {
  const { setResponseFromHistory, clearResponse } = useRequestStore();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await historyApi.getAll(workspaceId, {
        requestId,
        limit: 80,
      });

      // Keep the Runs tab strictly scoped to the active request even if the API returns mixed rows.
      const ownRows = rows.filter((entry) => entry.requestId === requestId);
      setEntries(ownRows);

      if (ownRows.length === 0) {
        setSelectedEntryId(null);
      } else if (!selectedEntryId || !ownRows.some((entry) => entry.id === selectedEntryId)) {
        setSelectedEntryId(ownRows[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load request history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries();
  }, [workspaceId, requestId]);

  useEffect(() => {
    const handleHistoryUpdate = () => {
      void loadEntries();
    };

    window.addEventListener('history:updated', handleHistoryUpdate);
    return () => window.removeEventListener('history:updated', handleHistoryUpdate);
  }, [workspaceId, requestId]);

  useEffect(() => {
    if (!selectedEntryId) return;

    setError(null);
    historyApi.getById(workspaceId, selectedEntryId)
      .then((entry) => {
        setResponseFromHistory(entry);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load execution details');
      });
  }, [setResponseFromHistory, workspaceId, selectedEntryId]);

  useEffect(() => {
    if (!showClearConfirm) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !clearing) {
        setShowClearConfirm(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showClearConfirm, clearing]);

  const handleClearHistory = async () => {
    if (clearing) return;

    setClearing(true);
    setError(null);
    try {
      await historyApi.clearForRequest(workspaceId, requestId);
      setSelectedEntryId(null);
      clearResponse(requestId);
      setShowClearConfirm(false);
      window.dispatchEvent(new CustomEvent('history:updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear request history');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="grid h-full min-h-[260px] overflow-hidden border border-gray-800 bg-[#101010]">
      <div className="border-b border-gray-800 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 border-b border-gray-800 bg-[#1b1b1b] px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Request History</div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="ml-auto border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-200 hover:bg-gray-800"
              disabled={loading || clearing || entries.length === 0}
            >
              Clear History
            </button>

            <button
              type="button"
              onClick={() => {
                void loadEntries();
              }}
              className="ml-auto border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-200 hover:bg-gray-800"
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="border-b border-rose-900 bg-rose-950/20 px-3 py-2 text-[11px] text-rose-300">
            {error}
          </div>
        )}

        <div className="max-h-[380px] overflow-y-auto lg:max-h-none lg:h-[calc(100%-41px)]">
          {loading && entries.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-500">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-500">No executions yet for this request.</div>
          ) : (
            entries.map((entry) => {
              const isSelected = entry.id === selectedEntryId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedEntryId(entry.id)}
                  className={`w-full border-b border-gray-900/80 px-3 py-2 text-left ${
                    isSelected ? 'bg-gray-800/70' : 'hover:bg-gray-900/40'
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px]">
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
              );
            })
          )}
        </div>
      </div>
      {showClearConfirm && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target && !clearing) setShowClearConfirm(false);
          }}
        >
          <div className="w-full max-w-md border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
            <div className="border-b border-gray-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-100">Clear Request History</h3>
              <p className="mt-1 text-xs text-gray-500">
                This will permanently delete all {entries.length} history {entries.length === 1 ? 'entry' : 'entries'} for this request. This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-800 bg-[#1a1a1a] px-4 py-3">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                disabled={clearing}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleClearHistory();
                }}
                className="border border-rose-900 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-950/50 disabled:opacity-50"
                disabled={clearing}
              >
                {clearing ? 'Clearing...' : 'Clear History'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
