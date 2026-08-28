import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useRequestStore } from '../../stores/requestStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useUiStore } from '../../stores/uiStore';
import { VariablesSidebarPanel } from '../variables/VariablesSidebarPanel';
import { MockServersSidebarPanel } from '../mockserver/MockServersSidebarPanel';
import { ImportModal } from '../common/ImportModal';
import { CollectionRunnerModal } from '../common/CollectionRunnerModal';
import { CodeSnippetsModal } from '../common/CodeSnippetsModal';
import { AlertModal } from '../common/AlertModal';
import { ConfirmModal } from '../common/ConfirmModal';
import { TextInputModal } from '../common/TextInputModal';
import { useSettingsStore } from '../../stores/settingsStore';
import { useScriptFileStore, type ScriptFileEntry } from '../../stores/scriptFileStore';
import { exportImportApi, requestsApi, serviceFilesApi } from '../../services/api';
import type { ApiRequest } from '../../types';

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-300',
  PATCH: 'text-violet-300',
  DELETE: 'text-rose-400',
  OPTIONS: 'text-gray-400',
  HEAD: 'text-gray-400',
};

const MENU_ITEM = 'group flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] leading-4 text-gray-300 transition-colors hover:bg-gray-800/80 hover:text-gray-100 focus-visible:bg-gray-800/80 focus-visible:outline-none whitespace-nowrap';
const MENU_DANGER = 'group flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] leading-4 text-rose-300 transition-colors hover:bg-rose-950/40 hover:text-rose-200 focus-visible:bg-rose-950/40 focus-visible:outline-none whitespace-nowrap';
const MENU_ICON = 'h-3.5 w-3.5 flex-shrink-0 text-gray-500 transition-colors group-hover:text-gray-300';

type MenuIconName =
  | 'play'
  | 'clone'
  | 'copy'
  | 'rename'
  | 'code'
  | 'folder'
  | 'info'
  | 'star'
  | 'trash'
  | 'plus'
  | 'folder-plus'
  | 'file-code'
  | 'share'
  | 'file-text'
  | 'collapse'
  | 'chevron-up'
  | 'chevron-down'
  | 'settings'
  | 'terminal';

function MenuIcon({ name, danger = false }: { name: MenuIconName; danger?: boolean }) {
  const svgProps = {
    className: danger ? 'h-3.5 w-3.5 flex-shrink-0 text-rose-400 transition-colors group-hover:text-rose-200' : MENU_ICON,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'play':
      return <svg {...svgProps} fill="currentColor" stroke="none"><path d="M8 5v14l11-7-11-7z" /></svg>;
    case 'clone':
      return <svg {...svgProps}><rect x="8" y="8" width="11" height="11" rx="1.5" /><path d="M5 16H4a1 1 0 01-1-1V5a1 1 0 011-1h10a1 1 0 011 1v1" /></svg>;
    case 'copy':
      return <svg {...svgProps}><rect x="7" y="5" width="11" height="14" rx="1.5" /><path d="M10 3h7a2 2 0 012 2v11M10 9h5M10 13h5" /></svg>;
    case 'rename':
      return <svg {...svgProps}><path d="M4 20l4.2-1 9.9-9.9a2.1 2.1 0 00-3-3L5.2 16 4 20z" /><path d="M13.8 7.2l3 3" /></svg>;
    case 'code':
      return <svg {...svgProps}><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 4l-4 16" /></svg>;
    case 'folder':
      return <svg {...svgProps}><path d="M3 6.5A1.5 1.5 0 014.5 5H10l2 2h7.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5v-11z" /></svg>;
    case 'info':
      return <svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M12 10.5v5M12 7.5h.01" /></svg>;
    case 'star':
      return <svg {...svgProps}><path d="M12 3.8l2.5 5.1 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.8z" /></svg>;
    case 'trash':
      return <svg {...svgProps}><path d="M4 7h16M10 11v5M14 11v5M6.5 7l.7 13h9.6l.7-13M9 7V4h6v3" /></svg>;
    case 'plus':
      return <svg {...svgProps}><path d="M12 5v14M5 12h14" /></svg>;
    case 'folder-plus':
      return <svg {...svgProps}><path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /><path d="M12 10v5M9.5 12.5h5" /></svg>;
    case 'file-code':
      return <svg {...svgProps}><path d="M7 3h7l4 4v14H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5" /><path d="M10 13l-2 2 2 2M14 13l2 2-2 2" /></svg>;
    case 'share':
      return <svg {...svgProps}><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M7.8 11l8.4-4M7.8 13l8.4 4" /></svg>;
    case 'file-text':
      return <svg {...svgProps}><path d="M7 3h7l4 4v14H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5M9 13h6M9 17h6" /></svg>;
    case 'collapse':
      return <svg {...svgProps}><path d="M8 8l4 4 4-4M8 16l4-4 4 4" /></svg>;
    case 'chevron-up':
      return <svg {...svgProps}><path d="M6 15l6-6 6 6" /></svg>;
    case 'chevron-down':
      return <svg {...svgProps}><path d="M6 9l6 6 6-6" /></svg>;
    case 'settings':
      return <svg {...svgProps}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6v.1h-2.4v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1L8 17l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H6v-2.4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9L7.3 8 9 6.3l.1.1a1.7 1.7 0 001.9.3 1.7 1.7 0 001-1.6V5h2.4v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1L19 8l-.1.1a1.7 1.7 0 00-.3 1.9 1.7 1.7 0 001.6 1h.1v2.4h-.1a1.7 1.7 0 00-1.6 1z" /></svg>;
    case 'terminal':
      return <svg {...svgProps}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></svg>;
  }
}

interface ContextMenuItemProps {
  icon: MenuIconName;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

function ContextMenuItem({ icon, children, onClick, danger = false }: ContextMenuItemProps) {
  return (
    <button type="button" role="menuitem" className={danger ? MENU_DANGER : MENU_ITEM} onClick={onClick}>
      <MenuIcon name={icon} danger={danger} />
      <span className="truncate">{children}</span>
    </button>
  );
}

export function Sidebar() {
  const {
    services,
    activeRequestId,
    selectRequest,
    createService,
    duplicateService,
    createRequest,
    updateRequest,
    deleteService,
    deleteRequest,
    duplicateRequest,
    toggleFavorite,
    isRequestDirty,
    moveService,
  } = useRequestStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const {
    sidebarTab,
    setSidebarTab,
    serviceSettingsServiceId,
    setServiceSettingsServiceId,
    setTerminalCwd,
  } = useUiStore();
  const {
    files: scriptFiles,
    addFile: addScriptFile,
    openFile: openScriptFile,
    setActiveFile: setActiveScriptFile,
    run: runScriptFile,
    removeFile: removeScriptFile,
  } = useScriptFileStore();
  const { settings } = useSettingsStore();
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePath, setNewServicePath] = useState('');
  const [addingService, setAddingService] = useState(false);
  const [addingRequestToService, setAddingRequestToService] = useState<string | null>(null);
  const [newRequestName, setNewRequestName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ type: 'service' | 'request' | 'script'; id: string; x: number; y: number } | null>(null);
  const [collapsedServices, setCollapsedServices] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [showCollectionRunner, setShowCollectionRunner] = useState<string | null>(null);
  const [renamingRequestId, setRenamingRequestId] = useState<string | null>(null);
  const [renamingRequestName, setRenamingRequestName] = useState('');
  const [renamingServiceId, setRenamingServiceId] = useState<string | null>(null);
  const [renamingServiceName, setRenamingServiceName] = useState('');
  const [showCodeForRequest, setShowCodeForRequest] = useState<ApiRequest | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [collectionAssetDialog, setCollectionAssetDialog] = useState<{
    serviceId: string;
    kind: 'folder' | 'js';
  } | null>(null);
  const [scriptToDelete, setScriptToDelete] = useState<ScriptFileEntry | null>(null);
  const [deletingScript, setDeletingScript] = useState(false);
  const addRequestSubmitting = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const apply = () => setCompact(el.clientWidth < 240);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const favorites = services.flatMap((s) => s.requests.filter((r) => r.isFavorite));

  const toggleCollapse = (serviceId: string) => {
    setCollapsedServices((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  };

  const handleAddService = async () => {
    if (!newServiceName.trim()) return;
    await createService(
      activeWorkspaceId,
      newServiceName.trim(),
      settings?.storageMode === 'json' && settings.jsonStorageStrategy === 'perCollection'
        ? newServicePath.trim() || undefined
        : undefined,
    );
    setNewServiceName('');
    setNewServicePath('');
    setAddingService(false);
  };

  const chooseCollectionFolder = async () => {
    if (window.desktopShell) {
      const selected = await window.desktopShell.selectDirectory();
      if (selected) setNewServicePath(selected);
      return;
    }

    const selected = window.prompt('Collection folder path');
    if (selected) setNewServicePath(selected);
  };

  const handleAddRequest = async (serviceId: string) => {
    if (!newRequestName.trim() || addRequestSubmitting.current) return;
    addRequestSubmitting.current = true;
    try {
      const req = await createRequest(serviceId, newRequestName.trim(), 'GET');
      setNewRequestName('');
      setAddingRequestToService(null);
      setActiveScriptFile(null);
      await selectRequest(req.id);
    } finally {
      addRequestSubmitting.current = false;
    }
  };

  const startRenameRequest = (requestId: string) => {
    const request = services
      .flatMap((service) => service.requests)
      .find((row) => row.id === requestId);

    if (!request) return;

    setRenamingRequestId(requestId);
    setRenamingRequestName(request.name);
  };

  const cancelRenameRequest = () => {
    setRenamingRequestId(null);
    setRenamingRequestName('');
  };

  const commitRenameRequest = async (requestId: string, candidateName: string) => {
    const nextName = candidateName.trim();
    const request = services
      .flatMap((service) => service.requests)
      .find((row) => row.id === requestId);

    if (!request) {
      cancelRenameRequest();
      return;
    }

    if (!nextName) {
      cancelRenameRequest();
      return;
    }

    if (nextName !== request.name) {
      await updateRequest(requestId, { name: nextName });
    }

    cancelRenameRequest();
  };

  const startRenameService = (serviceId: string) => {
    const service = services.find((row) => row.id === serviceId);
    if (!service) return;
    setRenamingServiceId(serviceId);
    setRenamingServiceName(service.name);
    setContextMenu(null);
  };

  const commitRenameService = async (serviceId: string, candidateName: string) => {
    const service = services.find((row) => row.id === serviceId);
    const nextName = candidateName.trim();
    if (service && nextName && nextName !== service.name) {
      await useRequestStore.getState().updateService(
        activeWorkspaceId,
        serviceId,
        nextName,
        service.description,
      );
    }
    setRenamingServiceId(null);
    setRenamingServiceName('');
  };

  const handleContextMenu = (e: React.MouseEvent, type: 'service' | 'request' | 'script', id: string) => {
    e.preventDefault();
    setContextMenu({ type, id, x: e.clientX, y: e.clientY });
  };

  const openServiceSettings = (serviceId: string) => {
    setServiceSettingsServiceId(serviceId);
    setContextMenu(null);
  };

  const handleRunRequest = async (requestId: string) => {
    setContextMenu(null);
    setActiveScriptFile(null);
    const store = useRequestStore.getState();
    if (store.activeRequestId === requestId && store.isRequestDirty(requestId)) {
      await store.sendRequest(activeWorkspaceId);
      return;
    }
    await store.selectRequest(requestId);
    await store.sendRequest(activeWorkspaceId);
  };

  const revealPath = async (targetPath: string) => {
    if (!targetPath) {
      setAlertMessage('This item is not backed by a local file in the current storage mode.');
      return;
    }
    if (window.desktopShell) {
      const revealed = await window.desktopShell.revealPath(targetPath);
      if (!revealed) setAlertMessage(`Could not find ${targetPath}`);
      return;
    }
    await navigator.clipboard.writeText(targetPath).catch(() => {});
    setAlertMessage(`Path copied to clipboard:\n${targetPath}`);
  };

  const handleCopyRequest = async (requestId: string) => {
    setContextMenu(null);
    const stored = await requestsApi.getFile(requestId);
    await navigator.clipboard.writeText(stored.content).catch(() => {});
  };

  const handleCloneRequest = async (requestId: string) => {
    setContextMenu(null);
    setActiveScriptFile(null);
    try {
      const clonedRequest = await duplicateRequest(requestId);
      await selectRequest(clonedRequest.id);
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : 'Failed to clone request');
    }
  };

  const handleCreateCollectionAsset = (serviceId: string, kind: 'folder' | 'js') => {
    setContextMenu(null);
    setCollectionAssetDialog({ serviceId, kind });
  };

  const handleOpenScriptFile = (serviceId: string, file: typeof scriptFiles[number]) => {
    setContextMenu(null);
    setServiceSettingsServiceId(null);
    setSidebarTab('services');
    openScriptFile(serviceId, file);
  };

  const handleRunScriptFile = (file: ScriptFileEntry) => {
    setContextMenu(null);
    setServiceSettingsServiceId(null);
    setSidebarTab('services');
    openScriptFile(file.serviceId, file);
    void runScriptFile(activeWorkspaceId, file.key).catch(() => {});
  };

  const handleCopyScriptPath = async (file: ScriptFileEntry) => {
    setContextMenu(null);
    await navigator.clipboard.writeText(file.path).catch(() => {});
    setAlertMessage(`Path copied to clipboard:\n${file.path}`);
  };

  const handleDeleteScript = async () => {
    if (!scriptToDelete) return;

    setDeletingScript(true);
    try {
      await serviceFilesApi.delete(activeWorkspaceId, scriptToDelete.serviceId, scriptToDelete.name);
      removeScriptFile(scriptToDelete.key);
      setScriptToDelete(null);
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : 'Failed to delete JavaScript file');
    } finally {
      setDeletingScript(false);
    }
  };

  const handleCollectionAssetSubmit = async (name: string) => {
    if (!collectionAssetDialog) return;

    const { serviceId, kind } = collectionAssetDialog;
    try {
      const result = await serviceFilesApi.create(activeWorkspaceId, serviceId, name, kind);
      setCollectionAssetDialog(null);
      if (kind === 'js') {
        addScriptFile(serviceId, result);
      } else {
        await revealPath(result.path);
      }
    } catch (error) {
      setCollectionAssetDialog(null);
      setAlertMessage(error instanceof Error ? error.message : 'Failed to create collection file');
    }
  };

  const handleShareCollection = async (serviceId: string) => {
    setContextMenu(null);
    const data = await exportImportApi.exportService(serviceId);
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2)).catch(() => {});
  };

  const handleGenerateDocs = (serviceId: string) => {
    setContextMenu(null);
    const service = services.find((row) => row.id === serviceId);
    if (!service) return;
    const markdown = [
      `# ${service.name}`,
      '',
      service.description || 'Request collection',
      '',
      ...service.requests.map((request) => `- **${request.method} ${request.name}** — ${request.url || '(no URL)'}`),
    ].join('\n');
    void navigator.clipboard.writeText(markdown).catch(() => {});
  };

  const handleOpenTerminal = (serviceId: string) => {
    const service = services.find((row) => row.id === serviceId);
    if (!service) return;
    setContextMenu(null);
    setTerminalCwd(service.storagePath || settings?.storagePath || '');
  };

  useEffect(() => {
    if (!contextMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  return (
    <div ref={sidebarRef} className="flex flex-col h-full bg-[#111111] text-gray-200" onClick={() => setContextMenu(null)}>
      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-[#1a1a1a]">
        <button
          onClick={() => { setServiceSettingsServiceId(null); setSidebarTab('services'); }}
          title="Services"
          className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-xs font-semibold tracking-wide ${sidebarTab === 'services' ? 'border-[#ff6c37] bg-gray-900 text-gray-100' : 'border-transparent text-gray-500 hover:text-gray-200'}`}
        >
          <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 3.29a2 2 0 00-3 0L2.414 11a2 2 0 000 2.828L10.5 21.914a2 2 0 003 0l8.086-8.086a2 2 0 000-2.828L13.5 3.29z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6" />
          </svg>
          {!compact && <span>Services</span>}
        </button>
        <button
          onClick={() => {
            setServiceSettingsServiceId(null);
            setSidebarTab('variables');
          }}
          title="Variables"
          className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-xs font-semibold tracking-wide ${sidebarTab === 'variables' ? 'border-[#ff6c37] bg-gray-900 text-gray-100' : 'border-transparent text-gray-500 hover:text-gray-200'}`}
        >
          <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 8l-4 4 4 4M17 8l4 4-4 4M14 4l-4 16" />
          </svg>
          {!compact && <span>Variables</span>}
        </button>
        <button
          onClick={() => {
            setServiceSettingsServiceId(null);
            setSidebarTab('mockservers');
          }}
          title="Mocks"
          className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-xs font-semibold tracking-wide ${sidebarTab === 'mockservers' ? 'border-[#ff6c37] bg-gray-900 text-gray-100' : 'border-transparent text-gray-500 hover:text-gray-200'}`}
        >
          <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="2" y="2" width="20" height="8" rx="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.01M6 18h.01" />
          </svg>
          {!compact && <span>Mocks</span>}
        </button>
      </div>

      {sidebarTab === 'services' && (
        <div className="flex-1 overflow-y-auto">

          <div className="border-b border-gray-800/80 px-3 py-2">
            <button
              onClick={() => setShowImport(true)}
              title="Import OpenAPI / WSDL / cURL"
              className="flex w-full items-center gap-1.5 border border-gray-700 bg-gray-900 px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
            >
              <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 4v12m0 0l-4-4m4 4l4-4" />
              </svg>
              {compact ? <span>Import OpenAPI ...</span> : <span>Import OpenAPI / WSDL / cURL</span>}
            </button>
          </div>

          {/* Add service */}
          <div className="border-b border-gray-800/80 px-3 py-2">
            {addingService ? (
              <div className="space-y-1.5">
                <input
                  autoFocus
                  className="w-full border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100 outline-none focus:border-gray-400"
                  placeholder="Collection name"
                  value={newServiceName}
                  onChange={(e) => setNewServiceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAddService();
                    if (e.key === 'Escape') setAddingService(false);
                  }}
                />
                {settings?.storageMode === 'json' && settings.jsonStorageStrategy === 'perCollection' && (
                  <div className="flex gap-1">
                    <input
                      className="min-w-0 flex-1 border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-300 outline-none focus:border-gray-400"
                      placeholder="Collection folder (optional)"
                      value={newServicePath}
                      onChange={(e) => setNewServicePath(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => { void chooseCollectionFolder(); }}
                      className="border border-gray-700 px-1.5 text-[10px] text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                      title="Choose collection folder"
                    >
                      …
                    </button>
                  </div>
                )}
                <div className="flex justify-end gap-1">
                  <button type="button" onClick={() => setAddingService(false)} className="px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-200">Cancel</button>
                  <button type="button" onClick={() => { void handleAddService(); }} className="border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-gray-800">Create</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setAddingService(true); setNewServicePath(''); }}
                title="Add service"
                className="flex w-full items-center gap-1.5 py-1 text-xs font-semibold text-gray-400 hover:text-gray-200"
              >
                <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span>Add Service</span>
              </button>
            )}
          </div>


          {/* Favorites */}
          {favorites.length > 0 && (
            <div className="px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Favorites</div>
              {favorites.map((req) => (
                <button
                  key={req.id}
                  onClick={() => { setServiceSettingsServiceId(null); setActiveScriptFile(null); void selectRequest(req.id); }}
                  onContextMenu={(e) => handleContextMenu(e, 'request', req.id)}
                  className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs ${
                    activeRequestId === req.id ? 'bg-gray-800/70 text-gray-100' : 'text-gray-300 hover:bg-gray-900/60'
                  }`}
                >
                  <span className={`font-mono text-[10px] font-bold ${METHOD_COLORS[req.method]}`}>{req.method}</span>
                  <span className="truncate">{req.name}</span>
                  <span className="ml-auto text-gray-300">*</span>
                </button>
              ))}
            </div>
          )}

          {/* Services tree */}
          {services.map((service, index) => (
            <div key={service.id} className="border-b border-gray-900/70">
              <div
                className="group flex cursor-pointer items-center px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-900/60"
                onClick={() => toggleCollapse(service.id)}
                onContextMenu={(e) => handleContextMenu(e, 'service', service.id)}
              >
                <svg
                  className={`mr-1.5 h-3 w-3 text-gray-500 transition-transform ${collapsedServices.has(service.id) ? '' : 'rotate-90'}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                {renamingServiceId === service.id ? (
                  <input
                    autoFocus
                    value={renamingServiceName}
                    onChange={(event) => setRenamingServiceName(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commitRenameService(service.id, event.currentTarget.value);
                      if (event.key === 'Escape') {
                        setRenamingServiceId(null);
                        setRenamingServiceName('');
                      }
                    }}
                    onBlur={(event) => { void commitRenameService(service.id, event.currentTarget.value); }}
                    className="min-w-0 flex-1 border border-gray-600 bg-gray-900 px-1 py-0.5 text-xs text-gray-100 outline-none"
                  />
                ) : (
                  <span className="truncate flex-1">{service.name}</span>
                )}
                {!compact && <span className="mr-1 text-[10px] text-gray-500">{service.requests.length}</span>}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void moveService(activeWorkspaceId, service.id, -1);
                  }}
                  disabled={index === 0}
                  className="p-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-gray-800"
                  title="Move service up"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void moveService(activeWorkspaceId, service.id, 1);
                  }}
                  disabled={index === services.length - 1}
                  className="p-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-gray-800"
                  title="Move service down"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!compact && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCollectionRunner(service.id);
                    }}
                    className="p-0.5 text-gray-500 hover:bg-gray-800 hover:text-emerald-400"
                    title="Run collection"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const bounds = e.currentTarget.getBoundingClientRect();
                    setContextMenu({ type: 'service', id: service.id, x: bounds.right, y: bounds.bottom });
                  }}
                  className="p-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                  title="Collection menu"
                  aria-label={`Open ${service.name} menu`}
                >
                  <span className="text-sm leading-none">⋯</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openServiceSettings(service.id);
                  }}
                  className="p-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                  title="Service settings"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0a1 1 0 00.95.69h.969c.969 0 1.371 1.24.588 1.81l-.784.57a1 1 0 00-.364 1.118l.3.922c.3.921-.755 1.688-1.539 1.118l-.784-.57a1 1 0 00-1.176 0l-.784.57c-.784.57-1.838-.197-1.539-1.118l.3-.922a1 1 0 00-.364-1.118l-.784-.57c-.783-.57-.38-1.81.588-1.81h.969a1 1 0 00.95-.69z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 100 6 3 3 0 000-6z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCollapsedServices((prev) => { const next = new Set(prev); next.delete(service.id); return next; });
                    setAddingRequestToService(service.id);
                    setNewRequestName('');
                  }}
                  className="p-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                  title="Add request"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>

              {/* Requests */}
              {!collapsedServices.has(service.id) && service.requests.map((req) => {
                if (renamingRequestId === req.id) {
                  return (
                    <div key={req.id} className="pl-8 pr-3 py-1.5">
                      <input
                        autoFocus
                        value={renamingRequestName}
                        onChange={(event) => setRenamingRequestName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            void commitRenameRequest(req.id, event.currentTarget.value);
                          }

                          if (event.key === 'Escape') {
                            cancelRenameRequest();
                          }
                        }}
                        onBlur={(event) => {
                          void commitRenameRequest(req.id, event.currentTarget.value);
                        }}
                        className="w-full border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100 outline-none focus:border-gray-400"
                        placeholder="Request name"
                      />
                    </div>
                  );
                }

                return (
                  <button
                    key={req.id}
                  onClick={() => { setServiceSettingsServiceId(null); setActiveScriptFile(null); void selectRequest(req.id); }}
                    onContextMenu={(e) => handleContextMenu(e, 'request', req.id)}
                    className={`w-full text-left pl-8 pr-3 py-1.5 text-xs flex items-center gap-2 ${
                      activeRequestId === req.id
                        ? 'bg-gray-800/70 text-gray-100'
                        : 'text-gray-400 hover:bg-gray-900/50'
                    }`}
                  >
                    <span className={`font-mono text-[10px] font-bold w-10 ${METHOD_COLORS[req.method]}`}>
                      {req.method}
                    </span>
                    <span className="truncate">{req.name}</span>
                    {isRequestDirty(req.id) && (
                      <span className="ml-auto inline-block h-2 w-2 rounded-full bg-amber-500 flex-shrink-0" title="Unsaved changes" />
                    )}
                  </button>
                );
              })}

              {/* Collection JavaScript files */}
              {!collapsedServices.has(service.id) && scriptFiles
                .filter((file) => file.serviceId === service.id)
                .map((file) => (
                  <button
                    key={file.key}
                    type="button"
                    onClick={() => handleOpenScriptFile(service.id, file)}
                    onContextMenu={(event) => handleContextMenu(event, 'script', file.key)}
                    className="flex w-full items-center gap-2 px-8 py-1.5 text-left text-xs text-gray-400 hover:bg-gray-900/50 hover:text-gray-200"
                  >
                    <svg className="h-3.5 w-3.5 flex-shrink-0 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <path d="M7 3h7l4 4v14H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5" />
                      <path d="M10 13l-2 2 2 2M14 13l2 2-2 2" />
                    </svg>
                    <span className="truncate">{file.name}</span>
                  </button>
                ))}

              {/* Add request inline */}
              {!collapsedServices.has(service.id) && addingRequestToService === service.id && (
                <div className="pl-8 pr-3 py-1">
                  <input
                    autoFocus
                    className="w-full border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100 outline-none focus:border-gray-400"
                    placeholder="Request name (Enter to add)"
                    value={newRequestName}
                    onChange={(e) => setNewRequestName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddRequest(service.id);
                      if (e.key === 'Escape') setAddingRequestToService(null);
                    }}
                    onBlur={() => {
                      // Delay to allow Enter keydown to fire first
                      setTimeout(() => {
                        if (!addRequestSubmitting.current) setAddingRequestToService(null);
                      }, 150);
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {sidebarTab === 'variables' && (
        <VariablesSidebarPanel />
      )}

      {sidebarTab === 'mockservers' && (
        <MockServersSidebarPanel />
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label={contextMenu.type === 'request' ? 'Request actions' : contextMenu.type === 'script' ? 'JavaScript file actions' : 'Collection actions'}
          className="fixed z-50 max-h-[calc(100vh-1rem)] min-w-[210px] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-gray-700/80 bg-[#1b1b1b] p-1 shadow-[0_16px_36px_rgba(0,0,0,0.55)] ring-1 ring-black/40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'request' && (
            <>
              <ContextMenuItem icon="play" onClick={() => { void handleRunRequest(contextMenu.id); }}>
                Run Request
              </ContextMenuItem>
              <ContextMenuItem icon="clone" onClick={() => { void handleCloneRequest(contextMenu.id); }}>
                Clone
              </ContextMenuItem>
              <ContextMenuItem icon="copy" onClick={() => { void handleCopyRequest(contextMenu.id); }}>
                Copy
              </ContextMenuItem>
              <ContextMenuItem icon="rename" onClick={() => { startRenameRequest(contextMenu.id); setContextMenu(null); }}>
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                icon="code"
                onClick={() => {
                  const request = services.flatMap((service) => service.requests).find((row) => row.id === contextMenu.id);
                  setShowCodeForRequest(request ?? null);
                  setContextMenu(null);
                }}
              >
                Generate Code
              </ContextMenuItem>
              <ContextMenuItem
                icon="folder"
                onClick={() => {
                  const service = services.find((row) => row.requests.some((request) => request.id === contextMenu.id));
                  setContextMenu(null);
                  void revealPath(service?.storagePath || (settings?.storageMode === 'json' ? settings.storagePath : ''));
                }}
              >
                Reveal in File Explorer
              </ContextMenuItem>
              <div role="separator" className="my-1.5 border-t border-gray-800/80" />
              <ContextMenuItem
                icon="info"
                onClick={() => {
                  setContextMenu(null);
                  const request = services.flatMap((service) => service.requests).find((row) => row.id === contextMenu.id);
                  if (request) {
                    setAlertMessage(`${request.method} ${request.url || '(no URL)'}\n\nCreated: ${request.createdAt}\nUpdated: ${request.updatedAt}`);
                  }
                }}
              >
                Info
              </ContextMenuItem>
              <ContextMenuItem icon="star" onClick={() => { void toggleFavorite(contextMenu.id); setContextMenu(null); }}>
                Toggle Favorite
              </ContextMenuItem>
              <div role="separator" className="my-1.5 border-t border-gray-800/80" />
              <ContextMenuItem icon="trash" danger onClick={() => { deleteRequest(contextMenu.id); setContextMenu(null); }}>
                Delete
              </ContextMenuItem>
            </>
          )}
          {contextMenu.type === 'service' && (
            <>
              <ContextMenuItem
                icon="plus"
                onClick={() => {
                  setCollapsedServices((prev) => { const next = new Set(prev); next.delete(contextMenu.id); return next; });
                  setAddingRequestToService(contextMenu.id);
                  setNewRequestName('');
                  setContextMenu(null);
                }}
              >
                New Request
              </ContextMenuItem>
              <ContextMenuItem icon="folder-plus" onClick={() => { void handleCreateCollectionAsset(contextMenu.id, 'folder'); }}>
                New Folder
              </ContextMenuItem>
              <ContextMenuItem icon="file-code" onClick={() => { void handleCreateCollectionAsset(contextMenu.id, 'js'); }}>
                New JS File
              </ContextMenuItem>
              <div role="separator" className="my-1.5 border-t border-gray-800/80" />
              <ContextMenuItem icon="play" onClick={() => { setShowCollectionRunner(contextMenu.id); setContextMenu(null); }}>
                Run
              </ContextMenuItem>
              <ContextMenuItem icon="clone" onClick={() => { void duplicateService(activeWorkspaceId, contextMenu.id); setContextMenu(null); }}>
                Clone
              </ContextMenuItem>
              <ContextMenuItem icon="rename" onClick={() => { startRenameService(contextMenu.id); }}>
                Rename
              </ContextMenuItem>
              <ContextMenuItem icon="share" onClick={() => { void handleShareCollection(contextMenu.id); }}>
                Share
              </ContextMenuItem>
              <ContextMenuItem icon="file-text" onClick={() => { handleGenerateDocs(contextMenu.id); }}>
                Generate Docs
              </ContextMenuItem>
              <div role="separator" className="my-1.5 border-t border-gray-800/80" />
              <ContextMenuItem icon="collapse" onClick={() => { toggleCollapse(contextMenu.id); setContextMenu(null); }}>
                Collapse
              </ContextMenuItem>
              <ContextMenuItem icon="chevron-up" onClick={() => { void moveService(activeWorkspaceId, contextMenu.id, -1); setContextMenu(null); }}>
                Move Up
              </ContextMenuItem>
              <ContextMenuItem icon="chevron-down" onClick={() => { void moveService(activeWorkspaceId, contextMenu.id, 1); setContextMenu(null); }}>
                Move Down
              </ContextMenuItem>
              <div role="separator" className="my-1.5 border-t border-gray-800/80" />
              <ContextMenuItem
                icon="folder"
                onClick={() => {
                  const service = services.find((row) => row.id === contextMenu.id);
                  setContextMenu(null);
                  if (service) void revealPath(service.storagePath);
                }}
              >
                Reveal in File Explorer
              </ContextMenuItem>
              <div role="separator" className="my-1.5 border-t border-gray-800/80" />
              <ContextMenuItem icon="settings" onClick={() => { openServiceSettings(contextMenu.id); }}>
                Settings
              </ContextMenuItem>
              <ContextMenuItem icon="terminal" onClick={() => { handleOpenTerminal(contextMenu.id); }}>
                Open in Terminal
              </ContextMenuItem>
              <div role="separator" className="my-1.5 border-t border-gray-800/80" />
              <ContextMenuItem
                icon="trash"
                danger
                onClick={() => {
                  if (serviceSettingsServiceId === contextMenu.id) {
                    setServiceSettingsServiceId(null);
                  }
                  deleteService(activeWorkspaceId, contextMenu.id);
                  setContextMenu(null);
                }}
              >
                Remove
              </ContextMenuItem>
            </>
          )}
          {contextMenu.type === 'script' && (() => {
            const file = scriptFiles.find((item) => item.key === contextMenu.id);
            if (!file) return null;

            return (
              <>
                <ContextMenuItem icon="play" onClick={() => handleRunScriptFile(file)}>
                  Run Script
                </ContextMenuItem>
                <ContextMenuItem icon="file-code" onClick={() => handleOpenScriptFile(file.serviceId, file)}>
                  Open
                </ContextMenuItem>
                <ContextMenuItem icon="copy" onClick={() => { void handleCopyScriptPath(file); }}>
                  Copy Path
                </ContextMenuItem>
                <ContextMenuItem icon="folder" onClick={() => { setContextMenu(null); void revealPath(file.path); }}>
                  Reveal in File Explorer
                </ContextMenuItem>
                <div role="separator" className="my-1.5 border-t border-gray-800/80" />
                <ContextMenuItem icon="trash" danger onClick={() => { setContextMenu(null); setScriptToDelete(file); }}>
                  Delete
                </ContextMenuItem>
              </>
            );
          })()}
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          workspaceId={activeWorkspaceId}
        />
      )}

      {collectionAssetDialog && (
        <TextInputModal
          title={collectionAssetDialog.kind === 'folder' ? 'Create folder' : 'Create JavaScript file'}
          label={collectionAssetDialog.kind === 'folder' ? 'Folder name' : 'JavaScript file name'}
          placeholder={collectionAssetDialog.kind === 'folder' ? 'e.g. scripts' : 'e.g. pre-request.js'}
          confirmLabel="Create"
          onConfirm={handleCollectionAssetSubmit}
          onClose={() => setCollectionAssetDialog(null)}
        />
      )}

      {scriptToDelete && (
        <ConfirmModal
          title="Delete JavaScript file"
          message={`Delete ${scriptToDelete.name}? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          busy={deletingScript}
          onConfirm={() => { void handleDeleteScript(); }}
          onClose={() => { if (!deletingScript) setScriptToDelete(null); }}
        />
      )}

      {/* Collection Runner Modal */}
      {showCollectionRunner && (
        <CollectionRunnerModal
          onClose={() => setShowCollectionRunner(null)}
          serviceId={showCollectionRunner}
        />
      )}

      {showCodeForRequest && (
        <CodeSnippetsModal
          onClose={() => setShowCodeForRequest(null)}
          method={showCodeForRequest.method}
          url={showCodeForRequest.url}
          body={showCodeForRequest.body}
          bodyType={showCodeForRequest.bodyType}
          headers={showCodeForRequest.headers.map((header) => ({
            key: header.key,
            value: header.value,
            enabled: header.enabled,
          }))}
        />
      )}

      {alertMessage !== null && (
        <AlertModal
          title="Notice"
          message={alertMessage}
          onClose={() => setAlertMessage(null)}
        />
      )}
    </div>
  );
}
