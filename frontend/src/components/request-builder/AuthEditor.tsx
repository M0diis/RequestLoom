import { useState, useEffect } from 'react';
import type { ApiRequest } from '../../types';

interface Props {
  request: ApiRequest;
  onUpdate: (id: string, data: Partial<ApiRequest>) => Promise<void>;
}

type RequestAuthOption = 'inherit' | 'none' | 'basic' | 'bearer' | 'apikey';

const AUTH_TYPES: { value: RequestAuthOption; label: string }[] = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'none', label: 'None' },
  { value: 'basic', label: 'Basic' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apikey', label: 'API Key' },
];

function normalizeAuthType(authType: string | null | undefined): RequestAuthOption {
  if (!authType) {
    return 'inherit';
  }

  const normalized = authType.toLowerCase();
  if (normalized === 'inherit' || normalized === 'none' || normalized === 'basic' || normalized === 'bearer' || normalized === 'apikey') {
    return normalized;
  }

  return 'none';
}

export function AuthEditor({ request, onUpdate }: Props) {
  const authType = normalizeAuthType(request.auth?.authType);
  const [config, setConfig] = useState<Record<string, string>>({});

  useEffect(() => {
    if (request.auth?.configJson) {
      try { setConfig(JSON.parse(request.auth.configJson)); } catch { setConfig({}); }
    } else {
      setConfig({});
    }
  }, [request.auth?.configJson]);

  const saveAuth = (type: RequestAuthOption, newConfig: Record<string, string>) => {
    onUpdate(request.id, {
      auth: type === 'inherit' ? null : {
        id: request.auth?.id ?? '',
        requestId: request.id,
        authType: type,
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
    };
    setConfig(defaultConfigs[type] || {});
    saveAuth(type, defaultConfigs[type] || {});
  };

  const updateField = (field: string, value: string) => {
    const newConfig = { ...config, [field]: value };
    setConfig(newConfig);
    saveAuth(authType, newConfig);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {AUTH_TYPES.map((at) => (
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
            <input
              type="text"
              value={config.username ?? ''}
              onChange={(e) => updateField('username', e.target.value)}
              placeholder="{{username}}"
              className="w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Password</label>
            <input
              type="password"
              value={config.password ?? ''}
              onChange={(e) => updateField('password', e.target.value)}
              placeholder="{{password}}"
              className="w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500"
            />
          </div>
        </div>
      )}

      {authType === 'bearer' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Token</label>
          <input
            type="text"
            value={config.token ?? ''}
            onChange={(e) => updateField('token', e.target.value)}
            placeholder="{{token}}"
            className="w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500"
          />
        </div>
      )}

      {authType === 'apikey' && (
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Key Name</label>
            <input
              type="text"
              value={config.key ?? ''}
              onChange={(e) => updateField('key', e.target.value)}
              placeholder="X-API-Key"
              className="w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Value</label>
            <input
              type="text"
              value={config.value ?? ''}
              onChange={(e) => updateField('value', e.target.value)}
              placeholder="{{apiKey}}"
              className="w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500"
            />
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

      {authType === 'inherit' && (
        <p className="text-xs text-gray-400">Inherit authentication from service settings.</p>
      )}

      {authType === 'none' && (
        <p className="text-xs text-gray-400">No authentication will be sent with this request. Service defaults are ignored.</p>
      )}
    </div>
  );
}
