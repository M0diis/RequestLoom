import { TerminalPanel } from './TerminalPanel';
import { NetworkPanel } from './NetworkPanel';
import { PerformancePanel } from './PerformancePanel';
import { useUiStore, type DevToolTab } from '../../stores/uiStore';

const TABS: { id: DevToolTab; label: string }[] = [
  { id: 'console', label: 'Console' },
  { id: 'network', label: 'Network' },
  { id: 'performance', label: 'Performance' },
  { id: 'terminal', label: 'Terminal' },
];

function ConsolePanel() {
  const messages = {
    console: 'Console output will appear here.',
  };

  return (
    <div className="flex h-full items-center justify-center bg-[#0b0b0b] font-mono text-xs text-gray-600">
      {messages.console}
    </div>
  );
}

export function DevToolsPanel() {
  const { devToolsOpen, activeDevToolTab, setActiveDevToolTab, setDevToolsOpen } = useUiStore();

  if (!devToolsOpen) return null;

  return (
    <section className="flex h-64 min-h-0 flex-shrink-0 flex-col border-t border-gray-800 bg-[#0b0b0b] text-gray-300">
      <div className="flex h-9 flex-shrink-0 items-stretch border-b border-gray-800 bg-[#171717]">
        <div className="flex items-stretch">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveDevToolTab(tab.id)}
              className={`border-b-2 px-3 text-xs transition-colors ${
                activeDevToolTab === tab.id
                  ? 'border-[#ff6c37] text-[#ffb59a]'
                  : 'border-transparent text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span className="mr-1.5 text-[10px]">{tab.id === 'terminal' ? '›_' : tab.id === 'network' ? '◎' : tab.id === 'performance' ? '◌' : '›'}</span>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setDevToolsOpen(false)}
          className="px-3 text-lg leading-none text-gray-500 hover:bg-gray-800 hover:text-gray-200"
          title="Close Dev Tools"
          aria-label="Close Dev Tools"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <div className={activeDevToolTab === 'terminal' ? 'h-full' : 'hidden'}>
          <TerminalPanel />
        </div>
        {activeDevToolTab === 'console' ? <ConsolePanel /> : null}
        {activeDevToolTab === 'network' ? <NetworkPanel /> : null}
        {activeDevToolTab === 'performance' ? <PerformancePanel /> : null}
      </div>
    </section>
  );
}
