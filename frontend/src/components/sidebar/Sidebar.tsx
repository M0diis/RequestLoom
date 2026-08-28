import { useState, useRef, useEffect } from 'react';
import { useRequestStore } from '../../stores/requestStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useUiStore } from '../../stores/uiStore';
import { VariablesSidebarPanel } from '../variables/VariablesSidebarPanel';
import { MockServersSidebarPanel } from '../mockserver/MockServersSidebarPanel';
import { ImportModal } from '../common/ImportModal';
import { CollectionRunnerModal } from '../common/CollectionRunnerModal';
import { CodeSnippetsModal } from '../common/CodeSnippetsModal';
import { useSettingsStore } from '../../stores/settingsStore';
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

const MENU_ITEM = 'block w-full px-2 py-1 text-left text-[11px] text-gray-200 hover:bg-gray-800 whitespace-nowrap';
const MENU_DANGER = 'block w-full px-2 py-1 text-left text-[11px] text-rose-300 hover:bg-rose-950/30';

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
  const { settings } = useSettingsStore();
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePath, setNewServicePath] = useState('');
  const [addingService, setAddingService] = useState(false);
  const [addingRequestToService, setAddingRequestToService] = useState<string | null>(null);
  const [newRequestName, setNewRequestName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ type: 'service' | 'request'; id: string; x: number; y: number } | null>(null);
  const [collapsedServices, setCollapsedServices] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [showCollectionRunner, setShowCollectionRunner] = useState<string | null>(null);
  const [renamingRequestId, setRenamingRequestId] = useState<string | null>(null);
  const [renamingRequestName, setRenamingRequestName] = useState('');
  const [renamingServiceId, setRenamingServiceId] = useState<string | null>(null);
  const [renamingServiceName, setRenamingServiceName] = useState('');
  const [showCodeForRequest, setShowCodeForRequest] = useState<ApiRequest | null>(null);
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

  const handleContextMenu = (e: React.MouseEvent, type: 'service' | 'request', id: string) => {
    e.preventDefault();
    setContextMenu({ type, id, x: e.clientX, y: e.clientY });
  };

  const openServiceSettings = (serviceId: string) => {
    setServiceSettingsServiceId(serviceId);
    setContextMenu(null);
  };

  const handleRunRequest = async (requestId: string) => {
    setContextMenu(null);
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
      window.alert('This item is not backed by a local file in the current storage mode.');
      return;
    }
    if (window.desktopShell) {
      const revealed = await window.desktopShell.revealPath(targetPath);
      if (!revealed) window.alert(`Could not find ${targetPath}`);
      return;
    }
    await navigator.clipboard.writeText(targetPath).catch(() => {});
    window.alert(`Path copied to clipboard:\n${targetPath}`);
  };

  const handleCopyRequest = async (requestId: string) => {
    setContextMenu(null);
    const stored = await requestsApi.getFile(requestId);
    await navigator.clipboard.writeText(stored.content).catch(() => {});
  };

  const handleCreateExample = async (requestId: string) => {
    setContextMenu(null);
    const original = services.flatMap((service) => service.requests).find((request) => request.id === requestId);
    if (!original) return;
    const example = await duplicateRequest(requestId);
    await updateRequest(example.id, { name: `${original.name} Example` });
    await selectRequest(example.id);
  };

  const handleCreateCollectionAsset = async (serviceId: string, kind: 'folder' | 'js') => {
    setContextMenu(null);
    const label = kind === 'folder' ? 'Folder name' : 'JavaScript file name';
    const name = window.prompt(label);
    if (!name?.trim()) return;
    try {
      const result = await serviceFilesApi.create(activeWorkspaceId, serviceId, name.trim(), kind);
      await revealPath(result.path);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to create collection file');
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
                  onClick={() => { setServiceSettingsServiceId(null); selectRequest(req.id); }}
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
                    onClick={() => { setServiceSettingsServiceId(null); selectRequest(req.id); }}
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
          className="fixed z-50 w-max min-w-[110px] border border-gray-700 bg-gray-900 py-0.5 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'request' && (
            <>
              <button
                className={MENU_ITEM}
                onClick={() => { void handleRunRequest(contextMenu.id); }}
              >
                ▶ Run Request
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { void duplicateRequest(contextMenu.id); setContextMenu(null); }}
              >
                Clone
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { void handleCopyRequest(contextMenu.id); }}
              >
                Copy
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { startRenameRequest(contextMenu.id); setContextMenu(null); }}
              >
                Rename
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => {
                  const request = services.flatMap((service) => service.requests).find((row) => row.id === contextMenu.id);
                  setShowCodeForRequest(request ?? null);
                  setContextMenu(null);
                }}
              >
                Generate Code
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { void handleCreateExample(contextMenu.id); }}
              >
                Create Example
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => {
                  const service = services.find((row) => row.requests.some((request) => request.id === contextMenu.id));
                  setContextMenu(null);
                  void revealPath(service?.storagePath || (settings?.storageMode === 'json' ? settings.storagePath : ''));
                }}
              >
                Reveal in File Explorer
              </button>
              <div className="my-1 border-t border-gray-800" />
              <button
                className={MENU_ITEM}
                onClick={() => {
                  setContextMenu(null);
                  const request = services.flatMap((service) => service.requests).find((row) => row.id === contextMenu.id);
                  if (request) {
                    window.alert(`${request.method} ${request.url || '(no URL)'}\n\nCreated: ${request.createdAt}\nUpdated: ${request.updatedAt}`);
                  }
                }}
              >
                Info
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { void toggleFavorite(contextMenu.id); setContextMenu(null); }}
              >
                Toggle Favorite
              </button>
              <button
                className={MENU_DANGER}
                onClick={() => { deleteRequest(contextMenu.id); setContextMenu(null); }}
              >
                Delete
              </button>
            </>
          )}
          {contextMenu.type === 'service' && (
            <>
              <button
                className={MENU_ITEM}
                onClick={() => {
                  setCollapsedServices((prev) => { const next = new Set(prev); next.delete(contextMenu.id); return next; });
                  setAddingRequestToService(contextMenu.id);
                  setNewRequestName('');
                  setContextMenu(null);
                }}
              >
                New Request
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { void handleCreateCollectionAsset(contextMenu.id, 'folder'); }}
              >
                New Folder
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { void handleCreateCollectionAsset(contextMenu.id, 'js'); }}
              >
                New JS File
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { setShowCollectionRunner(contextMenu.id); setContextMenu(null); }}
              >
                ▶ Run
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { void duplicateService(activeWorkspaceId, contextMenu.id); setContextMenu(null); }}
              >
                Clone
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { startRenameService(contextMenu.id); }}
              >
                Rename
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { void handleShareCollection(contextMenu.id); }}
              >
                Share
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { handleGenerateDocs(contextMenu.id); }}
              >
                Generate Docs
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { toggleCollapse(contextMenu.id); setContextMenu(null); }}
              >
                Collapse
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { void moveService(activeWorkspaceId, contextMenu.id, -1); setContextMenu(null); }}
              >
                Move Up
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { void moveService(activeWorkspaceId, contextMenu.id, 1); setContextMenu(null); }}
              >
                Move Down
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => {
                  const service = services.find((row) => row.id === contextMenu.id);
                  setContextMenu(null);
                  if (service) void revealPath(service.storagePath);
                }}
              >
                Reveal in File Explorer
              </button>
              <div className="my-1 border-t border-gray-800" />
              <button
                className={MENU_ITEM}
                onClick={() => { openServiceSettings(contextMenu.id); }}
              >
                Settings
              </button>
              <button
                className={MENU_ITEM}
                onClick={() => { handleOpenTerminal(contextMenu.id); }}
              >
                Open in Terminal
              </button>
              <button
                className={MENU_DANGER}
                onClick={() => {
                  if (serviceSettingsServiceId === contextMenu.id) {
                    setServiceSettingsServiceId(null);
                  }
                  deleteService(activeWorkspaceId, contextMenu.id);
                  setContextMenu(null);
                }}
              >
                Remove
              </button>
            </>
          )}
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          workspaceId={activeWorkspaceId}
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
    </div>
  );
}
