import { useState, useMemo } from 'react';
import axios from 'axios';
import { toolsApi, importsApi } from '../../services/api';
import { useRequestStore } from '../../stores/requestStore';
import type { CurlParseResult } from '../../types';
import { DocumentationLink, DocHelpButton } from '../documentation/DocumentationLink';

interface Props {
  onClose: () => void;
  workspaceId: string;
}

type ImportKind = 'openapi' | 'wsdl' | 'curl' | 'postman' | 'bruno';
type SourceType = 'url' | 'raw';

const KIND_LABELS: Record<ImportKind, string> = {
  openapi: 'OpenAPI',
  wsdl: 'WSDL',
  curl: 'cURL',
  postman: 'Postman',
  bruno: 'Bruno',
};

const BTN_PRIMARY = 'border border-[#ff6c37] bg-[#ff6c37] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#f95e26] disabled:opacity-50';
const BTN_SECONDARY = 'border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50';
const SELECT_CLASS = 'border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-gray-500';
const INPUT_CLASS = 'w-full border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-100 outline-none focus:border-gray-500';

export function ImportModal({ onClose, workspaceId }: Props) {
  const { services, createService, createRequest, loadServices } = useRequestStore();

  const [kind, setKind] = useState<ImportKind>('openapi');

  // Import kind & source
  const [sourceType, setSourceType] = useState<SourceType>('url');
  const [source, setSource] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [specBusy, setSpecBusy] = useState(false);
  const [specResult, setSpecResult] = useState<string | null>(null);

  // Bruno files
  const [brunoFiles, setBrunoFiles] = useState<File[]>([]);
  const [brunoBusy, setBrunoBusy] = useState(false);

  // cURL input
  const [curlText, setCurlText] = useState('');
  const [curlBusy, setCurlBusy] = useState(false);
  const [parsed, setParsed] = useState<CurlParseResult | null>(null);
  const [curlImporting, setCurlImporting] = useState(false);

  // Shared state
  const [error, setError] = useState<string | null>(null);

  const isCurl = kind === 'curl';
  const isPostman = kind === 'postman';
  const isBruno = kind === 'bruno';
  const busy = specBusy || curlBusy || curlImporting || brunoBusy;

  const handleSpecImport = async () => {
    if (!source.trim()) return;
    setSpecBusy(true);
    setError(null);
    setSpecResult(null);
    try {
      const payload = {
        sourceType: isPostman ? 'raw' : sourceType,
        source: source.trim(),
        serviceId: serviceId || null,
        serviceName: serviceId ? null : (serviceName.trim() || null),
      };

      const result = kind === 'openapi'
        ? await importsApi.openApi(workspaceId, payload)
        : kind === 'wsdl'
          ? await importsApi.wsdl(workspaceId, payload)
          : await importsApi.postman(workspaceId, payload);

      await loadServices(workspaceId);

      const warnings = result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : '';
      setSpecResult(`Imported ${result.createdRequests} request(s)${warnings}.`);
      setSource('');
      setServiceName('');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: string } | undefined)?.error;
        setError(msg ? `Import failed: ${msg}` : `Import failed: ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : 'Import failed');
      }
    } finally {
      setSpecBusy(false);
    }
  };

  const handlePostmanFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setSpecResult(null);
    try {
      setSource(await file.text());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file');
    }
  };

  const handleBrunoImport = async () => {
    if (brunoFiles.length === 0) return;
    setBrunoBusy(true);
    setError(null);
    setSpecResult(null);
    try {
      const result = await importsApi.bruno(
        workspaceId,
        brunoFiles,
        serviceId || undefined,
        serviceId ? undefined : (serviceName.trim() || undefined),
      );

      await loadServices(workspaceId);

      const warnings = result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : '';
      setSpecResult(`Imported ${result.createdRequests} request(s)${warnings}.`);
      setBrunoFiles([]);
      setServiceName('');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: string } | undefined)?.error;
        setError(msg ? `Import failed: ${msg}` : `Import failed: ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : 'Import failed');
      }
    } finally {
      setBrunoBusy(false);
    }
  };

  const handleCurlParse = async () => {
    if (!curlText.trim()) return;
    setCurlBusy(true);
    setError(null);
    setParsed(null);
    try {
      const result = await toolsApi.parseCurl(curlText.trim());
      setParsed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse cURL');
    } finally {
      setCurlBusy(false);
    }
  };

  const handleCurlImport = async () => {
    if (!parsed) return;
    setCurlImporting(true);
    setError(null);
    try {
      let targetServiceId = '';
      const SvcName = parsed.serviceName || 'Imported';
      const existing = services.find(s => s.name === SvcName);
      if (existing) {
        targetServiceId = existing.id;
      } else {
        const svc = await createService(workspaceId, SvcName);
        targetServiceId = svc.id;
      }

      const req = await createRequest(targetServiceId, parsed.url || 'Imported Request', parsed.method || 'GET');

      const { updateRequest, selectRequest } = useRequestStore.getState();
      await updateRequest(req.id, {
        url: parsed.url,
        method: parsed.method as any,
        headers: parsed.headers.map(h => ({
          id: crypto.randomUUID(), key: h.key, value: h.value, enabled: h.enabled,
        })),
        body: parsed.body ?? null,
        bodyType: parsed.bodyType as any,
        auth: parsed.auth ? {
          id: crypto.randomUUID(), requestId: req.id,
          authType: parsed.auth.authType as any, configJson: parsed.auth.configJson,
        } : null,
      });

      await selectRequest(req.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import request');
    } finally {
      setCurlImporting(false);
    }
  };

  const close = () => { if (!busy) onClose(); };

  const parsedSummary = useMemo(() => {
    if (!parsed) return null;
    return { method: parsed.method, url: parsed.url, headers: parsed.headers.length, body: parsed.body, auth: parsed.auth?.authType };
  }, [parsed]);

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={e => { if (e.currentTarget === e.target) close(); }}>
      <div className="flex h-[min(340px,65vh)] w-full max-w-xl flex-col border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
        {/* Header with kind tabs */}
        <div className="flex items-center border-b border-gray-800">
          <div className="flex flex-wrap">
            {(Object.keys(KIND_LABELS) as ImportKind[]).map(k => (
              <button
                key={k}
                onClick={() => { setKind(k); setError(null); setSpecResult(null); setParsed(null); setCurlText(''); setSource(''); setBrunoFiles([]); }}
                className={`px-4 py-2.5 text-xs font-medium transition-colors border-r border-gray-800 ${
                  kind === k
                    ? 'bg-[#1a1a1a] text-[#ffbca3] border-b-2 border-[#ff6c37] -mb-px'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900/50'
                }`}
                disabled={busy}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
            <DocumentationLink section="imports" onNavigate={close} />
            <DocHelpButton section="imports" onNavigate={close} />
          </div>
          <button onClick={close} className="px-3 py-2.5 text-gray-500 hover:text-gray-300" disabled={busy}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* OpenAPI / WSDL */}
          {!isCurl && !isBruno && !isPostman && (
            <>
              <p className="text-xs text-gray-500">
                Import an {KIND_LABELS[kind]} specification from a URL or paste the raw content.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={sourceType}
                  onChange={e => setSourceType(e.target.value as SourceType)}
                  className={SELECT_CLASS}
                  disabled={busy}
                >
                  <option value="url">URL</option>
                  <option value="raw">Raw Content</option>
                </select>
                <select
                  value={serviceId}
                  onChange={e => setServiceId(e.target.value)}
                  className={SELECT_CLASS}
                  disabled={busy}
                >
                  <option value="">Create new service</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {!serviceId && (
                <input
                  type="text"
                  value={serviceName}
                  onChange={e => setServiceName(e.target.value)}
                  placeholder="New service name (optional)"
                  className={INPUT_CLASS}
                  disabled={busy}
                />
              )}

              {sourceType === 'url' ? (
                <input
                  type="text"
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  placeholder="https://example.com/openapi.json"
                  className={INPUT_CLASS}
                  disabled={busy}
                />
              ) : (
                <textarea
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  placeholder={`Paste ${KIND_LABELS[kind]} specification content…`}
                  className={`${INPUT_CLASS} h-32 font-mono resize-none`}
                  disabled={busy}
                />
              )}
            </>
          )}

          {/* Postman / Bruno */}
          {(isPostman || isBruno) && (
            <>
              <p className="text-xs text-gray-500">
                {isPostman
                  ? 'Select a Postman collection JSON file to import all of its requests.'
                  : "Select one or more Bruno request files (.bru, including folders' files) to import them."}
              </p>

              <label className="flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-gray-600 bg-gray-900/50 px-3 py-3 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-200">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {isPostman
                  ? (source ? 'Replace collection file' : 'Choose a Postman collection (.json)')
                  : (brunoFiles.length > 0 ? `${brunoFiles.length} file(s) selected` : 'Choose .bru file(s)')}
                <input
                  type="file"
                  accept={isPostman ? '.json,application/json' : '.bru'}
                  multiple={!isPostman}
                  className="hidden"
                  disabled={busy}
                  onChange={e => {
                    if (isPostman) {
                      void handlePostmanFile(e.target.files?.[0]);
                    } else {
                      setBrunoFiles([...(e.target.files ?? [])]);
                    }
                  }}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={serviceId}
                  onChange={e => setServiceId(e.target.value)}
                  className={SELECT_CLASS}
                  disabled={busy}
                >
                  <option value="">Create new service</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {!serviceId && (
                  <input
                    type="text"
                    value={serviceName}
                    onChange={e => setServiceName(e.target.value)}
                    placeholder="New service name (optional)"
                    className={INPUT_CLASS}
                    disabled={busy}
                  />
                )}
              </div>

              {isPostman && source && (
                <textarea
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  placeholder="Paste Postman collection content…"
                  className={`${INPUT_CLASS} h-32 font-mono resize-none`}
                  disabled={busy}
                />
              )}
            </>
          )}

          {/* cURL */}
          {isCurl && (
            <>
              <p className="text-xs text-gray-500">
                Paste a cURL command to create a request. Headers, body, auth, and method are auto-detected.
              </p>
              <textarea
                value={curlText}
                onChange={e => setCurlText(e.target.value)}
                placeholder={'curl -X POST \'https://api.example.com/users\' \\\n  -H \'Content-Type: application/json\' \\\n  -d \'{"name":"John"}\''}
                className={`${INPUT_CLASS} h-24 font-mono resize-none`}
                disabled={busy}
              />

              {/* cURL parse preview */}
              {parsedSummary && (
                <div className="rounded border border-gray-700 bg-gray-900/50 p-3 space-y-1.5 text-[11px]">
                  <div className="flex gap-2">
                    <span className="text-gray-500">Method:</span>
                    <span className="text-gray-200 font-mono font-bold">{parsedSummary.method}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-500">URL:</span>
                    <span className="text-gray-200 font-mono truncate">{parsedSummary.url}</span>
                  </div>
                  {parsedSummary.headers > 0 && (
                    <div className="flex gap-2">
                      <span className="text-gray-500">Headers:</span>
                      <span className="text-gray-300">{parsedSummary.headers}</span>
                    </div>
                  )}
                  {parsedSummary.body && (
                    <div className="flex gap-2">
                      <span className="text-gray-500">Body:</span>
                      <span className="text-gray-300 truncate">{parsedSummary.body.substring(0, 120)}</span>
                    </div>
                  )}
                  {parsedSummary.auth && (
                    <div className="flex gap-2">
                      <span className="text-gray-500">Auth:</span>
                      <span className="text-gray-300">{parsedSummary.auth}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Error / Result */}
          {error && (
            <div className="rounded border border-rose-900/60 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}
          {specResult && (
            <div className="rounded border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
              {specResult}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-800 bg-[#1a1a1a] px-4 py-3">
          <button onClick={close} className={BTN_SECONDARY} disabled={busy}>
            Close
          </button>
          {isCurl ? (
            parsedSummary ? (
              <button onClick={() => { void handleCurlImport(); }} className={BTN_PRIMARY} disabled={curlImporting}>
                {curlImporting ? 'Importing...' : 'Import Request'}
              </button>
            ) : (
              <button onClick={() => { void handleCurlParse(); }} className={BTN_PRIMARY} disabled={curlBusy || !curlText.trim()}>
                {curlBusy ? 'Parsing...' : 'Parse'}
              </button>
            )
          ) : isBruno ? (
            <button onClick={() => { void handleBrunoImport(); }} className={BTN_PRIMARY} disabled={brunoBusy || brunoFiles.length === 0}>
              {brunoBusy ? 'Importing...' : `Import ${KIND_LABELS[kind]}`}
            </button>
          ) : (
            <button onClick={() => { void handleSpecImport(); }} className={BTN_PRIMARY} disabled={specBusy || !source.trim()}>
              {specBusy ? 'Importing...' : `Import ${KIND_LABELS[kind]}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
