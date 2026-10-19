import { useEffect, useMemo, useRef, useState } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { useRequestStore } from '../../stores/requestStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useUiStore, type ResponseViewMode } from '../../stores/uiStore';
import { copyWithToast, toast } from '../../stores/toastStore';
import { withShortcut } from '../../lib/shortcuts';
import { CodeEditor } from '../common/CodeEditor';
import { JsonTreeView, type JsonValue } from './JsonTreeView';
import type { ExecuteResponse } from '../../types';
import { html as beautifyHtml } from 'js-beautify';

type MonacoEditorInstance = Parameters<OnMount>[0];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getStatusClass(code: number): string {
  if (code >= 200 && code < 300) return 'border border-emerald-900 bg-emerald-950/30 text-emerald-300';
  if (code >= 300 && code < 400) return 'border border-sky-900 bg-sky-950/30 text-sky-300';
  if (code >= 400 && code < 500) return 'border border-amber-900 bg-amber-950/30 text-amber-300';
  if (code >= 500) return 'border border-rose-900 bg-rose-950/30 text-rose-300';
  return 'border border-gray-700 bg-gray-900 text-gray-300';
}

function detectLanguage(contentType: string, body: string): string {
  if (contentType.includes('json') || body.trimStart().startsWith('{') || body.trimStart().startsWith('[')) return 'json';
  if (contentType.includes('html') || body.trimStart().toLowerCase().startsWith('<!doctype html') || body.trimStart().toLowerCase().startsWith('<html')) return 'html';
  if (contentType.includes('xml') || body.trimStart().startsWith('<')) return 'xml';
  return 'plaintext';
}

function formatBody(body: string, language: string): string {
  if (language === 'json') {
    try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
  }

  if (language === 'xml' || language === 'html') {
    try {
      return beautifyHtml(body, {
        indent_size: 2,
        wrap_line_length: 120,
        preserve_newlines: false,
        end_with_newline: false,
      });
    } catch {
      return body;
    }
  }

  return body;
}

const FILE_EXTENSIONS: Record<string, string> = { json: 'json', html: 'html', xml: 'xml', plaintext: 'txt' };

function formatHeaders(headers: Record<string, string[]>) {
  return Object.entries(headers).map(([key, values]) => `${key}: ${values.join(', ')}`).join('\n');
}

function downloadText(content: string, fileName: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType || 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function InFlightPanel({ startedAt, onCancel }: { startedAt: number; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, now - startedAt);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 animate-spin border-2 border-gray-400 border-t-transparent" aria-hidden="true" />
        <span className="text-sm">Sending request…</span>
        <span className="font-mono text-sm tabular-nums text-gray-300">
          {elapsed < 1000 ? `${elapsed} ms` : `${(elapsed / 1000).toFixed(1)} s`}
        </span>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="border border-rose-900 bg-rose-950/30 px-3 py-1 text-xs font-medium text-rose-300 hover:bg-rose-950/50"
      >
        Cancel
      </button>
    </div>
  );
}

function CopyAsMenu({ response, displayBody }: { response: ExecuteResponse; displayBody: string }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const options: { label: string; text: () => string; toast: string }[] = [
    { label: 'Raw body', text: () => response.body, toast: 'Body copied' },
    { label: 'Formatted body', text: () => displayBody, toast: 'Formatted body copied' },
    { label: 'Headers', text: () => formatHeaders(response.headers), toast: 'Headers copied' },
    {
      label: 'Full HTTP response',
      text: () => `HTTP ${response.statusCode} ${response.statusText}\n${formatHeaders(response.headers)}\n\n${response.body}`,
      toast: 'Response copied',
    },
    {
      label: 'JSON (status, headers, body)',
      text: () => JSON.stringify({
        status: response.statusCode,
        statusText: response.statusText,
        timeMs: response.responseTimeMs,
        headers: response.headers,
        body: response.body,
      }, null, 2),
      toast: 'Response copied as JSON',
    },
  ];

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-300"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Copy the response in different formats"
      >
        Copy as ▾
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-[190px] border border-gray-700 bg-[#1b1b1b] p-1 shadow-[0_12px_30px_rgba(0,0,0,0.5)]">
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); void copyWithToast(option.text(), option.toast); }}
              className="block w-full px-2 py-1.5 text-left text-[11px] text-gray-300 hover:bg-gray-800 hover:text-gray-100"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ResponseViewer() {
  const { responses, activeRequestId, activeRequest, sendingRequestId, sendStartedAt, cancelRequest, sendRequest } = useRequestStore();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const {
    activeResponseTab,
    setActiveResponseTab,
    responseViewMode,
    responseViewModeByRequest,
    setRequestResponseViewMode,
  } = useUiStore();
  const response = activeRequestId ? (responses[activeRequestId] ?? null) : null;
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const [treeSearch, setTreeSearch] = useState('');
  const [treeSearchOpen, setTreeSearchOpen] = useState(false);

  const language = response ? detectLanguage(response.contentType, response.body) : 'plaintext';
  const parsedJson = useMemo<{ ok: true; value: JsonValue } | { ok: false }>(() => {
    if (!response || language !== 'json') return { ok: false };
    try { return { ok: true, value: JSON.parse(response.body) as JsonValue }; } catch { return { ok: false }; }
  }, [response, language]);

  const requestedMode: ResponseViewMode = (activeRequestId && responseViewModeByRequest[activeRequestId]) || responseViewMode;
  const viewMode: ResponseViewMode =
    (requestedMode === 'tree' && !parsedJson.ok) || (requestedMode === 'preview' && language !== 'html')
      ? 'pretty'
      : requestedMode;

  if (activeRequestId && sendingRequestId === activeRequestId && sendStartedAt) {
    return <InFlightPanel startedAt={sendStartedAt} onCancel={cancelRequest} />;
  }

  if (!response) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-500">
        <span>{activeRequest ? 'Send the request to see the response here.' : 'Open a request to see its response here.'}</span>
        {activeRequest && (
          <button
            type="button"
            onClick={() => { void sendRequest(activeWorkspaceId); }}
            className="border border-[#ff6c37] bg-[#ff6c37] px-3 py-1 text-xs font-semibold text-white hover:bg-[#f95e26]"
            title={withShortcut('Send', 'send')}
          >
            Send request
          </button>
        )}
      </div>
    );
  }

  if (response.error) {
    return (
      <div className="p-4">
        <div className="border border-rose-900 bg-rose-950/20 p-4">
          <h3 className="mb-1 text-sm font-semibold text-rose-300">Error</h3>
          <p className="font-mono text-xs text-rose-300">{response.error}</p>
          <button
            type="button"
            onClick={() => { void sendRequest(activeWorkspaceId); }}
            className="mt-3 border border-rose-800 px-2.5 py-1 text-[11px] text-rose-200 hover:bg-rose-950/50"
            title={withShortcut('Retry', 'send')}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const displayBody = viewMode === 'raw' ? response.body : formatBody(response.body, language);
  const setViewMode = (mode: ResponseViewMode) => {
    if (activeRequestId) setRequestResponseViewMode(activeRequestId, mode);
  };
  const viewModes: { id: ResponseViewMode; label: string; available: boolean }[] = [
    { id: 'pretty', label: 'Pretty', available: true },
    { id: 'raw', label: 'Raw', available: true },
    { id: 'tree', label: 'Tree', available: parsedJson.ok },
    { id: 'preview', label: 'Preview', available: language === 'html' },
  ];

  const openSearch = () => {
    if (viewMode === 'tree') {
      setTreeSearchOpen(true);
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    void editor.getAction('actions.find')?.run();
  };

  const saveToFile = () => {
    const baseName = (activeRequest?.name || 'response').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const extension = FILE_EXTENSIONS[language] ?? 'txt';
    downloadText(viewMode === 'raw' ? response.body : displayBody, `${baseName}.${extension}`, response.contentType);
    toast('Response saved to file');
  };

  const headerEntries = Object.entries(response.headers);
  const runtimeVariableEntries = Object.entries(response.scriptVariables ?? {});
  const scriptLogs = response.scriptLogs ?? [];
  const testResults = response.testResults ?? [];

  return (
    <div className="flex h-full flex-col bg-[#141414] text-gray-200">
      {/* Status bar */}
      <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-2">
        <span className={`px-2 py-0.5 text-xs font-bold ${getStatusClass(response.statusCode)}`}>
          {response.statusCode} {response.statusText}
        </span>
        <span className="text-xs text-gray-500">
          {response.responseTimeMs} ms
        </span>
        <span className="text-xs text-gray-500">
          {formatBytes(response.responseSizeBytes)}
        </span>

        {response.isSoapFault && (
          <span className="border border-rose-900 bg-rose-950/30 px-2 py-0.5 text-xs font-bold text-rose-300">
            SOAP Fault
          </span>
        )}
      </div>

      {response.isTruncated && (
          <div className="mx-4 mt-2 border border-amber-900 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            Response body was truncated by the max response size setting. Increase it in Settings to receive the full body.
          </div>
        )}

        {/* SOAP Fault banner */}
      {response.isSoapFault && response.soapFault && (
        <div className="mx-4 mt-2 border border-rose-900 bg-rose-950/20 p-3">
          <div className="text-xs font-semibold text-rose-300">
            Fault Code: {response.soapFault.faultCode}
          </div>
          <div className="mt-1 text-xs text-rose-300/90">
            {response.soapFault.faultString}
          </div>
        </div>
      )}

      {/* Response tabs */}
      <div className="flex items-center border-b border-gray-800 bg-[#1a1a1a] px-2">
        {(['body', 'headers', 'scripts', 'tests', 'info'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveResponseTab(tab)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors capitalize ${
              activeResponseTab === tab
                ? 'border-[#ff6c37] bg-gray-900 text-gray-100'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab}
            {tab === 'headers' && (
              <span className="ml-1 border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-300">
                {headerEntries.length}
              </span>
            )}
            {tab === 'scripts' && scriptLogs.length > 0 && (
              <span className="ml-1 border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-300">
                {scriptLogs.length}
              </span>
            )}
            {tab === 'tests' && testResults.length > 0 && (
              <span className="ml-1 border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-300">
                {testResults.filter(t => t.passed).length}/{testResults.length}
              </span>
            )}
          </button>
        ))}

        {activeResponseTab === 'body' && (
          <div className="ml-auto flex items-center gap-1">
            {viewModes.filter((mode) => mode.available).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setViewMode(mode.id)}
                aria-pressed={viewMode === mode.id}
                title={mode.id === 'pretty' || mode.id === 'raw' ? withShortcut(mode.label, 'toggleResponseView') : mode.label}
                className={`border px-2 py-0.5 text-[10px] ${viewMode === mode.id ? 'border-[#ff6c37] bg-[#ff6c37]/20 text-[#ffb59a]' : 'border-gray-700 bg-gray-900 text-gray-400'}`}
              >
                {mode.label}
              </button>
            ))}
            {viewMode !== 'preview' && (
              <button
                type="button"
                onClick={openSearch}
                className="px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-300"
                title="Search in body (Ctrl+F inside the body)"
              >
                Search
              </button>
            )}
            <button
              type="button"
              onClick={() => { void copyWithToast(response.body, 'Body copied'); }}
              className="px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-300"
              title="Copy response body"
            >
              Copy
            </button>
            <CopyAsMenu response={response} displayBody={displayBody} />
            <button
              type="button"
              onClick={saveToFile}
              className="px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-300"
              title="Save response body to a file"
            >
              Save
            </button>
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeResponseTab === 'body' && viewMode === 'tree' && parsedJson.ok && (
          <div className="flex h-full flex-col">
            {treeSearchOpen && (
              <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-1.5">
                <input
                  autoFocus
                  value={treeSearch}
                  onChange={(event) => setTreeSearch(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Escape') { setTreeSearch(''); setTreeSearchOpen(false); } }}
                  placeholder="Search keys and values"
                  aria-label="Search keys and values"
                  className="h-6 flex-1 border border-gray-700 bg-gray-900 px-2 text-xs text-gray-200 outline-none focus:border-gray-500"
                />
                <button type="button" onClick={() => { setTreeSearch(''); setTreeSearchOpen(false); }} className="text-[10px] text-gray-500 hover:text-gray-300">
                  Close
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <JsonTreeView key={`${activeRequestId}:${response.responseTimeMs}:${response.body.length}`} data={parsedJson.value} search={treeSearch} />
            </div>
          </div>
        )}

        {activeResponseTab === 'body' && viewMode === 'preview' && (
          <iframe
            title="HTML preview"
            sandbox=""
            srcDoc={response.body}
            className="h-full w-full border-0 bg-white"
          />
        )}

        {activeResponseTab === 'body' && (viewMode === 'pretty' || viewMode === 'raw') && (
          <CodeEditor
            language={viewMode === 'pretty' ? language : 'plaintext'}
            value={displayBody}
            readOnly
            onMount={(editor) => { editorRef.current = editor; }}
          />
        )}

        {activeResponseTab === 'headers' && (
          <div className="p-4 overflow-y-auto h-full">
            <table className="w-full text-xs">
              <tbody>
                {headerEntries.map(([key, values]) => (
                  <tr key={key} className="border-b border-gray-800">
                    <td className="py-1.5 pr-4 font-mono font-semibold text-gray-300 whitespace-nowrap">
                      {key}
                    </td>
                    <td className="py-1.5 font-mono text-gray-400 break-all">
                      {values.join(', ')}
                      <button
                        onClick={() => { void copyWithToast(values.join(', '), `Copied ${key}`); }}
                        className="ml-2 text-gray-500 hover:text-gray-200"
                        title="Copy value"
                      >
                        ⎘
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeResponseTab === 'info' && (
          <div className="p-4 space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-gray-800">
              <span className="text-gray-500">Status</span>
              <span className="font-mono">{response.statusCode} {response.statusText}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-800">
              <span className="text-gray-500">Response Time</span>
              <span className="font-mono">{response.responseTimeMs} ms</span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-800">
              <span className="text-gray-500">Response Size</span>
              <span className="font-mono">{formatBytes(response.responseSizeBytes)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-800">
              <span className="text-gray-500">Content Type</span>
              <span className="font-mono">{response.contentType}</span>
            </div>

            <div className="pt-2">
              <div className="mb-2 text-[10px] uppercase tracking-wide text-gray-500">Runtime Script Variables</div>
              {runtimeVariableEntries.length === 0 ? (
                <div className="text-[11px] text-gray-500">No runtime variables for this execution.</div>
              ) : (
                <div className="overflow-x-auto border border-gray-800 bg-gray-950/60">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-500">
                        <th className="px-2 py-1 text-left font-medium">Key</th>
                        <th className="px-2 py-1 text-left font-medium">Value</th>
                        <th className="px-2 py-1 text-left font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runtimeVariableEntries.map(([key, variable]) => (
                        <tr key={key} className="border-b border-gray-900/80 last:border-b-0">
                          <td className="px-2 py-1 font-mono text-gray-300">{key}</td>
                          <td className="px-2 py-1 font-mono text-gray-300 break-all">{variable.value}</td>
                          <td className="px-2 py-1 text-gray-500">{variable.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeResponseTab === 'scripts' && (
          <div className="p-4 space-y-3 text-xs overflow-y-auto h-full">
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-wide text-gray-500">
                Logs {scriptLogs.length > 0 && <span className="text-gray-400">({scriptLogs.length})</span>}
              </div>
              {scriptLogs.length === 0 ? (
                <div className="text-[11px] text-gray-500">No script logs for this execution.</div>
              ) : (
                <pre className="max-h-60 overflow-y-auto border border-gray-800 bg-gray-950/60 p-3 font-mono text-[11px] text-gray-300 whitespace-pre-wrap break-words">
                  {scriptLogs.join('\n')}
                </pre>
              )}
            </div>

            <div>
              <div className="mb-2 text-[10px] uppercase tracking-wide text-gray-500">Runtime Variables</div>
              {runtimeVariableEntries.length === 0 ? (
                <div className="text-[11px] text-gray-500">No runtime variables for this execution.</div>
              ) : (
                <div className="overflow-x-auto border border-gray-800 bg-gray-950/60">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-500">
                        <th className="px-2 py-1 text-left font-medium">Key</th>
                        <th className="px-2 py-1 text-left font-medium">Value</th>
                        <th className="px-2 py-1 text-left font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runtimeVariableEntries.map(([key, variable]) => (
                        <tr key={key} className="border-b border-gray-900/80 last:border-b-0">
                          <td className="px-2 py-1 font-mono text-gray-300">{key}</td>
                          <td className="px-2 py-1 font-mono text-gray-300 break-all">{variable.value}</td>
                          <td className="px-2 py-1 text-gray-500">{variable.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeResponseTab === 'tests' && (
          <div className="p-4 overflow-y-auto h-full">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-gray-500">
              Test Results
              {testResults.length > 0 && (
                <span className="ml-1 text-gray-400">
                  ({testResults.filter(t => t.passed).length}/{testResults.length} passed)
                </span>
              )}
            </div>
            {testResults.length === 0 ? (
              <div className="text-xs text-gray-500">No test script defined for this request.</div>
            ) : (
              <div className="space-y-1.5">
                {testResults.map((t, i) => (
                  <div key={i} className={`flex items-start gap-2 rounded border px-3 py-2 text-[11px] ${
                    t.passed
                      ? 'border-emerald-900/40 bg-emerald-950/10'
                      : 'border-rose-900/40 bg-rose-950/10'
                  }`}>
                    <span className={`mt-0.5 font-bold ${t.passed ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {t.passed ? '✓' : '✗'}
                    </span>
                    <div>
                      <span className="text-gray-200">{t.name}</span>
                      {t.message && (
                        <span className="block text-gray-500 font-mono mt-0.5">{t.message}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
