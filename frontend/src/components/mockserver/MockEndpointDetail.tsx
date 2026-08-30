import { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useMockServerStore } from '../../stores/mockServerStore';
import { DocumentationLink, DocHelpButton } from '../documentation/DocumentationLink';
import type { HttpMethod, KeyValuePairRequest } from '../../types';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const CONTENT_TYPES = ['application/json', 'application/xml', 'text/plain', 'text/html', 'application/x-www-form-urlencoded'];

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400 bg-emerald-400/10',
  POST: 'text-sky-400 bg-sky-400/10',
  PUT: 'text-amber-400 bg-amber-400/10',
  PATCH: 'text-violet-400 bg-violet-400/10',
  DELETE: 'text-rose-400 bg-rose-400/10',
  OPTIONS: 'text-gray-400 bg-gray-400/10',
  HEAD: 'text-gray-400 bg-gray-400/10',
};

export function MockEndpointDetail() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const {
    mockServers, selectedServerId, selectedEndpointId,
    setSelectedServer, setSelectedEndpoint,
    create: createServer,
    createEndpoint, updateEndpoint, deleteEndpoint,
  } = useMockServerStore();

  const servers = Array.isArray(mockServers) ? mockServers : [];
  const server = servers.find((s) => s.id === selectedServerId) ?? null;
  const endpoint = server?.endpoints.find((e) => e.id === selectedEndpointId) ?? null;

  const [editing, setEditing] = useState(false);
  const [epMethod, setEpMethod] = useState<HttpMethod>('GET');
  const [epPath, setEpPath] = useState('/');
  const [epStatusCode, setEpStatusCode] = useState(200);
  const [epContentType, setEpContentType] = useState('application/json');
  const [epResponseBody, setEpResponseBody] = useState('');
  const [epHeaders, setEpHeaders] = useState<KeyValuePairRequest[]>([]);
  const [epScriptEnabled, setEpScriptEnabled] = useState(false);
  const [epScript, setEpScript] = useState('');
  const [epDelayMs, setEpDelayMs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [creatingServer, setCreatingServer] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerSlug, setNewServerSlug] = useState('');
  const [creatingServerSaving, setCreatingServerSaving] = useState(false);

  const isNew = !selectedEndpointId;

  // Populate form when endpoint changes
  useEffect(() => {
    if (endpoint) {
      setEditing(false);
      setEpMethod(endpoint.method);
      setEpPath(endpoint.path);
      setEpStatusCode(endpoint.statusCode);
      setEpContentType(endpoint.contentType);
      setEpResponseBody(endpoint.responseBody);
      try { setEpHeaders(JSON.parse(endpoint.responseHeadersJson || '[]')); } catch { setEpHeaders([]); }
      setEpScriptEnabled(endpoint.scriptEnabled);
      setEpScript(endpoint.script || '');
      setEpDelayMs(endpoint.delayMs);
    } else if (isNew && server) {
      setEditing(true);
      setEpMethod('GET');
      setEpPath('/');
      setEpStatusCode(200);
      setEpContentType('application/json');
      setEpResponseBody('{\n  \n}');
      setEpHeaders([]);
      setEpScriptEnabled(false);
      setEpScript(`// Dynamic response script\n// Access: request.method, request.path, request.body, request.headers, request.queryParams\n// Modify: response.statusCode, response.body, response.headers\n\nresponse.body = JSON.stringify({\n  message: "Hello from mock server!",\n  method: request.method,\n  path: request.path,\n  timestamp: new Date().toISOString()\n});\n`);
      setEpDelayMs(0);
    }
  }, [selectedEndpointId, endpoint, isNew, server]);

  if (!server) {
    if (servers.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 px-6 text-center">
          <svg className="h-12 w-12 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
          </svg>
          <p className="text-sm">No mock servers yet. Create one to start mocking endpoints.</p>
          {creatingServer ? (
            <div className="w-full max-w-sm space-y-2">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Name</label>
                <input
                  type="text"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="My Mock API"
                  autoFocus
                  className="w-full bg-zinc-700/50 border border-zinc-600 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Slug (URL path, e.g. "my-api")
                </label>
                <div className="flex items-center bg-zinc-700/50 border border-zinc-600 rounded-md overflow-hidden">
                  <span className="pl-3 text-xs text-zinc-500 font-mono">/mock/</span>
                  <input
                    type="text"
                    value={newServerSlug}
                    onChange={(e) => setNewServerSlug(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase())}
                    placeholder="my-api"
                    className="flex-1 bg-transparent px-2 py-2 text-sm text-purple-300 font-mono placeholder-zinc-500 focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-zinc-600 mt-1">Leave blank to use auto-generated ID.</p>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => { setCreatingServer(false); setNewServerName(''); setNewServerSlug(''); }}
                  className="px-4 py-1.5 text-xs rounded-md border border-zinc-600 text-zinc-400 hover:bg-zinc-700/50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!newServerName.trim()) return;
                    setCreatingServerSaving(true);
                    try {
                      const s = await createServer(activeWorkspaceId, {
                        name: newServerName.trim(),
                        description: '',
                        slug: newServerSlug.trim(),
                        port: 0,
                      });
                      setSelectedServer(s.id);
                    } finally {
                      setCreatingServerSaving(false);
                    }
                  }}
                  disabled={creatingServerSaving || !newServerName.trim()}
                  className="px-4 py-1.5 text-xs rounded-md bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 transition-colors"
                >
                  {creatingServerSaving ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreatingServer(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-zinc-600 text-zinc-300 hover:bg-zinc-700/50 hover:text-purple-300 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Create mock server
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3">
        <svg className="h-12 w-12 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
        </svg>
        <p className="text-sm">Select a mock server from the sidebar</p>
      </div>
    );
  }

  if (!isNew && !endpoint) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3">
        <p className="text-sm">Select an endpoint or add a new one</p>
      </div>
    );
  }

  const handleSave = async () => {
    if (!selectedServerId || !epPath.trim()) return;
    setSaving(true);
    try {
      if (isNew || !selectedEndpointId) {
        const ep = await createEndpoint(activeWorkspaceId, selectedServerId, {
          method: epMethod,
          path: epPath.trim(),
          statusCode: epStatusCode,
          contentType: epContentType,
          responseBody: epResponseBody,
          responseHeaders: epHeaders.filter((h) => h.key.trim()),
          scriptEnabled: epScriptEnabled,
          script: epScript,
          delayMs: epDelayMs,
        });
        setSelectedEndpoint(ep.id);
        setEditing(false);
      } else {
        await updateEndpoint(activeWorkspaceId, selectedServerId, selectedEndpointId, {
          method: epMethod,
          path: epPath.trim(),
          statusCode: epStatusCode,
          contentType: epContentType,
          responseBody: epResponseBody,
          responseHeaders: epHeaders.filter((h) => h.key.trim()),
          scriptEnabled: epScriptEnabled,
          script: epScript,
          delayMs: epDelayMs,
        });
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedServerId || !selectedEndpointId) return;
    if (!confirm('Delete this endpoint?')) return;
    await deleteEndpoint(activeWorkspaceId, selectedServerId, selectedEndpointId);
  };

  const copyMockUrl = () => {
    const slug = server.slug || server.id;
    const url = `${window.location.origin}/mock/${slug}${epPath}`;
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const addHeader = () => setEpHeaders([...epHeaders, { key: '', value: '', enabled: true }]);
  const updateHeader = (i: number, field: 'key' | 'value', val: string) => {
    setEpHeaders(epHeaders.map((h, idx) => (idx === i ? { ...h, [field]: val } : h)));
  };
  const toggleHeader = (i: number) => {
    setEpHeaders(epHeaders.map((h, idx) => (idx === i ? { ...h, enabled: !h.enabled } : h)));
  };
  const removeHeader = (i: number) => setEpHeaders(epHeaders.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/60">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase ${METHOD_COLORS[isNew ? epMethod : (endpoint?.method ?? 'GET')] || 'text-gray-400'}`}>
              {isNew ? epMethod : endpoint?.method}
            </span>
            <span className="text-sm text-purple-400 font-semibold">{server.name}</span>
          </div>
          {!isNew && (
            <span className="text-xs font-mono text-zinc-400 truncate">{endpoint?.path}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <DocumentationLink section="mock-servers" className="text-zinc-400 hover:text-zinc-100" />
          <DocHelpButton section="mock-servers" />
          {!editing && !isNew && (
            <>
              <button onClick={copyMockUrl} className="text-xs px-2 py-1 rounded border border-zinc-600 text-zinc-400 hover:text-purple-400 hover:border-purple-500/50 transition-colors">
                Copy URL
              </button>
              <button onClick={() => setEditing(true)} className="text-xs px-2 py-1 rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors">
                Edit
              </button>
              <button onClick={handleDelete} className="text-xs px-2 py-1 rounded border border-zinc-600 text-zinc-500 hover:text-rose-400 hover:border-rose-500/50 transition-colors">
                Delete
              </button>
            </>
          )}
          {(editing || isNew) && (
            <>
              <button onClick={() => { if (isNew) setSelectedServer(null); else setEditing(false); }} className="text-xs px-3 py-1 rounded border border-zinc-600 text-zinc-400 hover:bg-zinc-700/50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !epPath.trim()} className="text-xs px-3 py-1 rounded bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 transition-colors">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {(editing || isNew) ? (
          <>
            {/* Edit mode */}
            <div className="flex gap-3">
              <div className="w-28">
                <label className="block text-xs text-zinc-400 mb-1">Method</label>
                <select value={epMethod} onChange={(e) => setEpMethod(e.target.value as HttpMethod)}
                  className="w-full bg-zinc-700/50 border border-zinc-600 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-purple-500/50">
                  {HTTP_METHODS.map((m) => (<option key={m} value={m}>{m}</option>))}
                </select>
              </div>
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-1"><label className="text-xs text-zinc-400">Path ({`{param}`} for path params)</label><DocHelpButton section="mock-servers" title="Open mock route documentation" /></div>
                <input type="text" value={epPath} onChange={(e) => setEpPath(e.target.value)}
                  placeholder="/api/users/{id}"
                  className="w-full bg-zinc-700/50 border border-zinc-600 rounded-md px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50" />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-28">
                <label className="block text-xs text-zinc-400 mb-1">Status</label>
                <input type="number" value={epStatusCode} onChange={(e) => setEpStatusCode(parseInt(e.target.value) || 200)}
                  className="w-full bg-zinc-700/50 border border-zinc-600 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-purple-500/50" />
              </div>
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-1"><label className="text-xs text-zinc-400">Content-Type</label><DocHelpButton section="http" title="Open HTTP header documentation" /></div>
                <select value={epContentType} onChange={(e) => setEpContentType(e.target.value)}
                  className="w-full bg-zinc-700/50 border border-zinc-600 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-purple-500/50">
                  {CONTENT_TYPES.map((ct) => (<option key={ct} value={ct}>{ct}</option>))}
                </select>
              </div>
              <div className="w-24">
                <label className="block text-xs text-zinc-400 mb-1">Delay (ms)</label>
                <input type="number" value={epDelayMs} onChange={(e) => setEpDelayMs(parseInt(e.target.value) || 0)} min={0}
                  className="w-full bg-zinc-700/50 border border-zinc-600 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-purple-500/50" />
              </div>
            </div>

            {/* Response Body */}
            <div>
              <div className="mb-1 flex items-center gap-1"><label className="text-xs text-zinc-400">Response Body</label><DocHelpButton section="mock-servers" title="Open mock response documentation" /></div>
              <textarea value={epResponseBody} onChange={(e) => setEpResponseBody(e.target.value)} rows={8}
                spellCheck={false}
                className="w-full bg-zinc-700/50 border border-zinc-600 rounded-md px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50 resize-y" />
            </div>

            {/* Response Headers */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1"><label className="text-xs text-zinc-400">Response Headers</label><DocHelpButton section="http" title="Open HTTP header documentation" /></div>
                <button onClick={addHeader} className="text-xs text-purple-400 hover:text-purple-300">+ Add</button>
              </div>
              {epHeaders.length === 0 ? (
                <p className="text-xs text-zinc-600">No custom headers</p>
              ) : (
                <div className="space-y-1.5">
                  {epHeaders.map((h, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <button onClick={() => toggleHeader(i)}
                        className={`text-[10px] w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${h.enabled ? 'text-emerald-400 bg-emerald-400/10' : 'text-zinc-600 bg-zinc-700/30'}`}>
                        {h.enabled ? '✓' : '✗'}
                      </button>
                      <input type="text" value={h.key} onChange={(e) => updateHeader(i, 'key', e.target.value)} placeholder="Header"
                        className="flex-1 bg-zinc-700/50 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50" />
                      <input type="text" value={h.value} onChange={(e) => updateHeader(i, 'value', e.target.value)} placeholder="Value"
                        className="flex-1 bg-zinc-700/50 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50" />
                      <button onClick={() => removeHeader(i)} className="text-zinc-600 hover:text-rose-400">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dynamic Script */}
            <div className="border border-zinc-600/40 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={epScriptEnabled} onChange={(e) => setEpScriptEnabled(e.target.checked)}
                      className="rounded bg-zinc-700 border-zinc-600" />
                    <span className="text-xs text-zinc-300">Dynamic Response (JavaScript)</span>
                  </label>
                  <DocHelpButton section="mock-servers" title="Open mock response scripting documentation" />
                </div>
                {epScriptEnabled && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-400/10 text-amber-400">Jint JS</span>}
              </div>
              {epScriptEnabled && (
                <textarea value={epScript} onChange={(e) => setEpScript(e.target.value)} rows={10} spellCheck={false}
                  className="w-full bg-zinc-900/70 border border-zinc-600 rounded-md px-3 py-2 text-xs font-mono text-emerald-300 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50 resize-y" />
              )}
            </div>
          </>
        ) : (
          <>
            {/* View mode */}
            {endpoint && (
              <>
                {/* Info */}
                <div className="flex flex-wrap gap-4 text-xs">
                  <div><span className="text-zinc-500">Status: </span><span className="text-zinc-200">{endpoint.statusCode}</span></div>
                  <div><span className="text-zinc-500">Type: </span><span className="text-zinc-200">{endpoint.contentType}</span></div>
                  {endpoint.delayMs > 0 && <div><span className="text-zinc-500">Delay: </span><span className="text-zinc-200">{endpoint.delayMs}ms</span></div>}
                  {endpoint.scriptEnabled && <div><span className="text-amber-400">⚡ Dynamic Script</span></div>}
                </div>

                {/* Mock URL */}
                <div>
                  <span className="text-xs text-zinc-500">Mock URL: </span>
                  <code className="text-xs bg-zinc-800/50 rounded px-2 py-1 text-purple-300 font-mono">
                    /mock/{server.slug || server.id}{endpoint.path}
                  </code>
                </div>

                {/* Response body */}
                <div>
                  <span className="text-xs text-zinc-400 block mb-1">Response Body:</span>
                  <pre className="text-xs font-mono bg-zinc-800/50 rounded-md p-3 overflow-x-auto text-zinc-300 max-h-64 overflow-y-auto">
                    {endpoint.responseBody || '(empty)'}
                  </pre>
                </div>

                {/* Headers */}
                {(() => {
                  try {
                    const hdrs: KeyValuePairRequest[] = JSON.parse(endpoint.responseHeadersJson || '[]');
                    const active = hdrs.filter((h) => h.enabled && h.key.trim());
                    if (active.length === 0) return null;
                    return (
                      <div>
                        <span className="text-xs text-zinc-400 block mb-1">Response Headers:</span>
                        <div className="space-y-0.5">
                          {active.map((h, i) => (
                            <div key={i} className="text-xs font-mono text-zinc-400">
                              <span className="text-zinc-300">{h.key}</span>: {h.value}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  } catch { return null; }
                })()}

                {/* Script preview */}
                {endpoint.scriptEnabled && endpoint.script && (
                  <div>
                    <span className="text-xs text-amber-400 block mb-1">Script:</span>
                    <pre className="text-xs font-mono bg-zinc-900/70 rounded-md p-3 overflow-x-auto text-zinc-400 max-h-32 overflow-y-auto">
                      {endpoint.script}
                    </pre>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Toast */}
      {copiedUrl && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-emerald-600/90 text-white text-xs shadow-lg">
          Copied: <code className="font-mono">{copiedUrl}</code>
        </div>
      )}
    </div>
  );
}
