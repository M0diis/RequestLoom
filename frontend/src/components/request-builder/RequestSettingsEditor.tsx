import { useCallback, useEffect, useRef, useState } from 'react';
import { requestsApi } from '../../services/api';
import { useSettingsStore } from '../../stores/settingsStore';
import type { ApiRequestSettings, RequestProxyMode } from '../../types';
import CookieJarPanel from './CookieJarPanel';

interface RequestSettingsEditorProps {
  requestId: string;
  workspaceId: string;
}

const SECTION_LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const INPUT =
  'mt-1 w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 focus:border-[#ff6c37]/60 focus:outline-none';
const UNCHECKED_CHECKBOX = 'h-3.5 w-3.5 accent-[#ff6c37]';
const MAX_REDIRECTS = 50;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function RequestSettingsEditor({ requestId, workspaceId }: RequestSettingsEditorProps) {
  const globalSettings = useSettingsStore((s) => s.settings);

  const [followRedirects, setFollowRedirects] = useState(true);
  const [maxRedirects, setMaxRedirects] = useState('10');
  const [ignoreSsl, setIgnoreSsl] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState('');
  const [proxyMode, setProxyMode] = useState<RequestProxyMode>('inherit');
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyUsername, setProxyUsername] = useState('');
  const [proxyPassword, setProxyPassword] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void requestsApi
      .getSettings(requestId)
      .then((s) => {
        if (cancelled) return;
        setFollowRedirects(s.followRedirects);
        setMaxRedirects(String(s.maxRedirects || 10));
        setIgnoreSsl(s.ignoreSslErrors);
        setTimeoutSeconds(s.timeoutSeconds == null ? '' : String(s.timeoutSeconds));
        setProxyMode(s.proxyMode || 'inherit');
        setProxyUrl(s.proxyUrl || '');
        setProxyUsername(s.proxyUsername || '');
        setProxyPassword(s.proxyPassword || '');
        setSaveStatus('idle');
      })
      .catch(() => {
        if (!cancelled) setSaveStatus('error');
      });
    return () => {
      cancelled = true;
      window.clearTimeout(debounceRef.current);
    };
  }, [requestId]);

  const autoSave = useCallback(
    (next: ApiRequestSettings) => {
      window.clearTimeout(debounceRef.current);
      setSaveStatus('saving');
      debounceRef.current = window.setTimeout(() => {
        void requestsApi
          .saveSettings(requestId, next)
          .then(() => setSaveStatus('saved'))
          .catch(() => setSaveStatus('error'));
      }, 400);
    },
    [requestId],
  );

  const buildAndSave = useCallback(
    (
      follow: boolean,
      redirectsRaw: string,
      ssl: boolean,
      timeoutRaw: string,
      nextProxyMode: RequestProxyMode,
      nextProxyUrl: string,
      nextProxyUsername: string,
      nextProxyPassword: string,
    ) => {
      const timeout = timeoutRaw.trim();
      const timeoutValue = timeout === '' ? null : Number(timeout);
      const redirectValue = Number(redirectsRaw);
      autoSave({
        requestId,
        followRedirects: follow,
        maxRedirects: Number.isInteger(redirectValue) && redirectValue >= 1 && redirectValue <= MAX_REDIRECTS
          ? redirectValue
          : 10,
        ignoreSslErrors: ssl,
        timeoutSeconds: Number.isFinite(timeoutValue) && (timeoutValue ?? 0) > 0 ? Math.round(timeoutValue as number) : null,
        proxyMode: nextProxyMode,
        proxyUrl: nextProxyUrl.trim(),
        proxyUsername: nextProxyUsername,
        proxyPassword: nextProxyPassword,
      });
    },
    [autoSave, requestId],
  );

  const saveCurrent = (changes: Partial<{
    follow: boolean;
    redirects: string;
    ssl: boolean;
    timeout: string;
    mode: RequestProxyMode;
    url: string;
    username: string;
    password: string;
  }> = {}) => buildAndSave(
    changes.follow ?? followRedirects,
    changes.redirects ?? maxRedirects,
    changes.ssl ?? ignoreSsl,
    changes.timeout ?? timeoutSeconds,
    changes.mode ?? proxyMode,
    changes.url ?? proxyUrl,
    changes.username ?? proxyUsername,
    changes.password ?? proxyPassword,
  );

  const globalHint =
    globalSettings && globalSettings.requestTimeoutMs > 0
      ? `Global timeout: ${Math.round(globalSettings.requestTimeoutMs / 1000)}s (leave empty to use it)`
      : 'Global timeout: none';
  const globalProxyHint = globalSettings?.proxyEnabled
    ? `Global proxy: ${globalSettings.proxyUrl || 'configured'}`
    : 'Global proxy: disabled';

  return (
    <div className="space-y-4">
      <section>
        <label className={SECTION_LABEL}>Execution</label>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={followRedirects}
            onChange={(e) => {
              setFollowRedirects(e.target.checked);
              saveCurrent({ follow: e.target.checked });
            }}
            className={UNCHECKED_CHECKBOX}
          />
          Follow redirects
        </label>
        <p className="mt-1 text-[11px] text-gray-500">
          Automatically follow 3xx redirects. Disable to inspect the raw redirect response.
        </p>

        <label className="mt-3 block text-[11px] text-gray-400" htmlFor="request-max-redirects">
          Max redirects
        </label>
        <input
          id="request-max-redirects"
          type="number"
          min={1}
          max={MAX_REDIRECTS}
          step={1}
          value={maxRedirects}
          onChange={(e) => {
            setMaxRedirects(e.target.value);
            saveCurrent({ redirects: e.target.value });
          }}
          disabled={!followRedirects}
          className={`${INPUT} disabled:opacity-50`}
          title="Maximum redirects for this request"
        />
        <p className="mt-1 text-[11px] text-gray-500">
          Global default: {globalSettings?.maxRedirects ?? 10} (1–{MAX_REDIRECTS}).
        </p>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={ignoreSsl}
            onChange={(e) => {
              setIgnoreSsl(e.target.checked);
              saveCurrent({ ssl: e.target.checked });
            }}
            className={UNCHECKED_CHECKBOX}
          />
          Ignore TLS/SSL certificate errors
        </label>
        <p className="mt-1 text-[11px] text-gray-500">
          Bypass certificate validation for this request (e.g. self-signed certificates).
        </p>
      </section>

      <section>
        <label className={SECTION_LABEL}>Proxy</label>
        <label className="block text-[11px] text-gray-400" htmlFor="request-proxy-mode">
          Proxy behavior
        </label>
        <select
          id="request-proxy-mode"
          value={proxyMode}
          onChange={(e) => {
            const next = e.target.value as RequestProxyMode;
            setProxyMode(next);
            saveCurrent({ mode: next });
          }}
          className={`${INPUT} cursor-pointer`}
        >
          <option value="inherit">Use global proxy</option>
          <option value="custom">Use a custom proxy</option>
          <option value="disabled">Disable proxy for this request</option>
        </select>
        {proxyMode === 'custom' ? (
          <>
            <label className="mt-3 block text-[11px] text-gray-400" htmlFor="request-proxy-url">
              Proxy URL
            </label>
            <input
              id="request-proxy-url"
              type="text"
              placeholder="http://localhost:8888"
              value={proxyUrl}
              onChange={(e) => {
                setProxyUrl(e.target.value);
                saveCurrent({ url: e.target.value });
              }}
              className={INPUT}
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Username (optional)"
                value={proxyUsername}
                onChange={(e) => {
                  setProxyUsername(e.target.value);
                  saveCurrent({ username: e.target.value });
                }}
                className={INPUT}
                autoComplete="off"
              />
              <input
                type="password"
                placeholder="Password (optional)"
                value={proxyPassword}
                onChange={(e) => {
                  setProxyPassword(e.target.value);
                  saveCurrent({ password: e.target.value });
                }}
                className={INPUT}
                autoComplete="new-password"
              />
            </div>
          </>
        ) : (
          <p className="mt-1 text-[11px] text-gray-500">{globalProxyHint}</p>
        )}
      </section>

      <section>
        <label className={SECTION_LABEL}>Timeout</label>
        <input
          type="number"
          min={0}
          step={1}
          placeholder="Empty = use global"
          value={timeoutSeconds}
          onChange={(e) => {
            setTimeoutSeconds(e.target.value);
            saveCurrent({ timeout: e.target.value });
          }}
          className={INPUT}
          title="Per-request timeout in seconds. Empty or 0 uses the global timeout."
        />
        <p className="mt-1 text-[11px] text-gray-500">{globalHint}</p>
      </section>

      <CookieJarPanel workspaceId={workspaceId} />

      <div className="flex items-center justify-end gap-2 text-[11px]">
        {saveStatus === 'saving' && <span className="text-gray-500">Saving…</span>}
        {saveStatus === 'saved' && <span className="text-emerald-400">Saved</span>}
        {saveStatus === 'error' && <span className="text-rose-400">Save failed</span>}
      </div>
    </div>
  );
}
