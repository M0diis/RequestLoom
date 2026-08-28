import { useMemo } from 'react';
import { useRequestStore } from '../../stores/requestStore';
import { useScriptFileStore } from '../../stores/scriptFileStore';

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-300',
  PATCH: 'text-violet-300',
  DELETE: 'text-rose-400',
  OPTIONS: 'text-gray-400',
  HEAD: 'text-gray-400',
};

export function RequestTabBar() {
  const { services, openRequestIds, activeRequestId, selectRequest, closeRequest } = useRequestStore();
  const { tabs: scriptTabs, openFileKeys, activeFileKey, setActiveFile, closeFile } = useScriptFileStore();

  const openRequests = useMemo(() => {
    const result: { id: string; name: string; method: string }[] = [];
    for (const svc of services) {
      for (const req of svc.requests) {
        if (openRequestIds.includes(req.id)) {
          result.push({ id: req.id, name: req.name, method: req.method });
        }
      }
    }
    // Preserve tab order
    result.sort((a, b) => openRequestIds.indexOf(a.id) - openRequestIds.indexOf(b.id));
    return result;
  }, [services, openRequestIds]);

  const openScripts = useMemo(
    () => openFileKeys
      .map((key) => scriptTabs.find((tab) => tab.key === key))
      .filter((tab): tab is (typeof scriptTabs)[number] => Boolean(tab)),
    [openFileKeys, scriptTabs],
  );

  // Always render the tab bar when at least one request is open so the layout
  // doesn't shift when a second tab is opened or the last tab is closed.
  if (openRequests.length === 0 && openScripts.length === 0) return null;

  return (
    <div className="flex items-center border-b border-gray-800 bg-[#111111] overflow-x-auto flex-shrink-0 overflow-y-hidden scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900">
      {openRequests.map((req) => (
        <div
          key={req.id}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              closeRequest(req.id);
            }
          }}
          className={`group flex items-center gap-1 border-r border-gray-800/50 text-xs whitespace-nowrap ${
            activeRequestId === req.id
              ? 'bg-[#1a1a1a] text-gray-100 border-b-2 border-b-[#ff6c37] -mb-px'
              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900/50'
          }`}
        >
          <button
            onClick={() => { setActiveFile(null); void selectRequest(req.id); }}
            className="flex items-center gap-1.5 px-3 py-2"
          >
            <span className={`font-mono text-[10px] font-bold ${METHOD_COLORS[req.method]}`}>
              {req.method}
            </span>
            <span className="max-w-[180px] truncate">{req.name}</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); closeRequest(req.id); }}
            className="mr-1.5 rounded-sm p-0.5 text-gray-600 hover:bg-gray-700 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Close tab"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
      {openScripts.map((script) => (
        <div
          key={script.key}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              closeFile(script.key);
            }
          }}
          className={`group flex items-center gap-1 border-r border-gray-800/50 text-xs whitespace-nowrap ${
            activeFileKey === script.key
              ? 'bg-[#1a1a1a] text-gray-100 border-b-2 border-b-[#ff6c37] -mb-px'
              : 'text-gray-500 hover:bg-gray-900/50 hover:text-gray-300'
          }`}
        >
          <button
            type="button"
            onClick={() => setActiveFile(script.key)}
            className="flex items-center gap-1.5 px-3 py-2"
            title={script.path}
          >
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path d="M7 3h7l4 4v14H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5" />
              <path d="M10 13l-2 2 2 2M14 13l2 2-2 2" />
            </svg>
            <span className="max-w-[180px] truncate">{script.name}</span>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); closeFile(script.key); }}
            className="mr-1.5 rounded-sm p-0.5 text-gray-600 opacity-0 transition-opacity hover:bg-gray-700 hover:text-gray-300 group-hover:opacity-100"
            title="Close tab"
            aria-label={`Close ${script.name}`}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
