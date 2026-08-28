import { useState, useEffect, useCallback } from 'react';
import { toolsApi } from '../../services/api';
import type { AuthRequest, CodeSnippet, KeyValuePairRequest } from '../../types';

interface Props {
  onClose: () => void;
  method: string;
  url: string;
  body?: string | null;
  bodyType: string;
  headers: KeyValuePairRequest[];
  params?: KeyValuePairRequest[];
  variables?: KeyValuePairRequest[];
  auth?: AuthRequest | null;
  workspaceId?: string;
  serviceId?: string;
  requestId?: string;
}

export function CodeSnippetsModal({ onClose, method, url, body, bodyType, headers, params = [], variables = [], auth, workspaceId, serviceId, requestId }: Props) {
  const [snippets, setSnippets] = useState<CodeSnippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedLang, setCopiedLang] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await toolsApi.generateSnippets({ method, url, body, bodyType, headers, params, variables, auth, workspaceId, serviceId, requestId });
      setSnippets(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate snippets');
    } finally {
      setLoading(false);
    }
  }, [method, url, body, bodyType, headers, params, variables, auth, workspaceId, serviceId, requestId]);

  useEffect(() => { load(); }, [load]);

  const copyCode = (code: string, lang: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedLang(lang);
      setTimeout(() => setCopiedLang(null), 2000);
    }).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={e => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="w-full max-w-2xl max-h-[85vh] border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)] flex flex-col">
        <div className="flex items-center border-b border-gray-800 px-4 py-3 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-100">Code Snippets</h3>
          <span className="ml-2 text-[11px] text-gray-500 font-mono">{method} {url.substring(0, 50)}</span>
          <div className="flex-1" />
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4 flex-1">
          <div className="flex items-center justify-between border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
            <span>Snapshots resolve variables and may contain secrets.</span>
            <button onClick={load} className="ml-3 flex-shrink-0 border border-amber-800 px-2 py-1 text-[10px] hover:bg-amber-900/40">Regenerate</button>
          </div>
          {loading && <div className="text-xs text-gray-500 text-center py-6">Generating snippets...</div>}
          {error && <div className="rounded border border-rose-900/60 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">{error}</div>}

          {snippets.map((s) => (
            <div key={s.language + s.client} className="border border-gray-800 bg-[#1a1a1a] rounded">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-200">{s.language}</span>
                  <span className="text-[10px] text-gray-500">({s.client})</span>
                </div>
                <button
                  onClick={() => copyCode(s.code, s.language + s.client)}
                  className="border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  {copiedLang === s.language + s.client ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="p-3 text-[11px] font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                {s.code}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
