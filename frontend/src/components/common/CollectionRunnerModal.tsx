import { useState } from 'react';
import { collectionRunnerApi } from '../../services/api';
import { useRequestStore } from '../../stores/requestStore';
import type { CollectionRunResult } from '../../types';

interface Props {
  onClose: () => void;
  serviceId: string;
}

export function CollectionRunnerModal({ onClose, serviceId }: Props) {
  const { services } = useRequestStore();
  const service = services.find(s => s.id === serviceId);

  const [result, setResult] = useState<CollectionRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopOnFailure, setStopOnFailure] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await collectionRunnerApi.runService(serviceId, stopOnFailure);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Collection run failed');
    } finally {
      setRunning(false);
    }
  };

  const passedCount = result?.passedRequests ?? 0;
  const failedCount = result?.failedRequests ?? 0;
  const totalCount = result?.totalRequests ?? 0;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={e => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="w-full max-w-2xl max-h-[85vh] border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)] flex flex-col">
        <div className="flex items-center border-b border-gray-800 px-4 py-3 flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Run Collection</h3>
            <p className="text-[11px] text-gray-500">{service?.name} - {service?.requests.length ?? 0} request(s)</p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300" disabled={running}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-3 flex-shrink-0 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <button onClick={() => { void handleRun(); }}
              className="border border-[#ff6c37] bg-[#ff6c37] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#f95e26] disabled:opacity-50"
              disabled={running}>
              {running ? 'Running...' : 'Run All Requests'}
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
              <input type="checkbox" checked={stopOnFailure} onChange={e => setStopOnFailure(e.target.checked)} />
              Stop on failure
            </label>
          </div>
        </div>

        {/* Results summary */}
        {result && (
          <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800 bg-[#1a1a1a] flex-shrink-0">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-500">Total:</span>
              <span className="text-gray-200 font-semibold">{totalCount}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-emerald-500">Passed:</span>
              <span className="text-emerald-300 font-semibold">{passedCount}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-rose-500">Failed:</span>
              <span className="text-rose-300 font-semibold">{failedCount}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-500">Time:</span>
              <span className="text-gray-300">{result.totalTimeMs}ms</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-4 mt-3 rounded border border-rose-900/60 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Running state */}
        {running && !result && (
          <div className="flex-1 flex items-center justify-center text-xs text-gray-500 py-10">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 border-2 border-[#ff6c37] border-t-transparent rounded-full animate-spin" />
              Executing requests...
            </div>
          </div>
        )}

        {/* Results list */}
        {result && (
          <div className="overflow-y-auto flex-1">
            {result.results.map((r, i) => (
              <div key={i} className={`border-b border-gray-800/50 px-4 py-2.5 ${r.passed ? '' : 'bg-rose-950/10'}`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${r.passed ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <span className="text-[10px] font-mono font-bold text-gray-500 w-10">{r.method}</span>
                  <span className="text-xs text-gray-200 truncate flex-1">{r.requestName}</span>
                  <span className={`text-[10px] font-mono ${r.statusCode >= 400 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {r.statusCode || 'ERR'}
                  </span>
                  <span className="text-[10px] text-gray-500">{r.responseTimeMs}ms</span>
                </div>

                {r.error && (
                  <div className="mt-1 ml-4 text-[10px] text-rose-400 truncate">{r.error}</div>
                )}

                {/* Tests */}
                {r.tests.length > 0 && (
                  <div className="mt-1.5 ml-4 space-y-0.5">
                    {r.tests.map((t, ti) => (
                      <div key={ti} className="flex items-center gap-1.5 text-[10px]">
                        <span className={t.passed ? 'text-emerald-500' : 'text-rose-500'}>
                          {t.passed ? '✓' : '✗'}
                        </span>
                        <span className="text-gray-400">{t.name}</span>
                        {t.message && (
                          <span className="text-gray-600 truncate">- {t.message}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
