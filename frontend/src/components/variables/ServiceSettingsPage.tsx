import { useEffect, useMemo, useState } from 'react';
import { KeyValueEditor } from '../common/KeyValueEditor';
import { serviceVariablesApi } from '../../services/api';
import { useRequestStore } from '../../stores/requestStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useUiStore } from '../../stores/uiStore';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { CustomDropdown, type DropdownOption } from '../common/CustomDropdown';
import { AutocompleteInput } from '../common/AutocompleteInput';
import { DEFAULT_DYNAMIC_VALUE_SUGGESTIONS } from '../../lib/dynamicValues';
import { OAuth2AuthFields } from '../common/OAuth2AuthFields';
import { DocumentationLink, DocHelpButton } from '../documentation/DocumentationLink';
import type {
  ServiceVariable,
  KeyValueEntry,
  AuthType,
  AuthRequest,
} from '../../types';

interface Props {
  serviceId: string;
}

interface VariableDraft {
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
  reveal: boolean;
  environmentId: string | null;
}

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

const AUTH_TYPES: { value: AuthType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'basic', label: 'Basic' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apikey', label: 'API Key' },
  { value: 'oauth2', label: 'OAuth2 / OIDC' },
];

const API_KEY_TARGET_OPTIONS: DropdownOption[] = [
  { value: 'header', label: 'Header' },
  { value: 'query', label: 'Query Parameter' },
];

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

const INPUT_CLASS = 'w-full border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 outline-none focus:border-gray-500';
const MONO_INPUT_CLASS = 'border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500';
const SMALL_PRIMARY_BUTTON = 'border border-gray-600 bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-100 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50';
const SMALL_DANGER_BUTTON = 'border border-rose-900 bg-rose-950/20 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-50';

function ToggleSwitch({ label, checked, onChange, disabled = false }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 border px-2 py-1 text-[11px] font-medium transition-colors ${
        checked
          ? 'border-emerald-800 bg-emerald-950/30 text-emerald-200'
          : 'border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`relative inline-flex h-4 w-7 items-center transition-colors ${
          checked ? 'bg-emerald-700/80' : 'bg-gray-700'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform bg-white transition-transform ${
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}

function getDefaultAuthConfig(type: AuthType): Record<string, string> {
  switch (type) {
    case 'basic':
      return { username: '', password: '' };
    case 'bearer':
      return { token: '' };
    case 'apikey':
      return { key: '', value: '', in: 'header' };
    case 'oauth2':
      return {
        authorizationUrl: '',
        tokenUrl: '',
        issuer: '',
        clientId: '',
        clientSecret: '',
        scope: 'openid profile email',
        redirectUri: '',
        audience: '',
        clientAuthenticationMethod: 'client_secret_post',
      };
    default:
      return {};
  }
}

function tryParseAuthConfig(configJson: string | undefined, fallbackType: AuthType): Record<string, string> {
  if (!configJson) {
    return getDefaultAuthConfig(fallbackType);
  }

  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>;
    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      normalized[key] = typeof value === 'string' ? value : String(value ?? '');
    }

    return Object.keys(normalized).length > 0 ? normalized : getDefaultAuthConfig(fallbackType);
  } catch {
    return getDefaultAuthConfig(fallbackType);
  }
}

export function ServiceSettingsPage({ serviceId }: Props) {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { services, updateService } = useRequestStore();
  const { environments } = useEnvironmentStore();
  const { setServiceSettingsServiceId } = useUiStore();

  const service = useMemo(
    () => services.find((s) => s.id === serviceId),
    [services, serviceId]
  );

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultHeaders, setDefaultHeaders] = useState<KeyValueEntry[]>([]);
  const [defaultAuthType, setDefaultAuthType] = useState<AuthType>('none');
  const [defaultAuthConfig, setDefaultAuthConfig] = useState<Record<string, string>>({});
  const [savingMeta, setSavingMeta] = useState(false);

  const [variables, setVariables] = useState<ServiceVariable[]>([]);
  const [drafts, setDrafts] = useState<Record<string, VariableDraft>>({});
  const [loadingVars, setLoadingVars] = useState(false);
  const [savingVars, setSavingVars] = useState(false);

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newSecret, setNewSecret] = useState(false);
  const [newEnabled, setNewEnabled] = useState(true);
  const [newEnvironmentId, setNewEnvironmentId] = useState('');

  const [error, setError] = useState<string | null>(null);

  // Dirty tracking
  const metaDirty = useMemo(() => {
    if (!service) return false;
    if (name !== service.name || description !== service.description) return true;

    const currentAuthType = (service.auth?.authType ?? 'none') as AuthType;
    if (defaultAuthType !== currentAuthType) return true;

    const currentAuthJson = service.auth?.configJson ?? '';
    const newAuthJson = JSON.stringify(defaultAuthConfig);
    if (JSON.stringify(tryParseAuthConfig(currentAuthJson, currentAuthType)) !== newAuthJson) return true;

    const currentHeaders = (service.headers ?? []).map(h => `${h.key}:${h.value}:${h.enabled}`).join('|');
    const newHeaders = defaultHeaders.map(h => `${h.key}:${h.value}:${h.enabled}`).join('|');
    if (currentHeaders !== newHeaders) return true;

    return false;
  }, [service, name, description, defaultHeaders, defaultAuthType, defaultAuthConfig]);

  const varsDirty = useMemo(() => {
    for (const v of variables) {
      const d = drafts[v.id];
      if (!d) continue;
      if (d.key !== v.key || d.value !== v.value || d.isSecret !== v.isSecret || d.enabled !== v.enabled) return true;
      if ((d.environmentId ?? null) !== (v.environmentId ?? null)) return true;
    }
    return false;
  }, [variables, drafts]);

  const environmentScopeOptions = useMemo(
    () => [
      { value: '', label: 'ALL' },
      ...environments.map((environment) => ({ value: environment.id, label: environment.name })),
    ],
    [environments]
  );

  useEffect(() => {
    if (!service) {
      return;
    }

    setName(service.name);
    setDescription(service.description);
    setDefaultHeaders((service.headers ?? []).map((h) => ({
      id: h.id || crypto.randomUUID(),
      key: h.key,
      value: h.value,
      enabled: h.enabled,
    })));

    const initialAuthType = (service.auth?.authType ?? 'none') as AuthType;
    setDefaultAuthType(initialAuthType);
    setDefaultAuthConfig(tryParseAuthConfig(service.auth?.configJson, initialAuthType));
  }, [service]);

  useEffect(() => {
    const loadVariables = async () => {
      setLoadingVars(true);
      setError(null);
      try {
        const list = await serviceVariablesApi.getAll(serviceId);
        setVariables(list);
        setDrafts(Object.fromEntries(list.map((v) => [v.id, {
          key: v.key,
          value: v.value,
          isSecret: v.isSecret,
          enabled: v.enabled,
          reveal: false,
          environmentId: v.environmentId ?? null,
        }])));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load service variables');
      } finally {
        setLoadingVars(false);
      }
    };

    loadVariables();
  }, [serviceId]);

  const refreshVariables = async () => {
    const list = await serviceVariablesApi.getAll(serviceId);
    setVariables(list);
    setDrafts(Object.fromEntries(list.map((v) => [v.id, {
      key: v.key,
      value: v.value,
      isSecret: v.isSecret,
      enabled: v.enabled,
      reveal: false,
      environmentId: v.environmentId ?? null,
    }])));
  };

  const buildServiceAuth = (): AuthRequest | null => {
    if (defaultAuthType === 'none') {
      return null;
    }

    return {
      authType: defaultAuthType,
      configJson: JSON.stringify(defaultAuthConfig),
    };
  };

  const saveMetadata = async () => {
    if (!service || !name.trim()) return;

    setSavingMeta(true);
    setError(null);
    try {
      await updateService(
        activeWorkspaceId,
        service.id,
        name.trim(),
        description,
        defaultHeaders.map((h) => ({ key: h.key, value: h.value, enabled: h.enabled })),
        buildServiceAuth(),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update service metadata');
    } finally {
      setSavingMeta(false);
    }
  };

  const updateDraft = (id: string, patch: Partial<VariableDraft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const saveVariable = async (variable: ServiceVariable) => {
    const draft = drafts[variable.id];
    if (!draft) return;

    const key = draft.key.trim();
    if (!key) {
      setError('Service variable key is required');
      return;
    }

    setSavingVars(true);
    setError(null);
    try {
      await serviceVariablesApi.upsert(serviceId, {
        id: variable.id,
        environmentId: draft.environmentId,
        key: key,
        value: draft.value,
        isSecret: draft.isSecret,
        enabled: draft.enabled,
      });
      await refreshVariables();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save service variable');
    } finally {
      setSavingVars(false);
    }
  };

  const deleteVariable = async (id: string) => {
    setSavingVars(true);
    setError(null);
    try {
      await serviceVariablesApi.delete(serviceId, id);
      await refreshVariables();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete service variable');
    } finally {
      setSavingVars(false);
    }
  };

  const addVariable = async () => {
    const key = newKey.trim();
    if (!key) return;

    setSavingVars(true);
    setError(null);
    try {
      await serviceVariablesApi.upsert(serviceId, {
        environmentId: newEnvironmentId || null,
        key,
        value: newValue,
        isSecret: newSecret,
        enabled: newEnabled,
      });
      setNewKey('');
      setNewValue('');
      setNewSecret(false);
      setNewEnabled(true);
      setNewEnvironmentId('');
      await refreshVariables();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add service variable');
    } finally {
      setSavingVars(false);
    }
  };

  const handleAuthTypeChange = (type: AuthType) => {
    setDefaultAuthType(type);
    setDefaultAuthConfig(getDefaultAuthConfig(type));
  };

  const updateAuthField = (field: string, value: string) => {
    setDefaultAuthConfig((prev) => ({ ...prev, [field]: value }));
  };

  const renderDynamicInput = (field: string, placeholder: string, type = 'text') => (
    <AutocompleteInput
      value={defaultAuthConfig[field] ?? ''}
      onChange={(value) => updateAuthField(field, value)}
      suggestions={[]}
      dynamicSuggestions={DEFAULT_DYNAMIC_VALUE_SUGGESTIONS}
      type={type}
      placeholder={placeholder}
      className={`${MONO_INPUT_CLASS} w-full`}
    />
  );

  if (!service) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-500">
        Service not found.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#111111] p-5 space-y-5 text-gray-200">
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setServiceSettingsServiceId(null);
          }}
          className="border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 transition-colors"
        >
          Close Settings
        </button>
        <div className="text-xs text-gray-500">
          Service defaults are inherited by requests. Request values override defaults.
        </div>
      </div>

      {error && (
        <div className="border border-rose-900 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      <section className="border border-gray-800 bg-[#1a1a1a] p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Service Settings</h2>
            {metaDirty && (
              <span className="inline-block rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                Unsaved
              </span>
            )}
          </div>
          <DocumentationLink section="requestloom" />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${INPUT_CLASS} h-20`}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1 text-xs uppercase tracking-wide text-gray-500 font-semibold">Default Headers <DocHelpButton section="http" title="Open HTTP header documentation" /></h3>
            <span className="text-[11px] text-gray-400">
              Disabled request header with the same key removes inherited default.
            </span>
          </div>
          <KeyValueEditor
            entries={defaultHeaders}
            onChange={setDefaultHeaders}
            keyPlaceholder="Header name"
            valuePlaceholder="Value"
            keySuggestions={HEADER_KEY_SUGGESTIONS}
            valueSuggestionsMap={HEADER_VALUE_MAP}
            dynamicSuggestions={DEFAULT_DYNAMIC_VALUE_SUGGESTIONS}
            helpSection="http"
            helpTitle="Open HTTP header documentation"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><h3 className="flex items-center gap-1 text-xs uppercase tracking-wide text-gray-500 font-semibold">Default Authorization <DocHelpButton section="http" title="Open authentication documentation" /></h3><DocumentationLink section="http" /></div>
            <span className="text-[11px] text-gray-400">Used when request auth is set to inherit.</span>
          </div>

          <div className="flex gap-2 flex-wrap">
            {AUTH_TYPES.map((type) => (
              <button
                key={type.value}
                onClick={() => handleAuthTypeChange(type.value)}
                className={`border px-3 py-1 text-xs font-medium transition-colors ${
                  defaultAuthType === type.value
                    ? 'border-gray-600 bg-gray-700 text-gray-100'
                    : 'border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800'
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>

          {defaultAuthType === 'basic' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Username</label>
                {renderDynamicInput('username', '{{username}}')}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Password</label>
                {renderDynamicInput('password', '{{password}}', 'password')}
              </div>
            </div>
          )}

          {defaultAuthType === 'bearer' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Token</label>
              {renderDynamicInput('token', '{{token}}')}
            </div>
          )}

          {defaultAuthType === 'apikey' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Key Name</label>
                {renderDynamicInput('key', 'X-API-Key')}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Value</label>
                {renderDynamicInput('value', '{{apiKey}}')}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Add to</label>
                <CustomDropdown
                  value={defaultAuthConfig.in ?? 'header'}
                  onChange={(value) => updateAuthField('in', value)}
                  options={API_KEY_TARGET_OPTIONS}
                  className="w-[190px]"
                />
              </div>
            </div>
          )}

          {defaultAuthType === 'oauth2' && (
            <OAuth2AuthFields
              config={defaultAuthConfig}
              onChange={setDefaultAuthConfig}
              ownerKey={'service:' + service.id}
            />
          )}

          {defaultAuthType === 'none' && (
            <p className="text-xs text-gray-400">No default authorization will be applied.</p>
          )}
        </div>

        <button
          onClick={saveMetadata}
          disabled={savingMeta || !name.trim()}
          className="border border-gray-600 bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {savingMeta ? 'Saving...' : 'Save Service Settings'}
        </button>
      </section>

      <section className="border border-gray-800 bg-[#1a1a1a] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Service Variables</h3>
          {varsDirty && (
            <span className="inline-block rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              Unsaved
            </span>
          )}
        </div>

        {loadingVars && (
          <div className="text-xs text-gray-500">Loading variables...</div>
        )}

        <div className="space-y-2">
          {variables.map((variable) => {
            const draft = drafts[variable.id];
            if (!draft) return null;

            return (
              <div key={variable.id} className="border border-gray-800 bg-gray-900/50 p-2.5">
                <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(130px,1fr)_minmax(220px,1.4fr)_minmax(240px,auto)] xl:items-center">
                  <input
                    type="text"
                    value={draft.key}
                    onChange={(e) => updateDraft(variable.id, { key: e.target.value })}
                    className={`${MONO_INPUT_CLASS} w-full`}
                  />
                <AutocompleteInput
                  value={draft.value}
                  onChange={(value) => updateDraft(variable.id, { value })}
                  suggestions={[]}
                  dynamicSuggestions={DEFAULT_DYNAMIC_VALUE_SUGGESTIONS}
                  type={draft.isSecret && !draft.reveal ? 'password' : 'text'}
                  className={`${MONO_INPUT_CLASS} w-full`}
                />
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    <CustomDropdown
                      value={draft.environmentId ?? ''}
                      onChange={(environmentId) => updateDraft(variable.id, { environmentId: environmentId || null })}
                      options={environmentScopeOptions}
                      className="w-[138px]"
                      buttonClassName="px-2 py-1 text-[11px]"
                      menuClassName="w-[200px]"
                    />
                    <ToggleSwitch
                      label="Secret"
                      checked={draft.isSecret}
                      onChange={(checked) => updateDraft(variable.id, { isSecret: checked })}
                    />
                    <ToggleSwitch
                      label="Enabled"
                      checked={draft.enabled}
                      onChange={(checked) => updateDraft(variable.id, { enabled: checked })}
                    />
                    <button
                      onClick={() => updateDraft(variable.id, { reveal: !draft.reveal })}
                      className="border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
                    >
                      {draft.reveal ? 'Hide' : 'Show'}
                    </button>
                    <button
                      onClick={() => saveVariable(variable)}
                      disabled={savingVars}
                      className={SMALL_PRIMARY_BUTTON}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => deleteVariable(variable.id)}
                      disabled={savingVars}
                      className={SMALL_DANGER_BUTTON}
                    >
                      Del
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border border-dashed border-gray-700 bg-gray-900/40 p-2.5">
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(130px,1fr)_minmax(220px,1.4fr)_minmax(220px,auto)] xl:items-center">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="key"
              className={`${MONO_INPUT_CLASS} w-full`}
            />
            <AutocompleteInput
              value={newValue}
              onChange={setNewValue}
              suggestions={[]}
              dynamicSuggestions={DEFAULT_DYNAMIC_VALUE_SUGGESTIONS}
              type={newSecret ? 'password' : 'text'}
              placeholder="value"
              className={`${MONO_INPUT_CLASS} w-full`}
            />
            <div className="flex flex-wrap items-center justify-end gap-1">
              <CustomDropdown
                value={newEnvironmentId}
                onChange={setNewEnvironmentId}
                options={environmentScopeOptions}
                className="w-[138px]"
                buttonClassName="px-2 py-1 text-[11px]"
                menuClassName="w-[200px]"
              />
              <ToggleSwitch
                label="Secret"
                checked={newSecret}
                onChange={setNewSecret}
              />
              <ToggleSwitch
                label="Enabled"
                checked={newEnabled}
                onChange={setNewEnabled}
              />
              <button
                onClick={addVariable}
                disabled={savingVars}
                className="border border-gray-600 bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
