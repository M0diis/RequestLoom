import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { JsonStorageStrategy, StorageMode, SettingsUpdate } from '../../types';
import { ConfirmModal } from './ConfirmModal';

interface Props {
  onClose: () => void;
}

const BTN_PRIMARY = 'border border-[#ff6c37] bg-[#ff6c37] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#f95e26] disabled:opacity-50';
const BTN_SECONDARY = 'border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50';
const BTN_DANGER = 'border border-rose-800 bg-rose-950/60 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-900/60 disabled:opacity-50';
const SECTION_LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const INPUT = 'mt-1 w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 focus:border-[#ff6c37]/60 focus:outline-none';
const TAB =
  'border-b-2 px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ' +
  'data-[active=true]:border-[#ff6c37] data-[active=true]:text-[#ffb59a] ' +
  'data-[active=false]:border-transparent data-[active=false]:text-gray-400 data-[active=false]:hover:text-gray-200';
const UNCHECKED_CHECKBOX = 'h-3.5 w-3.5 accent-[#ff6c37]';

const MODE_OPTIONS: { value: StorageMode; label: string; description: string }[] = [
  {
    value: 'sqlite',
    label: 'Database file (SQLite)',
    description: 'Stores all data in a single .db file. Best for larger workspaces.',
  },
  {
    value: 'json',
    label: 'JSON file',
    description: 'Stores all data in a human-readable .json file. Easy to inspect and version.',
  },
];

const JSON_STRATEGY_OPTIONS: { value: JsonStorageStrategy; label: string; description: string }[] = [
  {
    value: 'single',
    label: 'Single JSON file',
    description: 'Keep all workspace data and requests in one readable JSON file.',
  },
  {
    value: 'perCollection',
    label: 'JSON per collection',
    description: 'Keep each collection and its requests in its own JSON file.',
  },
];

type TabId = 'general' | 'requests' | 'response' | 'shortcuts' | 'data';

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'requests', label: 'Requests' },
  { id: 'response', label: 'Response' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'data', label: 'Data' },
];

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl / Cmd + Enter', action: 'Send the current request' },
  { keys: 'Ctrl / Cmd + Alt + 1', action: 'Switch to Services panel' },
  { keys: 'Ctrl / Cmd + Alt + 2', action: 'Switch to Variables panel' },
  { keys: 'Ctrl / Cmd + Alt + 3', action: 'Switch to Mock Servers panel' },
  { keys: 'Ctrl / Cmd + Alt + L', action: 'Toggle response layout (bottom/right)' },
  { keys: 'Ctrl / Cmd + Alt + P', action: 'Toggle response view (pretty/raw)' },
];

export function SettingsModal({ onClose }: Props) {
  const { settings, loading, load, update, migrateStorage, generateExamples, clearAllData } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [selectedMode, setSelectedMode] = useState<StorageMode>('sqlite');
  const [selectedJsonStrategy, setSelectedJsonStrategy] = useState<JsonStorageStrategy>('single');
  const [timeoutSec, setTimeoutSec] = useState('120');
  const [followRedirects, setFollowRedirects] = useState(true);
  const [maxRedirects, setMaxRedirects] = useState('10');
  const [maxSizeMb, setMaxSizeMb] = useState('0');
  const [ignoreSsl, setIgnoreSsl] = useState(false);
  const [responseFormat, setResponseFormat] = useState<'pretty' | 'raw'>('pretty');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyUsername, setProxyUsername] = useState('');
  const [proxyPassword, setProxyPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ restartRequired: boolean } | null>(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataMessage, setDataMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingStorageMigration, setPendingStorageMigration] = useState<SettingsUpdate | null>(null);
  const [examplesGenerated, setExamplesGenerated] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!settings) return;
    setSelectedMode(settings.storageMode);
    setSelectedJsonStrategy(settings.jsonStorageStrategy);
    setTimeoutSec(String(Math.round(settings.requestTimeoutMs / 1000)));
    setFollowRedirects(settings.followRedirects);
    setMaxRedirects(String(settings.maxRedirects));
    setMaxSizeMb(String(settings.maxResponseBodySizeMb));
    setIgnoreSsl(settings.ignoreSslErrors);
    setResponseFormat(settings.responseFormat === 'raw' ? 'raw' : 'pretty');
    setProxyEnabled(settings.proxyEnabled);
    setProxyUrl(settings.proxyUrl);
    setProxyUsername(settings.proxyUsername);
    setProxyPassword(settings.proxyPassword);
  }, [settings]);

  const handleSave = async () => {
    if (!settings) return;

    const timeout = Number(timeoutSec);
    const redirectLimit = Number(maxRedirects);
    const maxSize = Number(maxSizeMb);
    if (!Number.isFinite(timeout) || timeout < 0) {
      setError('Timeout must be zero or a positive number of seconds.');
      return;
    }
    if (!Number.isFinite(maxSize) || maxSize < 0) {
      setError('Max response size must be zero or a positive number of megabytes.');
      return;
    }
    if (!Number.isInteger(redirectLimit) || redirectLimit < 1 || redirectLimit > 50) {
      setError('Max redirects must be a whole number between 1 and 50.');
      return;
    }
    if (proxyEnabled && proxyUrl.trim() !== '') {
      try {
        new URL(proxyUrl.trim());
      } catch {
        setError('Proxy URL must be a valid URL such as http://localhost:8888.');
        return;
      }
    }

    const patch: SettingsUpdate = {
      storageMode: selectedMode,
      jsonStorageStrategy: selectedJsonStrategy,
      requestTimeoutMs: Math.round(timeout * 1000),
      followRedirects,
      maxRedirects: redirectLimit,
      ignoreSslErrors: ignoreSsl,
      maxResponseBodySizeMb: Math.round(maxSize),
      responseFormat,
      proxyEnabled,
      proxyUrl: proxyUrl.trim(),
      proxyUsername: proxyUsername.trim(),
      proxyPassword,
    };

    if (modeChanged) {
      setError(null);
      setPendingStorageMigration(patch);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await update(patch);
      setSaved({ restartRequired: result.restartRequired });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setBusy(false);
    }
  };

  const handleMigrateStorage = async () => {
    if (!pendingStorageMigration) return;

    setBusy(true);
    setError(null);
    try {
      const result = await migrateStorage(pendingStorageMigration);
      setPendingStorageMigration(null);
      setSaved({ restartRequired: result.restartRequired });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to migrate storage');
    } finally {
      setBusy(false);
    }
  };

  const handleReloadApp = async () => {
    setBusy(true);
    setError(null);
    try {
      if (window.desktopShell) {
        const reloaded = await window.desktopShell.reloadApp();
        if (!reloaded) throw new Error('The app could not be reloaded.');
      } else {
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload the app');
      setBusy(false);
    }
  };

  const modeChanged = settings != null && (
    selectedMode !== settings.storageMode ||
    selectedJsonStrategy !== settings.jsonStorageStrategy
  );

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <div className="flex h-[min(540px,85vh)] w-full max-w-md flex-col border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
        <div className="border-b border-gray-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-100">Settings</h3>
          <p className="mt-1 text-xs text-gray-500">Application preferences and storage options.</p>
        </div>

        <div className="flex gap-1 border-b border-gray-800 px-2 pt-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
              }}
              disabled={busy}
              className={TAB}
              data-active={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading || !settings ? (
            <p className="text-xs text-gray-500">Loading settings...</p>
          ) : (
            <div className="space-y-5">
              {activeTab === 'general' && (
                <section>
                  <label className={SECTION_LABEL}>Storage</label>
                  <div className="space-y-2">
                    {MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setSelectedMode(option.value);
                          setSaved(null);
                        }}
                        disabled={busy}
                        className={`w-full border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                          selectedMode === option.value
                            ? 'border-[#ff6c37]/60 bg-[#ff6c37]/10'
                            : 'border-gray-700 bg-gray-900 hover:bg-gray-800'
                        }`}
                      >
                        <span className={`block text-xs font-semibold ${selectedMode === option.value ? 'text-[#ffbca3]' : 'text-gray-200'}`}>
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-gray-500">{option.description}</span>
                      </button>
                    ))}
                  </div>

                  {selectedMode === 'json' && (
                    <div className="mt-3 space-y-2">
                      <label className={SECTION_LABEL}>JSON layout</label>
                      {JSON_STRATEGY_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setSelectedJsonStrategy(option.value);
                            setSaved(null);
                          }}
                          disabled={busy}
                          className={`w-full border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                            selectedJsonStrategy === option.value
                              ? 'border-[#ff6c37]/60 bg-[#ff6c37]/10'
                              : 'border-gray-700 bg-gray-900 hover:bg-gray-800'
                          }`}
                        >
                          <span className={`block text-xs font-semibold ${selectedJsonStrategy === option.value ? 'text-[#ffbca3]' : 'text-gray-200'}`}>
                            {option.label}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-gray-500">{option.description}</span>
                        </button>
                      ))}
                      <p className="text-[11px] text-gray-500">
                        New collections will ask for a folder when this is enabled.
                      </p>
                    </div>
                  )}

                  <div className="mt-3 rounded border border-gray-800 bg-gray-900/50 px-3 py-2">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Data location</span>
                    <span className="mt-0.5 block break-all font-mono text-[11px] text-gray-400">
                      {settings.storagePath}
                    </span>
                  </div>

                  {modeChanged && !saved && (
                    <p className="mt-3 rounded border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
                      Saving a storage change will migrate all data and require an app reload.
                    </p>
                  )}
                </section>
              )}

              {activeTab === 'requests' && (
                <>
                  <section>
                    <label className={SECTION_LABEL}>Requests</label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={followRedirects}
                        onChange={(e) => {
                          setFollowRedirects(e.target.checked);
                          setSaved(null);
                        }}
                        disabled={busy}
                        className={UNCHECKED_CHECKBOX}
                      />
                      Follow redirects by default
                    </label>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-gray-400" htmlFor="settings-timeout">
                          Timeout (seconds)
                        </label>
                        <input
                          id="settings-timeout"
                          type="number"
                          min={0}
                          step={1}
                          value={timeoutSec}
                          onChange={(e) => {
                            setTimeoutSec(e.target.value);
                            setSaved(null);
                          }}
                          disabled={busy}
                          className={INPUT}
                          title="0 = no timeout"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-400" htmlFor="settings-max-redirects">
                          Max redirects
                        </label>
                        <input
                          id="settings-max-redirects"
                          type="number"
                          min={1}
                          max={50}
                          step={1}
                          value={maxRedirects}
                          onChange={(e) => {
                            setMaxRedirects(e.target.value);
                            setSaved(null);
                          }}
                          disabled={busy || !followRedirects}
                          className={`${INPUT} disabled:opacity-50`}
                          title="Maximum automatic redirects per request"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[11px] text-gray-400" htmlFor="settings-max-size">
                          Max response size (MB)
                        </label>
                        <input
                          id="settings-max-size"
                          type="number"
                          min={0}
                          step={1}
                          value={maxSizeMb}
                          onChange={(e) => {
                            setMaxSizeMb(e.target.value);
                            setSaved(null);
                          }}
                          disabled={busy}
                          className={INPUT}
                          title="0 = unlimited"
                        />
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      Max redirects is 1–50. Max response size 0 disables the limit; larger responses are truncated.
                    </p>

                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={ignoreSsl}
                        onChange={(e) => {
                          setIgnoreSsl(e.target.checked);
                          setSaved(null);
                        }}
                        disabled={busy}
                        className={UNCHECKED_CHECKBOX}
                      />
                      Ignore TLS/SSL certificate errors
                    </label>
                  </section>

                  <section>
                    <label className={SECTION_LABEL}>Proxy</label>
                    <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={proxyEnabled}
                        onChange={(e) => {
                          setProxyEnabled(e.target.checked);
                          setSaved(null);
                        }}
                        disabled={busy}
                        className={UNCHECKED_CHECKBOX}
                      />
                      Route requests through a proxy
                    </label>

                    <label className="block text-[11px] text-gray-400" htmlFor="settings-proxy-url">
                      Proxy URL
                    </label>
                    <input
                      id="settings-proxy-url"
                      type="text"
                      placeholder="http://localhost:8888"
                      value={proxyUrl}
                      onChange={(e) => {
                        setProxyUrl(e.target.value);
                        setSaved(null);
                      }}
                      disabled={busy || !proxyEnabled}
                      className={`${INPUT} disabled:opacity-50`}
                    />

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-gray-400" htmlFor="settings-proxy-username">
                          Username
                        </label>
                        <input
                          id="settings-proxy-username"
                          type="text"
                          value={proxyUsername}
                          onChange={(e) => {
                            setProxyUsername(e.target.value);
                            setSaved(null);
                          }}
                          disabled={busy || !proxyEnabled}
                          className={`${INPUT} disabled:opacity-50`}
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-400" htmlFor="settings-proxy-password">
                          Password
                        </label>
                        <input
                          id="settings-proxy-password"
                          type="password"
                          value={proxyPassword}
                          onChange={(e) => {
                            setProxyPassword(e.target.value);
                            setSaved(null);
                          }}
                          disabled={busy || !proxyEnabled}
                          className={`${INPUT} disabled:opacity-50`}
                          autoComplete="new-password"
                        />
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      Credentials are optional and stored in the settings file.
                    </p>
                  </section>
                </>
              )}

              {activeTab === 'response' && (
                <section>
                  <label className={SECTION_LABEL}>Response</label>
                  <div className="flex gap-1">
                    {(['pretty', 'raw'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setResponseFormat(mode);
                          setSaved(null);
                        }}
                        disabled={busy}
                        className={`border px-3 py-1 text-xs ${responseFormat === mode ? 'border-[#ff6c37] bg-[#ff6c37]/20 text-[#ffb59a]' : 'border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800'}`}
                      >
                        {mode === 'pretty' ? 'Pretty' : 'Raw'}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">Default view format for response bodies.</p>
                </section>
              )}

              {activeTab === 'shortcuts' && (
                <section>
                  <label className={SECTION_LABEL}>Keyboard shortcuts</label>
                  <ul className="divide-y divide-gray-800 border border-gray-800">
                    {SHORTCUTS.map((shortcut) => (
                      <li key={shortcut.keys} className="flex items-center justify-between gap-4 px-3 py-2">
                        <span className="text-xs text-gray-300">{shortcut.action}</span>
                        <kbd className="shrink-0 border border-gray-700 bg-gray-900 px-1.5 py-0.5 font-mono text-[10px] text-[#ffb59a]">
                          {shortcut.keys}
                        </kbd>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-gray-500">
                    On macOS, use Cmd instead of Ctrl.
                  </p>
                </section>
              )}

              {activeTab === 'data' && (
                <>
                  <section>
                    <label className={SECTION_LABEL}>Quick Start</label>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Generate a <strong className="text-gray-300">Sandbox</strong> workspace pre-loaded with
                      example services, requests, variables, and mock servers.
                      It covers RESTful CRUD, auth flows, environment-scoped variables,
                      test scripts, and more - everything you need to explore RequestLoom.
                    </p>

                    <div className="mt-3 rounded border border-gray-800 bg-gray-900/50 px-3 py-2.5">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">What&apos;s included</span>
                      <ul className="mt-1.5 space-y-1 text-[11px] text-gray-400">
                        <li className="flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0 text-[#ff6c37]">&#9679;</span>
                          <span><strong className="text-gray-300">Users API</strong> - full CRUD with path params, env-scoped vars, pre/post scripts &amp; tests</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0 text-[#ff6c37]">&#9679;</span>
                          <span><strong className="text-gray-300">Posts API</strong> - bearer token auth, pagination, PATCH for partial updates</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0 text-[#ff6c37]">&#9679;</span>
                          <span><strong className="text-gray-300">Auth API</strong> - login/register with token extraction, mock server scripting</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0 text-[#ff6c37]">&#9679;</span>
                          <span><strong className="text-gray-300">3 Mock Servers</strong> - locally hosted on ports 5100-5102 with realistic endpoints</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0 text-[#ff6c37]">&#9679;</span>
                          <span><strong className="text-gray-300">DEV / STG / PRD</strong> - environment-scoped workspace &amp; service variables</span>
                        </li>
                      </ul>
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        setDataBusy(true);
                        setDataMessage(null);
                        try {
                          const result = await generateExamples();
                          // Switch to the new Sandbox workspace so environments/services load
                          const wsStore = useWorkspaceStore.getState();
                          await wsStore.load();
                          wsStore.setActive(result.workspaceId);
                          setDataMessage({ type: 'success', text: `Switched to "${result.name}". ${result.message}` });
                          setExamplesGenerated(true);
                        } catch (err) {
                          setDataMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to generate examples' });
                        } finally {
                          setDataBusy(false);
                        }
                      }}
                      disabled={dataBusy || examplesGenerated}
                      className={`mt-3 w-full ${examplesGenerated ? 'border border-emerald-800 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-400' : BTN_PRIMARY}`}
                    >
                      {dataBusy ? 'Generating...' : examplesGenerated ? '✓ Examples Created' : 'Generate Examples'}
                    </button>
                  </section>

                  <section>
                    <label className={SECTION_LABEL}>Danger Zone</label>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Remove <strong className="text-gray-300">all workspaces, services, requests, variables,
                      mock servers, environments, and history</strong>. This action cannot be undone.
                    </p>

                    {!confirmClear ? (
                      <button
                        type="button"
                        onClick={() => setConfirmClear(true)}
                        disabled={dataBusy}
                        className={`mt-3 w-full ${BTN_DANGER}`}
                      >
                        Clear All Data
                      </button>
                    ) : (
                      <div className="mt-3 rounded border border-rose-900/60 bg-rose-950/20 px-3 py-2.5">
                        <p className="text-xs font-semibold text-rose-300">
                          Are you sure? This will delete everything permanently.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              setDataBusy(true);
                              setDataMessage(null);
                              try {
                                const deleted = await clearAllData();
                                await useWorkspaceStore.getState().load();
                                setDataMessage({ type: 'success', text: `${deleted} records deleted. Refresh the page to see changes.` });
                                setConfirmClear(false);
                                setExamplesGenerated(false);
                              } catch (err) {
                                setDataMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to clear data' });
                              } finally {
                                setDataBusy(false);
                              }
                            }}
                            disabled={dataBusy}
                            className={BTN_DANGER}
                          >
                            {dataBusy ? 'Clearing...' : 'Yes, Delete Everything'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmClear(false)}
                            disabled={dataBusy}
                            className={BTN_SECONDARY}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </section>

                  {dataMessage && (
                    <p className={`rounded border px-3 py-2 text-xs ${
                      dataMessage.type === 'success'
                        ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300'
                        : 'border-rose-900/60 bg-rose-950/20 text-rose-300'
                    }`}>
                      {dataMessage.text}
                    </p>
                  )}
                </>
              )}

              {saved && (
                <div className="flex items-center gap-3 rounded border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
                  <span className="min-w-0 flex-1">
                    Settings saved.
                    {saved.restartRequired ? ' Reload the app to apply the storage change.' : ''}
                  </span>
                  {saved.restartRequired ? (
                    <button type="button" onClick={() => void handleReloadApp()} className={BTN_PRIMARY} disabled={busy}>
                      Reload now
                    </button>
                  ) : null}
                </div>
              )}

              {error && (
                <div className="rounded border border-rose-900/60 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-800 bg-[#1a1a1a] px-4 py-3">
          <button onClick={onClose} className={BTN_SECONDARY} disabled={busy}>
            {saved ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={() => {
              void handleSave();
            }}
            className={BTN_PRIMARY}
            disabled={busy || loading || !settings}
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {pendingStorageMigration && (
        <ConfirmModal
          title="Migrate storage?"
          message="All workspaces, collections, requests, folders, variables, environments, history, and mock servers will be copied to the selected storage. The existing target will be backed up before it is replaced, and the app will need to reload."
          confirmLabel="Migrate & Save"
          busy={busy}
          onConfirm={() => { void handleMigrateStorage(); }}
          onClose={() => { if (!busy) setPendingStorageMigration(null); }}
        />
      )}
    </div>
  );
}
