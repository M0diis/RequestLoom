import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRequestStore } from '../../stores/requestStore';
import { useScriptFileStore } from '../../stores/scriptFileStore';
import { withShortcut } from '../../lib/shortcuts';

const TAB_MENU_ITEM = 'block w-full px-2 py-1.5 text-left text-[11px] text-gray-300 hover:bg-gray-800 hover:text-gray-100 disabled:cursor-default disabled:text-gray-600 disabled:hover:bg-transparent';

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
  const {
    services, topLevelRequests, openRequestIds, activeRequestId, selectRequest, closeRequest, dirtyRequests,
    closeOtherRequests, closeRequestsToRight, moveOpenRequest,
  } = useRequestStore();
  const { tabs: scriptTabs, openFileKeys, activeFileKey, setActiveFile, closeFile } = useScriptFileStore();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;
    const rect = element.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - rect.width - 8);
    const y = Math.min(menu.y, window.innerHeight - rect.height - 8);
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu]);

  const openRequests = useMemo(() => {
    const result: { id: string; name: string; method: string }[] = [];
    for (const req of topLevelRequests) {
      if (openRequestIds.includes(req.id)) {
        result.push({ id: req.id, name: req.name, method: req.method });
      }
    }
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
  }, [services, topLevelRequests, openRequestIds]);

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
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-requestloom-tab', req.id);
            e.dataTransfer.effectAllowed = 'move';
            setDraggingId(req.id);
          }}
          onDragOver={(e) => {
            if (!draggingId || draggingId === req.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropTargetId(req.id);
          }}
          onDragLeave={() => setDropTargetId((current) => current === req.id ? null : current)}
          onDrop={(e) => {
            e.preventDefault();
            const sourceId = e.dataTransfer.getData('application/x-requestloom-tab') || draggingId;
            if (!sourceId || sourceId === req.id) return;
            // Dropping on a tab to the right places the dragged tab after it.
            const sourceIndex = openRequestIds.indexOf(sourceId);
            const targetIndex = openRequestIds.indexOf(req.id);
            moveOpenRequest(sourceId, sourceIndex < targetIndex ? (openRequestIds[targetIndex + 1] ?? null) : req.id);
            setDropTargetId(null);
          }}
          onDragEnd={() => { setDraggingId(null); setDropTargetId(null); }}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              closeRequest(req.id);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ id: req.id, x: e.clientX, y: e.clientY });
          }}
          className={`group flex items-center gap-1 border-r border-gray-800/50 text-xs whitespace-nowrap ${
            activeRequestId === req.id
              ? 'bg-[#1a1a1a] text-gray-100 border-b-2 border-b-[#ff6c37] -mb-px'
              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900/50'
          } ${dropTargetId === req.id ? 'bg-cyan-500/10 ring-1 ring-inset ring-cyan-400/60' : ''} ${draggingId === req.id ? 'opacity-50' : ''}`}
        >
          <button
            onClick={() => { setActiveFile(null); void selectRequest(req.id); }}
            className="flex items-center gap-1.5 px-3 py-2"
            title={`${req.name}${dirtyRequests.has(req.id) ? ' (unsaved changes)' : ''} — middle-click to close, drag to reorder`}
          >
            <span className={`font-mono text-[10px] font-bold ${METHOD_COLORS[req.method]}`}>
              {req.method}
            </span>
            <span className="max-w-[180px] truncate">{req.name}</span>
            {dirtyRequests.has(req.id) ? <span role="img" aria-label="Unsaved changes" title="Unsaved changes" className="h-1.5 w-1.5 rounded-full bg-amber-400" /> : null}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); closeRequest(req.id); }}
            className="mr-1.5 rounded-sm p-0.5 text-gray-600 hover:bg-gray-700 hover:text-gray-300 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            title={withShortcut('Close tab', 'closeTab')}
            aria-label={`Close ${req.name}`}
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
            className="mr-1.5 rounded-sm p-0.5 text-gray-600 opacity-0 transition-opacity hover:bg-gray-700 hover:text-gray-300 group-hover:opacity-100 focus-visible:opacity-100"
            title={withShortcut('Close tab', 'closeTab')}
            aria-label={`Close ${script.name}`}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
      {menu && (() => {
        const index = openRequestIds.indexOf(menu.id);
        const run = (action: () => void) => { setMenu(null); action(); };
        return (
          <div
            ref={menuRef}
            role="menu"
            aria-label="Tab actions"
            className="fixed z-50 min-w-[180px] border border-gray-700 bg-[#1b1b1b] p-1 shadow-[0_12px_30px_rgba(0,0,0,0.5)]"
            style={{ left: menu.x, top: menu.y }}
          >
            <button type="button" role="menuitem" className={TAB_MENU_ITEM} onClick={() => run(() => closeRequest(menu.id))}>
              Close
            </button>
            <button
              type="button"
              role="menuitem"
              className={TAB_MENU_ITEM}
              disabled={openRequestIds.length < 2}
              onClick={() => run(() => closeOtherRequests(menu.id))}
            >
              Close others
            </button>
            <button
              type="button"
              role="menuitem"
              className={TAB_MENU_ITEM}
              disabled={index < 0 || index === openRequestIds.length - 1}
              onClick={() => run(() => closeRequestsToRight(menu.id))}
            >
              Close to the right
            </button>
            <button
              type="button"
              role="menuitem"
              className={TAB_MENU_ITEM}
              onClick={() => run(() => [...openRequestIds].forEach((id) => closeRequest(id)))}
            >
              Close all
            </button>
          </div>
        );
      })()}
    </div>
  );
}
