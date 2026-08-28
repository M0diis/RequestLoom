import { useEffect, useMemo, useState } from 'react';
import { useRequestStore } from '../../stores/requestStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useUiStore } from '../../stores/uiStore';
import { serviceVariablesApi, workspaceVariablesApi, toolsApi, historyApi } from '../../services/api';
import { KeyValueEditor } from '../common/KeyValueEditor';
import { RequestVariableEditor } from '../common/RequestVariableEditor';
import { HighlightedUrlInput, type UrlVariableState } from '../common/HighlightedUrlInput';
import { CustomDropdown } from '../common/CustomDropdown';
import { BodyEditor } from './BodyEditor';
import { AuthEditor } from './AuthEditor';
import { RequestScriptEditor } from './RequestScriptEditor';
import { RequestHistoryTab } from './RequestHistoryTab';
import RequestSettingsEditor from './RequestSettingsEditor';
import { RequestFileViewer } from './RequestFileViewer';
import { CodeSnippetsModal } from '../common/CodeSnippetsModal';
import { DynamicValueReferenceModal } from '../common/DynamicValueReferenceModal';
import { getDynamicValueSuggestions } from '../../lib/dynamicValues';
import type {
  HttpMethod,
  BodyType,
  KeyValueEntry,
  RequestVariable,
  ServiceVariable,
  WorkspaceVariable,
  DynamicValueDefinition,
} from '../../types';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-300',
  PATCH: 'text-violet-300',
  DELETE: 'text-rose-400',
  OPTIONS: 'text-gray-400',
  HEAD: 'text-gray-400',
};

const METHOD_OPTIONS = METHODS.map((method) => ({
  value: method,
  label: method,
  className: METHOD_COLORS[method],
}));

const HEADER_KEY_SUGGESTIONS = [
  'Accept', 'Accept-Charset', 'Accept-Encoding', 'Accept-Language',
  'Authorization', 'Cache-Control', 'Connection', 'Content-Disposition',
  'Content-Encoding', 'Content-Length', 'Content-Type', 'Cookie',
  'Host', 'If-Match', 'If-Modified-Since', 'If-None-Match',
  'Origin', 'Pragma', 'Referer', 'User-Agent',
  'X-Api-Key', 'X-Correlation-ID', 'X-Forwarded-For', 'X-Request-ID',
  'X-Requested-With',
];

const HEADER_VALUE_MAP: Record<string, string[]> = {
  accept: ['application/json', 'application/xml', 'text/html', 'text/plain', '*/*'],
  'content-type': ['application/json', 'application/xml', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain', 'text/xml'],
  authorization: ['Bearer {{token}}', 'Basic {{credentials}}'],
  'cache-control': ['no-cache', 'no-store', 'max-age=0', 'must-revalidate'],
  connection: ['keep-alive', 'close'],
  'accept-encoding': ['gzip', 'deflate', 'br', 'gzip, deflate, br'],
  'accept-language': ['en-US', 'en-GB', 'sv-SE', '*'],
  'user-agent': ['RequestLoom/1.0'],
  'x-requested-with': ['XMLHttpRequest'],
};

type PathVariableIndicator = {
  key: string;
  resolved: boolean;
  source: string;
  value?: string;
  pending?: boolean;
};

type ResolvedVariable = {
  value: string;
  source: string;
};

const URL_VARIABLE_PATTERN_SOURCE = '\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}|\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}';

function createUrlVariablePattern(): RegExp {
  return new RegExp(URL_VARIABLE_PATTERN_SOURCE, 'g');
}

function extractPathVariables(url: string): string[] {
  const vars = [...url.matchAll(createUrlVariablePattern())]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter((name) => name.length > 0);
  return [...new Set(vars)];
}

function resolveVariablesInText(
  input: string,
  resolvedLookup: Map<string, ResolvedVariable>,
  missingVariables: Set<string>
): string {
  if (!input) return input;

  return input.replace(
    createUrlVariablePattern(),
    (fullMatch: string, groupA: string | undefined, groupB: string | undefined) => {
      const variableName = (groupA ?? groupB ?? '').trim();
      if (!variableName) return fullMatch;

      const resolved = resolvedLookup.get(variableName.toLowerCase());
      if (!resolved) {
        missingVariables.add(variableName);
        return fullMatch;
      }

      return resolved.value;
    }
  );
}

function buildScopedServiceLookup(
  variables: ServiceVariable[],
  activeEnvironmentId?: string,
  activeEnvironmentName?: string
): Map<string, { value: string; source: string }> {
  const map = new Map<string, { value: string; source: string }>();

  for (const variable of variables) {
    if (!variable.key.trim()) continue;
    if (variable.enabled === false) continue;
    if (variable.environmentId && variable.environmentId.trim().length > 0) continue;

    map.set(variable.key.trim().toLowerCase(), {
      value: variable.value ?? '',
      source: 'service (ALL)',
    });
  }

  if (activeEnvironmentId) {
    for (const variable of variables) {
      if (!variable.key.trim()) continue;
      if (variable.enabled === false) continue;
      if (variable.environmentId !== activeEnvironmentId) continue;

      map.set(variable.key.trim().toLowerCase(), {
        value: variable.value ?? '',
        source: activeEnvironmentName ? `service (${activeEnvironmentName})` : 'service (env)',
      });
    }
  }

  return map;
}

function buildScopedWorkspaceLookup(
  variables: WorkspaceVariable[],
  activeEnvironmentId?: string,
  activeEnvironmentName?: string
): Map<string, { value: string; source: string }> {
  const map = new Map<string, { value: string; source: string }>();

  for (const variable of variables) {
    if (!variable.key.trim()) continue;
    if (variable.enabled === false) continue;
    if (variable.environmentId && variable.environmentId.trim().length > 0) continue;

    map.set(variable.key.trim().toLowerCase(), {
      value: variable.value ?? '',
      source: 'global (ALL)',
    });
  }

  if (activeEnvironmentId) {
    for (const variable of variables) {
      if (!variable.key.trim()) continue;
      if (variable.enabled === false) continue;
      if (variable.environmentId !== activeEnvironmentId) continue;

      map.set(variable.key.trim().toLowerCase(), {
        value: variable.value ?? '',
        source: activeEnvironmentName ? `global (${activeEnvironmentName})` : 'global (env)',
      });
    }
  }

  return map;
}

export function RequestBuilder() {
  const {
    activeRequest,
    updateRequest,
    sendRequest,
    cancelRequest,
    sending,
    runtimeScriptVariablesByRequest,
  } = useRequestStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const { environments } = useEnvironmentStore();
  const { activeRequestTab, setActiveRequestTab } = useUiStore();

  const [showSnippets, setShowSnippets] = useState(false);
  const [showDynamicValues, setShowDynamicValues] = useState(false);
  const [dynamicValues, setDynamicValues] = useState<DynamicValueDefinition[]>([]);
  const [curlCopied, setCurlCopied] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);

  const [workspaceVariables, setWorkspaceVariables] = useState<WorkspaceVariable[]>([]);
  const [serviceVariables, setServiceVariables] = useState<ServiceVariable[]>([]);
  const [workspaceVariablesLoading, setWorkspaceVariablesLoading] = useState(true);
  const [serviceVariablesLoading, setServiceVariablesLoading] = useState(true);
  const [serviceVariablesServiceId, setServiceVariablesServiceId] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    toolsApi.getDynamicValues().then((values) => {
      if (!canceled) setDynamicValues(values);
    }).catch(() => {});
    return () => { canceled = true; };
  }, []);

  const dynamicSuggestions = useMemo(() => getDynamicValueSuggestions(dynamicValues), [dynamicValues]);

  const activeEnvironment = useMemo(
    () => environments.find((environment) => environment.isActive),
    [environments]
  );

  useEffect(() => {
    let canceled = false;

    const loadWorkspaceVariables = async () => {
      setWorkspaceVariablesLoading(true);
      try {
        const rows = await workspaceVariablesApi.getAll(activeWorkspaceId);
        if (!canceled) {
          setWorkspaceVariables(rows);
          setWorkspaceVariablesLoading(false);
        }
      } catch {
        if (!canceled) {
          setWorkspaceVariables([]);
          setWorkspaceVariablesLoading(false);
        }
      }
    };

    void loadWorkspaceVariables();

    return () => {
      canceled = true;
    };
  }, [activeWorkspaceId]);

  useEffect(() => {
    let canceled = false;

    const loadServiceVariables = async () => {
      if (!activeRequest?.serviceId) {
        setServiceVariablesServiceId(null);
        setServiceVariablesLoading(false);
        setServiceVariables([]);
        return;
      }

      setServiceVariablesServiceId(activeRequest.serviceId);
      setServiceVariablesLoading(true);

      try {
        const rows = await serviceVariablesApi.getAll(activeRequest.serviceId);
        if (!canceled) {
          setServiceVariables(rows);
          setServiceVariablesLoading(false);
        }
      } catch {
        if (!canceled) {
          setServiceVariables([]);
          setServiceVariablesLoading(false);
        }
      }
    };

    void loadServiceVariables();

    return () => {
      canceled = true;
    };
  }, [activeRequest?.serviceId]);

  useEffect(() => {
    let canceled = false;

    const loadHistoryCount = async () => {
      if (!activeRequest) return;
      try {
        const { count } = await historyApi.count(activeWorkspaceId, activeRequest.id);
        if (!canceled) setHistoryCount(count);
      } catch {
        if (!canceled) setHistoryCount(0);
      }
    };

    void loadHistoryCount();

    const handleHistoryUpdate = () => {
      void loadHistoryCount();
    };
    window.addEventListener('history:updated', handleHistoryUpdate);

    return () => {
      canceled = true;
      window.removeEventListener('history:updated', handleHistoryUpdate);
    };
  }, [activeWorkspaceId, activeRequest?.id]);

  const variableResolutionReady = useMemo(() => {
    if (workspaceVariablesLoading) return false;
    if (!activeRequest?.serviceId) return true;
    if (serviceVariablesServiceId !== activeRequest.serviceId) return false;
    return !serviceVariablesLoading;
  }, [activeRequest?.serviceId, serviceVariablesLoading, serviceVariablesServiceId, workspaceVariablesLoading]);

  const resolvedVariableLookup = useMemo<Map<string, ResolvedVariable>>(() => {
    const map = new Map<string, ResolvedVariable>();

    const scopedWorkspaceLookup = buildScopedWorkspaceLookup(
      workspaceVariables,
      activeEnvironment?.id,
      activeEnvironment?.name
    );
    for (const [key, variable] of scopedWorkspaceLookup.entries()) {
      map.set(key, variable);
    }

    const scopedServiceLookup = buildScopedServiceLookup(
      serviceVariables,
      activeEnvironment?.id,
      activeEnvironment?.name
    );
    for (const [key, variable] of scopedServiceLookup.entries()) {
      map.set(key, variable);
    }

    if (activeRequest) {
      for (const variable of activeRequest.variables) {
        if (!variable.enabled) continue;
        if (!variable.key.trim()) continue;
        map.set(variable.key.trim().toLowerCase(), {
          value: variable.value ?? '',
          source: 'request',
        });
      }

      const runtimeVars = runtimeScriptVariablesByRequest[activeRequest.id] ?? {};
      for (const [key, variable] of Object.entries(runtimeVars)) {
        map.set(key.trim().toLowerCase(), {
          value: variable.value,
          source: variable.source ? `runtime (${variable.source})` : 'runtime',
        });
      }
    }

    return map;
  }, [activeEnvironment, activeRequest, runtimeScriptVariablesByRequest, serviceVariables, workspaceVariables]);

  const pathVariableIndicators = useMemo<PathVariableIndicator[]>(() => {
    if (!activeRequest) return [];

    const names = extractPathVariables(activeRequest.url);
    if (names.length === 0) return [];

    if (!variableResolutionReady) {
      return names.map((name) => ({
        key: name,
        resolved: false,
        source: 'loading',
        pending: true,
      }));
    }

    return names.map((name) => {
      const normalized = name.toLowerCase();

      if (resolvedVariableLookup.has(normalized)) {
        const resolved = resolvedVariableLookup.get(normalized)!;
        return {
          key: name,
          resolved: true,
          source: resolved.source,
          value: resolved.value,
        };
      }

      return {
        key: name,
        resolved: false,
        source: 'missing',
      };
    });
  }, [activeRequest, resolvedVariableLookup, variableResolutionReady]);

  const resolvedUrlPreview = useMemo(() => {
    if (!activeRequest) {
      return {
        value: '',
        missingVariables: [] as string[],
      };
    }

    const missingVariables = new Set<string>();
    let resolvedUrl = resolveVariablesInText(activeRequest.url, resolvedVariableLookup, missingVariables);

    const queryParts: string[] = [];
    for (const param of activeRequest.params) {
      if (!param.enabled) continue;

      const key = resolveVariablesInText(param.key, resolvedVariableLookup, missingVariables);
      const value = resolveVariablesInText(param.value, resolvedVariableLookup, missingVariables);
      queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }

    if (queryParts.length > 0) {
      resolvedUrl += (resolvedUrl.includes('?') ? '&' : '?') + queryParts.join('&');
    }

    return {
      value: resolvedUrl,
      missingVariables: variableResolutionReady ? [...missingVariables] : [],
    };
  }, [activeRequest, resolvedVariableLookup, variableResolutionReady]);

  const urlVariableStates = useMemo<Record<string, UrlVariableState>>(
    () => Object.fromEntries(
      pathVariableIndicators
        .filter((indicator) => !indicator.pending)
        .map((indicator) => [
        indicator.key.toLowerCase(),
        {
          resolved: indicator.resolved,
          source: indicator.source,
          value: indicator.value,
        },
        ])
    ),
    [pathVariableIndicators]
  );

  if (!activeRequest) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-gray-600">
        Select or create a request to get started
      </div>
    );
  }

  const handleSend = () => sendRequest(activeWorkspaceId);

  const handleCopyCurl = async () => {
    try {
      const { curl } = await toolsApi.generateCurl({
        method: activeRequest.method,
        url: activeRequest.url,
        body: activeRequest.body,
        bodyType: activeRequest.bodyType,
        headers: activeRequest.headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
        params: activeRequest.params.map(p => ({ key: p.key, value: p.value, enabled: p.enabled })),
        variables: activeRequest.variables.map(v => ({ key: v.key, value: v.value, enabled: v.enabled })),
        auth: activeRequest.auth
          ? { authType: activeRequest.auth.authType, configJson: activeRequest.auth.configJson }
          : null,
        workspaceId: activeWorkspaceId,
        serviceId: activeRequest.serviceId,
        requestId: activeRequest.id,
      });
      await navigator.clipboard.writeText(curl);
      setCurlCopied(true);
      setTimeout(() => setCurlCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleMethodChange = (method: string) => {
    void updateRequest(activeRequest.id, { method: method as HttpMethod });
  };

  const handleUrlChange = (url: string) => {
    void updateRequest(activeRequest.id, { url });
  };

  const handleHeadersChange = (headers: KeyValueEntry[]) => {
    void updateRequest(activeRequest.id, { headers });
  };

  const handleParamsChange = (params: KeyValueEntry[]) => {
    void updateRequest(activeRequest.id, { params });
  };

  const handleVariablesChange = (variables: RequestVariable[]) => {
    void updateRequest(activeRequest.id, { variables });
  };

  const handleBodyChange = (body: string | null, bodyType: BodyType) => {
    void updateRequest(activeRequest.id, { body, bodyType });
  };

  const tabs = [
    { id: 'params' as const, label: 'Params', count: activeRequest.params.filter((p) => p.enabled).length },
    { id: 'headers' as const, label: 'Headers', count: activeRequest.headers.filter((h) => h.enabled).length },
    { id: 'variables' as const, label: 'Vars', count: activeRequest.variables.length },
    { id: 'body' as const, label: 'Body' },
    { id: 'auth' as const, label: 'Auth' },
    { id: 'pre-script' as const, label: 'Pre-script' },
    { id: 'post-script' as const, label: 'Post-script' },
    { id: 'tests' as const, label: 'Tests' },
    { id: 'runs' as const, label: 'History', count: historyCount },
    { id: 'settings' as const, label: 'Settings' },
    { id: 'file' as const, label: 'File' },
  ];

  return (
    <div className="flex h-full flex-col bg-[#141414] text-gray-200">
      <div className="border-b border-gray-800 p-3">
        <div className="flex items-center gap-2">
          <CustomDropdown
            value={activeRequest.method}
            options={METHOD_OPTIONS}
            onChange={handleMethodChange}
            title="Method"
            className="w-[122px]"
            buttonClassName={`py-1.5 text-sm font-bold ${METHOD_COLORS[activeRequest.method]}`}
            menuClassName="w-[122px]"
          />

          <HighlightedUrlInput
            value={activeRequest.url}
            onChange={handleUrlChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend();
            }}
            placeholder="{{baseUrl}}/api/endpoint"
            variableStates={urlVariableStates}
            dynamicSuggestions={dynamicSuggestions}
          />

          {sending ? (
            <button
              onClick={cancelRequest}
              className="border border-rose-900 bg-rose-950/30 px-4 py-1.5 text-sm font-medium text-rose-300 hover:bg-rose-950/50 whitespace-nowrap"
            >
              Cancel
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={handleSend}
                className="border border-[#ff6c37] bg-[#ff6c37] px-3 py-1 text-sm font-semibold text-white hover:bg-[#f95e26] whitespace-nowrap"
              >
                  <svg className="inline-block h-4 w-4 -mt-[1px] fill-current" viewBox="0 3 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
              </button>
              <button
                onClick={handleCopyCurl}
                className="border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800 whitespace-nowrap"
                title="Copy as cURL"
              >
                {curlCopied ? 'Copied!' : 'cURL'}
              </button>
              <button
                onClick={() => setShowSnippets(true)}
                className="border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800 whitespace-nowrap"
                title="Generate code snippets"
              >
                Code
              </button>
              <button
                onClick={() => setShowDynamicValues(true)}
                className="border border-gray-700 bg-gray-900 px-2 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800 whitespace-nowrap"
                title="Dynamic value reference"
              >
                {'{{$}}'}
              </button>
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-start gap-2 text-[11px]">
          <span
            className={`min-w-0 flex-1 break-all font-mono ${
              resolvedUrlPreview.missingVariables.length > 0 ? 'text-amber-300' : 'text-gray-400'
            }`}
          >
            {resolvedUrlPreview.value || activeRequest.url || 'Enter URL to preview resolution'}
          </span>
        </div>
        <div className="mt-1 text-[10px] text-amber-300/80">
          cURL and code snapshots resolve variables and may contain secrets.
        </div>

        {resolvedUrlPreview.missingVariables.length > 0 && (
          <div className="mt-1 text-[11px] text-rose-400">
            Missing variables: {resolvedUrlPreview.missingVariables.map((variableName) => `{{${variableName}}}`).join(', ')}
          </div>
        )}

      </div>

      <div className="flex border-b border-gray-800 bg-[#1a1a1a] overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveRequestTab(tab.id)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeRequestTab === tab.id
                ? 'border-[#ff6c37] bg-gray-900 text-gray-100'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1 border border-gray-700 bg-gray-900 px-1 text-[10px] text-gray-300">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {activeRequestTab === 'params' && (
          <KeyValueEditor
            entries={activeRequest.params}
            onChange={handleParamsChange}
            keyPlaceholder="Parameter name"
            valuePlaceholder="Value"
            dynamicSuggestions={dynamicSuggestions}
          />
        )}
        {activeRequestTab === 'headers' && (
          <KeyValueEditor
            entries={activeRequest.headers}
            onChange={handleHeadersChange}
            keyPlaceholder="Header name"
            valuePlaceholder="Value"
            keySuggestions={HEADER_KEY_SUGGESTIONS}
            valueSuggestionsMap={HEADER_VALUE_MAP}
            dynamicSuggestions={dynamicSuggestions}
          />
        )}
        {activeRequestTab === 'variables' && (
          <RequestVariableEditor
            entries={activeRequest.variables}
            onChange={handleVariablesChange}
            dynamicSuggestions={dynamicSuggestions}
          />
        )}
        {activeRequestTab === 'body' && (
          <BodyEditor
            body={activeRequest.body}
            bodyType={activeRequest.bodyType}
            onChange={handleBodyChange}
            dynamicSuggestions={dynamicSuggestions}
          />
        )}
        {activeRequestTab === 'auth' && (
          <AuthEditor request={activeRequest} onUpdate={updateRequest} dynamicSuggestions={dynamicSuggestions} />
        )}
        {activeRequestTab === 'pre-script' && (
          <RequestScriptEditor request={activeRequest} stage="pre" onUpdate={updateRequest} />
        )}
        {activeRequestTab === 'post-script' && (
          <RequestScriptEditor request={activeRequest} stage="post" onUpdate={updateRequest} />
        )}
        {activeRequestTab === 'tests' && (
          <RequestScriptEditor request={activeRequest} stage="test" onUpdate={updateRequest} />
        )}
        {activeRequestTab === 'runs' && (
          <RequestHistoryTab workspaceId={activeWorkspaceId} requestId={activeRequest.id} />
        )}
        {activeRequestTab === 'settings' && (
          <RequestSettingsEditor requestId={activeRequest.id} />
        )}
        {activeRequestTab === 'file' && (
          <RequestFileViewer requestId={activeRequest.id} />
        )}
      </div>

      {showSnippets && (
        <CodeSnippetsModal
          onClose={() => setShowSnippets(false)}
          method={activeRequest.method}
          url={activeRequest.url}
          body={activeRequest.body}
          bodyType={activeRequest.bodyType}
          headers={activeRequest.headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled }))}
          params={activeRequest.params.map(p => ({ key: p.key, value: p.value, enabled: p.enabled }))}
          variables={activeRequest.variables.map(v => ({ key: v.key, value: v.value, enabled: v.enabled }))}
          auth={activeRequest.auth ? { authType: activeRequest.auth.authType, configJson: activeRequest.auth.configJson } : null}
          workspaceId={activeWorkspaceId}
          serviceId={activeRequest.serviceId}
          requestId={activeRequest.id}
        />
      )}

      {showDynamicValues && (
        <DynamicValueReferenceModal
          definitions={dynamicValues}
          onClose={() => setShowDynamicValues(false)}
        />
      )}
    </div>
  );
}
