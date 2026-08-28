import { useMemo } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useScriptFileStore } from '../../stores/scriptFileStore';
import { CodeEditor } from '../common/CodeEditor';

const PRIMARY_BUTTON = 'border border-cyan-400 bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-gray-950 transition-colors hover:bg-cyan-400 disabled:cursor-default disabled:opacity-50';
const SECONDARY_BUTTON = 'border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100 disabled:cursor-default disabled:opacity-50';

export function JavaScriptFileEditor() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const activeFileKey = useScriptFileStore((state) => state.activeFileKey);
  const tab = useScriptFileStore((state) => state.tabs.find((item) => item.key === state.activeFileKey));
  const updateCode = useScriptFileStore((state) => state.updateCode);
  const save = useScriptFileStore((state) => state.save);
  const run = useScriptFileStore((state) => state.run);

  const dirty = useMemo(() => Boolean(tab && tab.code !== tab.savedCode), [tab]);

  if (!tab || !activeFileKey) {
    return <div className="flex h-full items-center justify-center text-xs text-gray-600">Select a JavaScript file.</div>;
  }

  const handleSave = async () => {
    try {
      await save(activeWorkspaceId, tab.key);
    } catch {
      // The store keeps the actionable error on the open tab.
    }
  };

  const handleRun = async () => {
    try {
      await run(activeWorkspaceId, tab.key);
    } catch {
      // The store keeps the actionable error on the open tab.
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#141414] text-gray-200">
      <div className="flex flex-shrink-0 items-center border-b border-gray-800 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 flex-shrink-0 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path d="M7 3h7l4 4v14H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5" />
              <path d="M10 13l-2 2 2 2M14 13l2 2-2 2" />
            </svg>
            <h2 className="truncate text-sm font-semibold text-gray-100">{tab.name}</h2>
          </div>
          <p className="truncate pl-6 text-[11px] text-gray-500" title={tab.path}>{tab.path}</p>
        </div>
        <div className="flex-1" />
        <span className={`mr-3 text-[11px] ${dirty ? 'text-amber-400' : 'text-gray-600'}`}>
          {dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        <button type="button" onClick={() => { void handleSave(); }} disabled={!dirty || tab.saving || tab.running} className={SECONDARY_BUTTON}>
          {tab.saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={() => { void handleRun(); }} disabled={tab.saving || tab.running} className={`ml-2 ${PRIMARY_BUTTON}`}>
          {tab.running ? 'Running...' : 'Run script'}
        </button>
      </div>

      <div className="min-h-0 flex-1 border-b border-gray-800 bg-[#0f0f0f]">
        <CodeEditor
          value={tab.code}
          language="javascript"
          onChange={(code) => updateCode(tab.key, code)}
        />
      </div>

      <div className="flex h-48 flex-shrink-0 flex-col bg-[#111111]">
        <div className="flex items-center border-b border-gray-800 px-4 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Output</span>
          {tab.runResponse && (
            <span className={`ml-2 text-[11px] ${tab.runResponse.success ? 'text-emerald-400' : 'text-rose-400'}`}>
              {tab.runResponse.success ? 'Completed' : 'Failed'}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-2 font-mono text-[11px]">
          {tab.error && <div className="mb-1 whitespace-pre-wrap text-rose-300">{tab.error}</div>}
          {tab.runResponse?.error && <div className="mb-1 whitespace-pre-wrap text-rose-300">{tab.runResponse.error}</div>}
          {tab.runResponse?.logs.map((line, index) => (
            <div key={`${index}-${line}`} className="whitespace-pre-wrap break-words text-gray-300">{line}</div>
          ))}
          {tab.runResponse?.result && (
            <div className="mt-1 whitespace-pre-wrap break-words text-cyan-300">Result: {tab.runResponse.result}</div>
          )}
          {!tab.error && !tab.runResponse && (
            <div className="text-gray-600">Run the script to see console output here.</div>
          )}
          {!tab.error && tab.runResponse && !tab.runResponse.error && tab.runResponse.logs.length === 0 && !tab.runResponse.result && (
            <div className="text-gray-600">No output.</div>
          )}
        </div>
      </div>
    </div>
  );
}
