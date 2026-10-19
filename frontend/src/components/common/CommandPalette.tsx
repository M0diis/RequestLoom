import { useEffect, useMemo, useRef, useState } from 'react';
import { useRequestStore } from '../../stores/requestStore';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useUiStore } from '../../stores/uiStore';
import { toast } from '../../stores/toastStore';
import { SHORTCUTS, type ShortcutId } from '../../lib/shortcuts';
import {
  closeActiveTab,
  focusUrlBar,
  openRequestInWorkspace,
  saveActiveTab,
  sendActiveTab,
} from '../../lib/appActions';

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-300',
  PATCH: 'text-violet-300',
  DELETE: 'text-rose-400',
  OPTIONS: 'text-gray-400',
  HEAD: 'text-gray-400',
};

type PaletteGroup = 'Requests' | 'Environments' | 'Actions';

interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  detail?: string;
  method?: string;
  shortcut?: ShortcutId;
  run: () => void;
}

const MAX_RESULTS = 60;

/** Subsequence match: every query character must appear in order. Higher is better; null means no match. */
function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const haystack = text.toLowerCase();
  const direct = haystack.indexOf(query);
  if (direct >= 0) return 1000 - direct;

  let score = 0;
  let position = 0;
  let previous = -2;
  for (const char of query) {
    const found = haystack.indexOf(char, position);
    if (found < 0) return null;
    score += found === previous + 1 ? 5 : 1;
    if (found === 0 || /[\s/._-]/.test(haystack[found - 1])) score += 3;
    previous = found;
    position = found + 1;
  }
  return score;
}

export function CommandPalette() {
  const { services, topLevelRequests } = useRequestStore();
  const { environments, activate } = useEnvironmentStore();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const ui = useUiStore();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => ui.setCommandPaletteOpen(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<PaletteItem[]>(() => {
    const requests: PaletteItem[] = [
      ...topLevelRequests.map((request) => ({ request, collection: '' })),
      ...services.flatMap((service) => service.requests.map((request) => ({ request, collection: service.name }))),
    ].map(({ request, collection }) => ({
      id: `request:${request.id}`,
      group: 'Requests',
      label: request.name,
      detail: [collection, request.url].filter(Boolean).join(' · '),
      method: request.method,
      run: () => openRequestInWorkspace(request.id),
    }));

    const envs: PaletteItem[] = environments.map((environment) => ({
      id: `env:${environment.id}`,
      group: 'Environments',
      label: `Use environment: ${environment.name}`,
      detail: environment.isActive ? 'Active' : undefined,
      run: () => {
        void activate(activeWorkspaceId, environment.id)
          .then(() => toast(`Environment "${environment.name}" activated`))
          .catch((error: unknown) => toast(error instanceof Error ? error.message : 'Could not activate environment', { variant: 'error' }));
      },
    }));

    const action = (id: string, label: string, run: () => void, shortcut?: ShortcutId): PaletteItem =>
      ({ id: `action:${id}`, group: 'Actions', label, run, shortcut });
    const actions: PaletteItem[] = [
      action('new-request', 'New request', () => ui.setNewRequestModalOpen(true), 'newRequest'),
      action('send', 'Send request', sendActiveTab, 'send'),
      action('save', 'Save request', () => { void saveActiveTab(); }, 'save'),
      action('close-tab', 'Close tab', closeActiveTab, 'closeTab'),
      action('focus-url', 'Focus URL bar', focusUrlBar, 'focusUrl'),
      action('import-postman', 'Import from Postman', () => ui.setImportDialogKind('postman')),
      action('import-soapui', 'Import from SoapUI', () => ui.setImportDialogKind('soapui')),
      action('import-curl', 'Import from cURL', () => ui.setImportDialogKind('curl')),
      action('import-openapi', 'Import OpenAPI specification', () => ui.setImportDialogKind('openapi')),
      action('import-export', 'Import / export workspace', () => ui.setExportImportModalOpen(true)),
      action('panel-services', 'Go to Services', () => ui.setSidebarTab('services'), 'servicesPanel'),
      action('panel-variables', 'Go to Variables', () => ui.setSidebarTab('variables'), 'variablesPanel'),
      action('panel-mocks', 'Go to Mock Servers', () => ui.setSidebarTab('mockservers'), 'mocksPanel'),
      action('panel-docs', 'Go to Docs', () => ui.setSidebarTab('docs'), 'docsPanel'),
      action('layout', 'Toggle response layout', () => ui.setResponseLayout(ui.responseLayout === 'right' ? 'bottom' : 'right'), 'toggleLayout'),
      action('devtools', ui.devToolsOpen ? 'Hide dev tools' : 'Show dev tools', () => ui.setDevToolsOpen(!ui.devToolsOpen)),
      action('theme', 'Toggle dark mode', ui.toggleDarkMode),
      action('settings', 'Open settings', () => ui.setSettingsModalOpen(true)),
    ];

    return [...actions, ...requests, ...envs];
  }, [services, topLevelRequests, environments, activate, activeWorkspaceId, ui]);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      // Without a query, show actions first and a handful of requests.
      return [...items.filter((item) => item.group === 'Actions'), ...items.filter((item) => item.group === 'Requests').slice(0, 10)];
    }
    return items
      .map((item) => {
        const labelScore = fuzzyScore(normalized, item.label);
        const detailScore = fuzzyScore(normalized, `${item.method ?? ''} ${item.detail ?? ''}`);
        const score = Math.max(labelScore === null ? -1 : labelScore + 50, detailScore ?? -1);
        return { item, score };
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runItem(results[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  let lastGroup: PaletteGroup | null = null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="flex max-h-[70vh] w-full max-w-xl flex-col border border-gray-700 bg-[#161616] shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search requests, environments and actions…"
          aria-label="Search commands"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-results"
          aria-activedescendant={results[activeIndex] ? `palette-${results[activeIndex].id}` : undefined}
          className="border-b border-gray-800 bg-transparent px-4 py-3 text-sm text-gray-100 outline-none placeholder:text-gray-600"
        />
        <div ref={listRef} id="command-palette-results" role="listbox" className="flex-1 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-gray-500">No matches for “{query.trim()}”.</div>
          )}
          {results.map((item, index) => {
            // Group headers only make sense in the unsorted (no query) view.
            const header = !query.trim() && item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && (
                  <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{header}</div>
                )}
                <button
                  type="button"
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-index={index}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => runItem(item)}
                  className={`flex w-full items-center gap-3 px-4 py-1.5 text-left text-xs ${
                    index === activeIndex ? 'bg-[#ff6c37]/15 text-gray-100' : 'text-gray-300'
                  }`}
                >
                  {item.method && (
                    <span className={`w-12 flex-shrink-0 font-mono text-[10px] font-bold ${METHOD_COLORS[item.method] ?? 'text-gray-400'}`}>
                      {item.method}
                    </span>
                  )}
                  <span className="min-w-0 flex-shrink truncate">{item.label}</span>
                  {item.detail && <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500">{item.detail}</span>}
                  {item.shortcut && (
                    <kbd className="ml-auto flex-shrink-0 border border-gray-700 bg-gray-900 px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
                      {SHORTCUTS[item.shortcut].keys}
                    </kbd>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 border-t border-gray-800 px-4 py-1.5 text-[10px] text-gray-500">
          <span>↑↓ to navigate</span>
          <span>Enter to run</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
