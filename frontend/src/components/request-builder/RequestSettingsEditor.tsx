import { useCallback, useEffect, useRef, useState } from 'react';
import { requestsApi } from '../../services/api';
import { useSettingsStore } from '../../stores/settingsStore';
import type { ApiRequestSettings } from '../../types';

interface RequestSettingsEditorProps {
  requestId: string;
}

const SECTION_LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const INPUT =
  'mt-1 w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 focus:border-[#ff6c37]/60 focus:outline-none';
const UNCHECKED_CHECKBOX = 'h-3.5 w-3.5 accent-[#ff6c37]';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function RequestSettingsEditor({ requestId }: RequestSettingsEditorProps) {
  const globalSettings = useSettingsStore((s) => s.settings);

  const [followRedirects, setFollowRedirects] = useState(true);
  const [ignoreSsl, setIgnoreSsl] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void requestsApi
      .getSettings(requestId)
      .then((s) => {
        if (cancelled) return;
        setFollowRedirects(s.followRedirects);
        setIgnoreSsl(s.ignoreSslErrors);
        setTimeoutSeconds(s.timeoutSeconds == null ? '' : String(s.timeoutSeconds));
        setSaveStatus('idle');
      })
      .catch(() => {
        if (!cancelled) setSaveStatus('error');
      });
    return () => {
      cancelled = true;
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
    (follow: boolean, ssl: boolean, timeoutRaw: string) => {
      const trimmed = timeoutRaw.trim();
      let parsed: number | null = null;
      if (trimmed !== '') {
        const value = Number(trimmed);
        parsed = Number.isFinite(value) && value > 0 ? Math.round(value) : null;
      }
      autoSave({
        requestId,
        followRedirects: follow,
        ignoreSslErrors: ssl,
        timeoutSeconds: parsed,
      });
    },
    [requestId, autoSave],
  );

  const globalHint =
    globalSettings && globalSettings.requestTimeoutMs > 0
      ? `Global timeout: ${Math.round(globalSettings.requestTimeoutMs / 1000)}s (leave 0 to use it)`
      : 'Global timeout: none';

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
              buildAndSave(e.target.checked, ignoreSsl, timeoutSeconds);
            }}
            className={UNCHECKED_CHECKBOX}
          />
          Follow redirects
        </label>
        <p className="mt-1 text-[11px] text-gray-500">
          Automatically follow 3xx redirects. Disable to inspect the raw redirect response.
        </p>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={ignoreSsl}
            onChange={(e) => {
              setIgnoreSsl(e.target.checked);
              buildAndSave(followRedirects, e.target.checked, timeoutSeconds);
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
        <label className={SECTION_LABEL}>Timeout</label>
        <input
          type="number"
          min={0}
          step={1}
          placeholder="0 = use global"
          value={timeoutSeconds}
          onChange={(e) => {
            setTimeoutSeconds(e.target.value);
            buildAndSave(followRedirects, ignoreSsl, e.target.value);
          }}
          className={INPUT}
          title="Per-request timeout in seconds. 0 uses the global timeout."
        />
        <p className="mt-1 text-[11px] text-gray-500">{globalHint}</p>
      </section>

      <div className="flex items-center justify-end gap-2 text-[11px]">
        {saveStatus === 'saving' && <span className="text-gray-500">Saving…</span>}
        {saveStatus === 'saved' && <span className="text-emerald-400">Saved</span>}
        {saveStatus === 'error' && <span className="text-rose-400">Save failed</span>}
      </div>
    </div>
  );
}