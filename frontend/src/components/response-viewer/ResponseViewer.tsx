import { useRequestStore } from '../../stores/requestStore';
import { useUiStore } from '../../stores/uiStore';
import { CodeEditor } from '../common/CodeEditor';
import { html as beautifyHtml } from 'js-beautify';

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

export function ResponseViewer() {
  const { responses, activeRequestId, sending } = useRequestStore();
  const { activeResponseTab, setActiveResponseTab, responseViewMode, setResponseViewMode } = useUiStore();
  const response = activeRequestId ? (responses[activeRequestId] ?? null) : null;

  if (sending) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin border-2 border-gray-400 border-t-transparent" />
          <span className="text-sm">Sending request...</span>
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-600 text-sm">
        Send a request to see the response
      </div>
    );
  }

  if (response.error) {
    return (
      <div className="p-4">
        <div className="border border-rose-900 bg-rose-950/20 p-4">
          <h3 className="mb-1 text-sm font-semibold text-rose-300">Error</h3>
          <p className="font-mono text-xs text-rose-300">{response.error}</p>
        </div>
      </div>
    );
  }

  const language = detectLanguage(response.contentType, response.body);
  const displayBody = responseViewMode === 'pretty' ? formatBody(response.body, language) : response.body;

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
          <div className="ml-auto flex gap-1">
            <button
              onClick={() => setResponseViewMode('pretty')}
              className={`border px-2 py-0.5 text-[10px] ${responseViewMode === 'pretty' ? 'border-[#ff6c37] bg-[#ff6c37]/20 text-[#ffb59a]' : 'border-gray-700 bg-gray-900 text-gray-400'}`}
            >
              Pretty
            </button>
            <button
              onClick={() => setResponseViewMode('raw')}
              className={`border px-2 py-0.5 text-[10px] ${responseViewMode === 'raw' ? 'border-[#ff6c37] bg-[#ff6c37]/20 text-[#ffb59a]' : 'border-gray-700 bg-gray-900 text-gray-400'}`}
            >
              Raw
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(response.body)}
              className="px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-300"
              title="Copy response"
            >
              Copy
            </button>
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeResponseTab === 'body' && (
          <CodeEditor
            language={responseViewMode === 'pretty' ? language : 'plaintext'}
            value={displayBody}
            readOnly
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
                        onClick={() => navigator.clipboard.writeText(values.join(', '))}
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
