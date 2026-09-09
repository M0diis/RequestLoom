import { useState, useEffect, useRef } from 'react';
import type { ApiRequest, ServiceAuth } from '../../types';
import { AutocompleteInput } from '../common/AutocompleteInput';
import { OAuth2AuthFields } from '../common/OAuth2AuthFields';
import { DocumentationLink, DocHelpButton } from '../documentation/DocumentationLink';
import { VariablePreview } from '../common/VariablePreview';
import type { ResolvedVariableLookup } from '../common/variablePreviewUtils';

interface Props {
  request: ApiRequest;
  serviceAuth?: ServiceAuth | null;
  onUpdate: (id: string, data: Partial<ApiRequest>) => Promise<void>;
  dynamicSuggestions?: string[];
  resolvedVariables?: ResolvedVariableLookup;
  variableResolutionReady?: boolean;
}

type RequestAuthOption = 'inherit' | 'none' | 'basic' | 'bearer' | 'apikey' | 'oauth2';

const AUTH_TYPES: { value: RequestAuthOption; label: string }[] = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'none', label: 'None' },
  { value: 'basic', label: 'Basic' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apikey', label: 'API Key' },
  { value: 'oauth2', label: 'OAuth2 / OIDC' },
];

function normalizeAuthType(authType: string | null | undefined, allowInheritance: boolean): RequestAuthOption {
  if (!authType) {
    return allowInheritance ? 'inherit' : 'none';
  }

  const normalized = authType.toLowerCase();
  if (normalized === 'inherit' && !allowInheritance) return 'none';
  if (normalized === 'inherit' || normalized === 'none' || normalized === 'basic' || normalized === 'bearer' || normalized === 'apikey' || normalized === 'oauth2') {
    return normalized;
  }

  return 'none';
}

function getAuthTypeLabel(authType: string | null | undefined): string {
  const normalized = authType?.trim().toLowerCase();
  return AUTH_TYPES.find((type) => type.value === normalized)?.label ?? 'None';
}

export function AuthEditor({ request, serviceAuth = null, onUpdate, dynamicSuggestions = [], resolvedVariables, variableResolutionReady = true }: Props) {
  const allowInheritance = Boolean(request.serviceId);
  const authType = normalizeAuthType(request.auth?.authType, allowInheritance);
  const authTypes = allowInheritance ? AUTH_TYPES : AUTH_TYPES.filter((type) => type.value !== 'inherit');
  const [config, setConfig] = useState<Record<string, string>>({});
  const configCache = useRef<Partial<Record<RequestAuthOption, Record<string, string>>>>({});
  const cacheRequestId = useRef(request.id);

  useEffect(() => {
    if (cacheRequestId.current !== request.id) {
      configCache.current = {};
      cacheRequestId.current = request.id;
    }

    let parsed: Record<string, string> = {};
    if (request.auth?.configJson) {
      try { parsed = JSON.parse(request.auth.configJson); } catch { parsed = {}; }
    }
    configCache.current[authType] = parsed;
    setConfig(parsed);
  }, [authType, request.auth?.configJson, request.id]);

  const saveAuth = (type: RequestAuthOption, newConfig: Record<string, string>) => {
    onUpdate(request.id, {
      auth: type === 'inherit' && allowInheritance ? null : {
        id: request.auth?.id ?? '',
        requestId: request.id,
        authType: type === 'inherit' ? 'none' : type,
        configJson: JSON.stringify(newConfig),
      },
    });
  };

  const handleTypeChange = (type: RequestAuthOption) => {
    const defaultConfigs: Record<string, Record<string, string>> = {
      inherit: {},
      none: {},
      basic: { username: '', password: '' },
      bearer: { token: '' },
      apikey: { key: '', value: '', in: 'header' },
      oauth2: {
        authorizationUrl: '',
        tokenUrl: '',
        issuer: '',
        clientId: '',
        clientSecret: '',
        scope: 'openid profile email',
        redirectUri: '',
        audience: '',
        clientAuthenticationMethod: 'client_secret_post',
      },
    };
    configCache.current[authType] = config;
    const nextConfig = configCache.current[type] ?? defaultConfigs[type] ?? {};
    configCache.current[type] = nextConfig;
    setConfig(nextConfig);
    saveAuth(type, nextConfig);
  };

  const updateField = (field: string, value: string) => {
    const newConfig = { ...config, [field]: value };
    configCache.current[authType] = newConfig;
    setConfig(newConfig);
    saveAuth(authType, newConfig);
  };

  const renderInput = (field: string, placeholder: string, type = 'text') => {
    const value = config[field] ?? '';
    const sensitive = field === 'password' || field === 'token' || field === 'value' || field === 'clientSecret';
    const input = dynamicSuggestions.length > 0 ? (
        <AutocompleteInput
          value={value}
          onChange={(next) => updateField(field, next)}
          suggestions={[]}
          dynamicSuggestions={dynamicSuggestions}
          placeholder={placeholder}
          type={type}
          className="w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500"
        />
      ) : (
      <input
        type={type}
        value={value}
        onChange={(event) => updateField(field, event.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500"
      />
    );

    return (
      <div>
        {input}
        <VariablePreview
          value={value}
          variables={resolvedVariables}
          ready={variableResolutionReady}
          sensitive={sensitive}
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Auth type</span>
        </div>
        <div className="flex items-center gap-2">
          <DocumentationLink section="http" />
          <DocHelpButton section="http" title="Open authentication documentation" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {authTypes.map((at) => (
          <button
            key={at.value}
            onClick={() => handleTypeChange(at.value)}
            className={`border px-3 py-1 text-xs font-medium ${
              authType === at.value
                ? 'border-gray-600 bg-gray-700 text-gray-100'
                : 'border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800'
            }`}
          >
            {at.label}
          </button>
        ))}
      </div>

      {authType === 'basic' && (
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Username</label>
            {renderInput('username', '{{username}}')}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Password</label>
            {renderInput('password', '{{password}}', 'password')}
          </div>
        </div>
      )}

      {authType === 'bearer' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Token</label>
          {renderInput('token', '{{token}}')}
        </div>
      )}

      {authType === 'apikey' && (
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Key Name</label>
            {renderInput('key', 'X-API-Key')}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Value</label>
            {renderInput('value', '{{apiKey}}')}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Add to</label>
            <select
              value={config.in ?? 'header'}
              onChange={(e) => updateField('in', e.target.value)}
              className="border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-gray-500"
            >
              <option value="header">Header</option>
              <option value="query">Query Parameter</option>
            </select>
          </div>
        </div>
      )}

      {authType === 'oauth2' && (
        <OAuth2AuthFields
          config={config}
          onChange={(nextConfig) => {
            setConfig(nextConfig);
            configCache.current.oauth2 = nextConfig;
            saveAuth('oauth2', nextConfig);
          }}
          ownerKey={'request:' + request.id}
          resolvedVariables={resolvedVariables}
          variableResolutionReady={variableResolutionReady}
        />
      )}

      {allowInheritance && authType === 'inherit' && (
        <div className="border border-gray-800 bg-gray-900/50 px-3 py-2 text-xs">
          <p className="text-gray-400">Inherit authentication from service settings.</p>
          <p className="mt-1 text-gray-300">
            Using: <span className="font-medium text-gray-100">{getAuthTypeLabel(serviceAuth?.authType)}</span>
          </p>
          {(!serviceAuth || normalizeAuthType(serviceAuth.authType, true) === 'none') && (
            <p className="mt-1 text-[11px] text-gray-500">No authentication will be sent with this request.</p>
          )}
        </div>
      )}

      {authType === 'none' && (
        <p className="text-xs text-gray-400">No authentication will be sent with this request.{allowInheritance ? ' Service defaults are ignored.' : ' Top-level requests use only their own settings.'}</p>
      )}
    </div>
  );
}
