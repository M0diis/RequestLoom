import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { useRequestStore } from '../../stores/requestStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useUiStore } from '../../stores/uiStore';
import { VariablesSidebarPanel } from '../variables/VariablesSidebarPanel';
import { MockServersSidebarPanel } from '../mockserver/MockServersSidebarPanel';
import { DocumentationSidebar } from '../documentation/DocumentationSidebar';
import { CollectionRunnerModal } from '../common/CollectionRunnerModal';
import { CodeSnippetsModal } from '../common/CodeSnippetsModal';
import { AlertModal } from '../common/AlertModal';
import { ConfirmModal } from '../common/ConfirmModal';
import { TextInputModal } from '../common/TextInputModal';
import { MoveRequestFolderModal } from '../common/MoveRequestFolderModal';
import { DeleteRequestFolderModal } from '../common/DeleteRequestFolderModal';
import { MoveRequestCollectionModal } from '../common/MoveRequestCollectionModal';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast, copyWithToast } from '../../stores/toastStore';
import { useScriptFileStore, type ScriptFileEntry } from '../../stores/scriptFileStore';
import { exportImportApi, requestsApi, serviceFilesApi } from '../../services/api';
import type { ApiRequest, FolderContentsAction } from '../../types';

const REQUEST_INDENTS = ['pl-8', 'pl-12', 'pl-16', 'pl-20', 'pl-24', 'pl-28'];

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
const QUICK_FORM_ROW = 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5';
const QUICK_FORM_INPUT = 'h-8 min-w-0 w-full border border-gray-600 bg-gray-900 px-2 text-xs text-gray-100 outline-none focus:border-[#ff6c37]';
const QUICK_FORM_PRIMARY = 'h-8 border border-[#ff6c37] bg-[#ff6c37] px-2.5 text-[10px] font-semibold text-white transition-colors hover:bg-[#f95e26]';
const QUICK_FORM_CANCEL = 'h-8 border border-gray-700 bg-gray-900 px-2 text-[10px] text-gray-400 transition-colors hover:border-gray-600 hover:bg-gray-800 hover:text-gray-200';

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
    topLevelRequests,
    activeRequestId,
    selectRequest,
    createService,
    duplicateService,
    createRequest,
    createTopLevelRequest,
    updateRequest,
    deleteServiceWithUndo,
    deleteRequestsWithUndo,
    duplicateRequest,
    toggleFavorite,
    isRequestDirty,
    moveService,
    reorderServices,
    createFolder,
    updateFolder,
    deleteFolder,
    reorderFolders,
    moveFolder,
    moveRequestToFolder,
    reorderRequest,
    moveRequestToService,
    moveRequestToTopLevel,
    loading: requestsLoading,
  } = useRequestStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const {
    sidebarTab,
    setSidebarTab,
    serviceSettingsServiceId,
    setServiceSettingsServiceId,
    setTerminalCwd,
    setNewRequestModalOpen,
    setImportDialogKind,
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
  const [addingTopLevelRequest, setAddingTopLevelRequest] = useState(false);
  const [addingRequestToService, setAddingRequestToService] = useState<string | null>(null);
  const [addingRequestToFolder, setAddingRequestToFolder] = useState<{ serviceId: string; folderId: string } | null>(null);
  const [newRequestName, setNewRequestName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ type: 'service' | 'request' | 'folder' | 'script'; id: string; x: number; y: number } | null>(null);
  const [collapsedServices, setCollapsedServices] = useState<Set<string>>(new Set());
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [topLevelCollapsed, setTopLevelCollapsed] = useState(false);
  const [showCollectionRunner, setShowCollectionRunner] = useState<{ serviceId: string; folderId?: string } | null>(null);
  const [renamingRequestId, setRenamingRequestId] = useState<string | null>(null);
  const [renamingRequestName, setRenamingRequestName] = useState('');
  const [renamingServiceId, setRenamingServiceId] = useState<string | null>(null);
  const [renamingServiceName, setRenamingServiceName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState('');
  const [collectionPathDialogOpen, setCollectionPathDialogOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [folderDialog, setFolderDialog] = useState<{
    mode: 'create' | 'rename';
    serviceId: string;
    folderId?: string;
    parentFolderId?: string | null;
    initialValue: string;
  } | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<{ serviceId: string; id: string; name: string } | null>(null);
  const [moveRequestId, setMoveRequestId] = useState<string | null>(null);
  const [bulkMove, setBulkMove] = useState<{ kind: 'folder' | 'collection'; ids: string[] } | null>(null);
  const [moveRequestToCollectionId, setMoveRequestToCollectionId] = useState<string | null>(null);
  const [showCodeForRequest, setShowCodeForRequest] = useState<ApiRequest | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [collectionAssetDialog, setCollectionAssetDialog] = useState<{
    serviceId: string;
    kind: 'folder' | 'js';
  } | null>(null);
  const [scriptToDelete, setScriptToDelete] = useState<ScriptFileEntry | null>(null);
  const [deletingScript, setDeletingScript] = useState(false);
  const [draggingRequestId, setDraggingRequestId] = useState<string | null>(null);
  const [draggingRequestIds, setDraggingRequestIds] = useState<string[]>([]);
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [draggingServiceId, setDraggingServiceId] = useState<string | null>(null);
  const [dragOverRequestId, setDragOverRequestId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverFolderOrderId, setDragOverFolderOrderId] = useState<string | null>(null);
  const [dragOverServiceId, setDragOverServiceId] = useState<string | null>(null);
  const [dragOverServiceOrderId, setDragOverServiceOrderId] = useState<string | null>(null);
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

  const favorites = [...topLevelRequests, ...services.flatMap((s) => s.requests)].filter((r) => r.isFavorite);
  const allRequests = [...topLevelRequests, ...services.flatMap((service) => service.requests)];

  // Sidebar filter: matching items are shown with their ancestors, and collapsed state is ignored.
  const normalizedFilter = filterQuery.trim().toLowerCase();
  const filterActive = normalizedFilter.length > 0;
  const textMatchesFilter = (text: string) => text.toLowerCase().includes(normalizedFilter);
  const requestMatchesFilter = (request: ApiRequest) =>
    !filterActive || textMatchesFilter(`${request.method} ${request.name} ${request.url}`);
  const folderHasMatch = (service: (typeof services)[number], folderId: string): boolean =>
    service.folders.some((folder) => folder.id === folderId && textMatchesFilter(folder.name))
    || service.requests.some((request) => request.folderId === folderId && requestMatchesFilter(request))
    || service.folders.some((folder) => folder.parentFolderId === folderId && folderHasMatch(service, folder.id));
  const serviceShowsAll = (service: (typeof services)[number]) => !filterActive || textMatchesFilter(service.name);
  const visibleServices = filterActive
    ? services.filter((service) => serviceShowsAll(service)
      || service.requests.some(requestMatchesFilter)
      || service.folders.some((folder) => textMatchesFilter(folder.name)))
    : services;
  const visibleTopLevelRequests = topLevelRequests.filter(requestMatchesFilter);
  const isServiceCollapsed = (serviceId: string) => !filterActive && collapsedServices.has(serviceId);
  const workspaceIsEmpty = services.length === 0 && topLevelRequests.length === 0;

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

    setCollectionPathDialogOpen(true);
  };

  const handleAddRequest = async (serviceId: string, folderId: string | null = null) => {
    if (!newRequestName.trim() || addRequestSubmitting.current) return;
    addRequestSubmitting.current = true;
    try {
      const req = await createRequest(serviceId, newRequestName.trim(), 'GET', folderId);
      setNewRequestName('');
      setAddingRequestToService(null);
      setAddingRequestToFolder(null);
      setActiveScriptFile(null);
      await selectRequest(req.id);
    } finally {
      addRequestSubmitting.current = false;
    }
  };

  const handleAddTopLevelRequest = async () => {
    if (!newRequestName.trim() || addRequestSubmitting.current) return;
    addRequestSubmitting.current = true;
    try {
      const req = await createTopLevelRequest(activeWorkspaceId, newRequestName.trim(), 'GET');
      setNewRequestName('');
      setAddingTopLevelRequest(false);
      setActiveScriptFile(null);
      await selectRequest(req.id);
    } finally {
      addRequestSubmitting.current = false;
    }
  };

  const closeTopLevelRequestComposer = () => {
    setAddingTopLevelRequest(false);
    setNewRequestName('');
  };

  const closeCollectionComposer = () => {
    setAddingService(false);
    setNewServiceName('');
    setNewServicePath('');
  };

  const toggleTopLevelRequestComposer = () => {
    if (addingTopLevelRequest) {
      closeTopLevelRequestComposer();
      return;
    }

    closeCollectionComposer();
    setAddingTopLevelRequest(true);
    setAddingRequestToService(null);
    setAddingRequestToFolder(null);
    setNewRequestName('');
  };

  const toggleCollectionComposer = () => {
    if (addingService) {
      closeCollectionComposer();
      return;
    }

    closeTopLevelRequestComposer();
    setAddingService(true);
    setAddingRequestToService(null);
    setAddingRequestToFolder(null);
  };

  const startRenameRequest = (requestId: string) => {
    const request = allRequests.find((row) => row.id === requestId);

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
    const request = allRequests.find((row) => row.id === requestId);

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

  const handleContextMenu = (e: React.MouseEvent, type: 'service' | 'request' | 'folder' | 'script', id: string) => {
    e.preventDefault();
    if (type !== 'request' || !selectedRequestIds.has(id)) {
      if (selectedRequestIds.size > 0) setSelectedRequestIds(new Set());
    }
    setContextMenu({ type, id, x: e.clientX, y: e.clientY });
  };

  const openCreateFolderDialog = (serviceId: string, parentFolderId: string | null = null) => {
    setContextMenu(null);
    setFolderDialog({ mode: 'create', serviceId, parentFolderId, initialValue: '' });
  };

  const startRenameFolder = (folderId: string, name: string) => {
    setContextMenu(null);
    setRenamingFolderId(folderId);
    setRenamingFolderName(name);
  };

  const commitRenameFolder = async (serviceId: string, folderId: string, candidateName: string) => {
    const folder = services.find((row) => row.id === serviceId)?.folders.find((row) => row.id === folderId);
    const nextName = candidateName.trim();
    setRenamingFolderId(null);
    setRenamingFolderName('');
    if (!folder || !nextName || nextName === folder.name) return;
    try {
      await updateFolder(activeWorkspaceId, serviceId, folderId, nextName);
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : 'Failed to rename request folder');
    }
  };

  const handleFolderDialogSubmit = async (name: string) => {
    if (!folderDialog) return;
    try {
      if (folderDialog.mode === 'create') {
        await createFolder(activeWorkspaceId, folderDialog.serviceId, name, folderDialog.parentFolderId);
        if (folderDialog.parentFolderId) {
          const parentId = folderDialog.parentFolderId;
          setCollapsedFolders((previous) => { const next = new Set(previous); next.delete(parentId); return next; });
        }
      } else if (folderDialog.folderId) {
        await updateFolder(activeWorkspaceId, folderDialog.serviceId, folderDialog.folderId, name);
      }
      setFolderDialog(null);
    } catch (error) {
      setFolderDialog(null);
      setAlertMessage(error instanceof Error ? error.message : 'Failed to save request folder');
    }
  };

  const handleDeleteFolder = async (contents: FolderContentsAction, targetFolderId?: string | null) => {
    if (!folderToDelete) return;
    try {
      await deleteFolder(activeWorkspaceId, folderToDelete.serviceId, folderToDelete.id, contents, targetFolderId);
      setCollapsedFolders((previous) => {
        const next = new Set(previous);
        next.delete(folderToDelete.id);
        return next;
      });
      setFolderToDelete(null);
    } catch (error) {
      setFolderToDelete(null);
      setAlertMessage(error instanceof Error ? error.message : 'Failed to delete request folder');
    }
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

  const clearDragState = () => {
    setDraggingRequestId(null);
    setDraggingRequestIds([]);
    setDraggingFolderId(null);
    setDraggingServiceId(null);
    setDragOverRequestId(null);
    setDragOverFolderId(null);
    setDragOverFolderOrderId(null);
    setDragOverServiceId(null);
    setDragOverServiceOrderId(null);
  };

  const getDraggedRequestId = (event: React.DragEvent) =>
    event.dataTransfer.getData('text/plain') || draggingRequestId;

  const getDraggedRequestIds = (event: React.DragEvent): string[] => {
    try {
      const raw = event.dataTransfer.getData('application/x-requestloom-requests');
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.filter((id): id is string => typeof id === 'string');
    } catch {
      // Fall through to the single-request payload.
    }
    if (draggingRequestIds.length > 0) return draggingRequestIds;
    const single = getDraggedRequestId(event);
    return single ? [single] : [];
  };

  const getVisibleRequestOrder = (): string[] => {
    const ids: string[] = [];
    if (!topLevelCollapsed) topLevelRequests.forEach((request) => ids.push(request.id));
    for (const service of services) {
      if (collapsedServices.has(service.id)) continue;
      const knownFolderIds = new Set(service.folders.map((folder) => folder.id));
      const walk = (parentId: string | null) => {
        const children = service.folders.filter((folder) => parentId === null
          ? !folder.parentFolderId || !knownFolderIds.has(folder.parentFolderId)
          : folder.parentFolderId === parentId);
        for (const folder of children) {
          if (collapsedFolders.has(folder.id)) continue;
          walk(folder.id);
          service.requests.filter((request) => request.folderId === folder.id).forEach((request) => ids.push(request.id));
        }
      };
      walk(null);
      service.requests.filter((request) => !request.folderId).forEach((request) => ids.push(request.id));
    }
    return ids;
  };

  /** Handles Shift/Ctrl selection. Returns true when the click was consumed (no navigation). */
  const handleRequestSelectionClick = (event: React.MouseEvent, requestId: string): boolean => {
    const additive = event.ctrlKey || event.metaKey;
    if (!event.shiftKey && !additive) {
      if (selectedRequestIds.size > 0) setSelectedRequestIds(new Set());
      setSelectionAnchorId(requestId);
      return false;
    }

    const order = getVisibleRequestOrder();
    const base = selectedRequestIds.size === 0 && activeRequestId && order.includes(activeRequestId)
      ? new Set([activeRequestId])
      : new Set(selectedRequestIds);

    if (event.shiftKey) {
      const anchor = selectionAnchorId && order.includes(selectionAnchorId) ? selectionAnchorId : activeRequestId ?? requestId;
      const from = order.indexOf(anchor);
      const to = order.indexOf(requestId);
      const range = from < 0 || to < 0
        ? [requestId]
        : order.slice(Math.min(from, to), Math.max(from, to) + 1);
      setSelectedRequestIds(new Set(additive ? [...base, ...range] : range));
      if (!selectionAnchorId) setSelectionAnchorId(anchor);
    } else {
      if (base.has(requestId)) base.delete(requestId);
      else base.add(requestId);
      setSelectedRequestIds(base);
      setSelectionAnchorId(requestId);
    }
    return true;
  };

  const getDraggedFolderId = (event: React.DragEvent) =>
    event.dataTransfer.getData('application/x-requestloom-folder') || draggingFolderId;

  const getDraggedServiceId = (event: React.DragEvent) =>
    event.dataTransfer.getData('application/x-requestloom-service') || draggingServiceId;

  const handleDropOnRequest = (event: React.DragEvent, target: ApiRequest) => {
    event.preventDefault();
    event.stopPropagation();
    const requestIds = getDraggedRequestIds(event).filter((id) => id !== target.id);
    if (requestIds.length === 0) {
      clearDragState();
      return;
    }

    const move = (async () => {
      for (const requestId of requestIds) {
        const source = allRequests.find((request) => request.id === requestId);
        if (!source) continue;
        if (source.serviceId !== target.serviceId) {
          if (target.serviceId) await moveRequestToService(requestId, target.serviceId);
          else await moveRequestToTopLevel(requestId);
        } else {
          await reorderRequest(requestId, target.folderId ?? null, target.id);
        }
      }
    })();

    void move
      .catch((error) => setAlertMessage(error instanceof Error ? error.message : 'Failed to move request'))
      .finally(clearDragState);
  };

  const handleDropOnTopLevel = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const requestIds = getDraggedRequestIds(event)
      .filter((id) => allRequests.find((request) => request.id === id)?.serviceId != null);
    if (requestIds.length === 0) {
      clearDragState();
      return;
    }

    void (async () => {
      for (const requestId of requestIds) await moveRequestToTopLevel(requestId);
    })()
      .catch((error) => setAlertMessage(error instanceof Error ? error.message : 'Failed to move request'))
      .finally(clearDragState);
  };

  const handleDropOnFolder = (event: React.DragEvent, folderId: string) => {
    event.preventDefault();
    const requestIds = getDraggedRequestIds(event);
    if (requestIds.length === 0) {
      clearDragState();
      return;
    }

    void (async () => {
      for (const requestId of requestIds) await reorderRequest(requestId, folderId, null);
    })()
      .catch((error) => setAlertMessage(error instanceof Error ? error.message : 'Failed to move request'))
      .finally(clearDragState);
  };

  /** Dropping on the middle of a folder row nests; dropping near its top/bottom edge reorders. */
  const getFolderDropZone = (event: React.DragEvent): 'nest' | 'before' | 'after' => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
    if (offset < 0.25) return 'before';
    if (offset > 0.75) return 'after';
    return 'nest';
  };

  const handleDropOnFolderOrder = (event: React.DragEvent, serviceId: string, targetFolderId: string) => {
    event.preventDefault();
    const sourceFolderId = getDraggedFolderId(event);
    if (!sourceFolderId || sourceFolderId === targetFolderId) {
      clearDragState();
      return;
    }

    const service = services.find((item) => item.id === serviceId);
    const sourceFolder = service?.folders.find((folder) => folder.id === sourceFolderId);
    const targetFolder = service?.folders.find((folder) => folder.id === targetFolderId);
    if (!service || !sourceFolder || !targetFolder) {
      clearDragState();
      return;
    }

    const zone = getFolderDropZone(event);
    const run = async () => {
      if (zone === 'nest') {
        if (sourceFolder.parentFolderId !== targetFolderId) {
          await moveFolder(activeWorkspaceId, serviceId, sourceFolderId, targetFolderId);
        }
        setCollapsedFolders((previous) => { const next = new Set(previous); next.delete(targetFolderId); return next; });
        return;
      }

      // Reordering next to a folder with a different parent also re-parents the dragged folder.
      if ((sourceFolder.parentFolderId ?? null) !== (targetFolder.parentFolderId ?? null)) {
        await moveFolder(activeWorkspaceId, serviceId, sourceFolderId, targetFolder.parentFolderId ?? null);
      }
      const latest = useRequestStore.getState().services.find((item) => item.id === serviceId) ?? service;
      const nextFolderIds = latest.folders.map((folder) => folder.id).filter((id) => id !== sourceFolderId);
      const targetIndex = nextFolderIds.indexOf(targetFolderId);
      if (targetIndex < 0) return;
      nextFolderIds.splice(targetIndex + (zone === 'after' ? 1 : 0), 0, sourceFolderId);
      await reorderFolders(activeWorkspaceId, serviceId, nextFolderIds);
    };

    void run()
      .catch((error) => setAlertMessage(error instanceof Error ? error.message : 'Failed to move folder'))
      .finally(clearDragState);
  };

  const handleDropFolderOnService = (event: React.DragEvent, serviceId: string) => {
    event.preventDefault();
    const folderId = getDraggedFolderId(event);
    const folder = services.find((item) => item.id === serviceId)?.folders.find((row) => row.id === folderId);
    if (!folder || !folder.parentFolderId) {
      clearDragState();
      return;
    }

    void moveFolder(activeWorkspaceId, serviceId, folder.id, null)
      .catch((error) => setAlertMessage(error instanceof Error ? error.message : 'Failed to move folder'))
      .finally(clearDragState);
  };

  const handleDropOnServiceOrder = (event: React.DragEvent, targetServiceId: string) => {
    event.preventDefault();
    const sourceServiceId = getDraggedServiceId(event);
    if (!sourceServiceId || sourceServiceId === targetServiceId) {
      clearDragState();
      return;
    }

    const nextServiceIds = services.map((service) => service.id).filter((id) => id !== sourceServiceId);
    const targetIndex = nextServiceIds.indexOf(targetServiceId);
    if (targetIndex < 0) {
      clearDragState();
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const insertIndex = targetIndex + (event.clientY >= bounds.top + bounds.height / 2 ? 1 : 0);
    nextServiceIds.splice(insertIndex, 0, sourceServiceId);

    void reorderServices(activeWorkspaceId, nextServiceIds)
      .catch((error) => setAlertMessage(error instanceof Error ? error.message : 'Failed to reorder services'))
      .finally(clearDragState);
  };

  const handleDropOnService = (event: React.DragEvent, serviceId: string) => {
    event.preventDefault();
    const requestIds = getDraggedRequestIds(event)
      .filter((id) => allRequests.find((request) => request.id === id)?.serviceId !== serviceId);
    if (requestIds.length === 0) {
      clearDragState();
      return;
    }

    void (async () => {
      for (const requestId of requestIds) await moveRequestToService(requestId, serviceId);
    })()
      .catch((error) => setAlertMessage(error instanceof Error ? error.message : 'Failed to move request'))
      .finally(clearDragState);
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
    try {
      const stored = await requestsApi.getFile(requestId);
      await copyWithToast(stored.content, 'Request copied to clipboard');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not copy request', { variant: 'error' });
    }
  };

  const handleCloneRequest = async (requestId: string) => {
    setContextMenu(null);
    setActiveScriptFile(null);
    try {
      const clonedRequest = await duplicateRequest(requestId);
      await selectRequest(clonedRequest.id);
      toast(`Cloned as "${clonedRequest.name}"`);
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : 'Failed to clone request');
    }
  };

  const handleMoveRequestToTopLevel = async (requestId: string) => {
    setContextMenu(null);
    try {
      await moveRequestToTopLevel(requestId);
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : 'Failed to move request to top level');
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
    await copyWithToast(file.path, 'Path copied to clipboard');
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
    try {
      const data = await exportImportApi.exportService(serviceId);
      await copyWithToast(JSON.stringify(data, null, 2), 'Collection JSON copied to clipboard');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not share collection', { variant: 'error' });
    }
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
    void copyWithToast(markdown, 'Collection docs copied as Markdown');
  };

  const handleOpenTerminal = (serviceId: string) => {
    const service = services.find((row) => row.id === serviceId);
    if (!service) return;
    setContextMenu(null);
    setTerminalCwd(service.storagePath || settings?.storagePath || '');
  };

  // Keep the menu fully inside the window when opened near the right/bottom edge.
  useLayoutEffect(() => {
    const menu = contextMenuRef.current;
    if (!contextMenu || !menu) return;
    const margin = 8;
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(margin, Math.min(contextMenu.x, window.innerWidth - width - margin));
    const top = Math.max(margin, Math.min(contextMenu.y, window.innerHeight - height - margin));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, [contextMenu]);

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

  const renderFolderLevel = (service: (typeof services)[number], parentId: string | null, depth: number, showAll = true): React.ReactNode => {
    const knownFolderIds = new Set(service.folders.map((folder) => folder.id));
    return service.folders
      .filter((folder) => parentId === null
        ? !folder.parentFolderId || !knownFolderIds.has(folder.parentFolderId)
        : folder.parentFolderId === parentId)
      .filter((folder) => showAll || folderHasMatch(service, folder.id))
      .map((folder) => {
      const folderRequests = service.requests.filter((request) => request.folderId === folder.id);
      const folderShowsAll = showAll || textMatchesFilter(folder.name);
      const visibleFolderRequests = folderShowsAll ? folderRequests : folderRequests.filter(requestMatchesFilter);
      const folderCollapsed = !filterActive && collapsedFolders.has(folder.id);
      return (
        <div key={folder.id}>
          <div
            draggable
            style={{ paddingLeft: 12 + depth * 16 }}
            className={`group flex cursor-pointer items-center gap-1.5 pr-3 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-900/60 ${
              dragOverFolderOrderId === folder.id
                ? 'border-t-2 border-cyan-400/80 bg-cyan-500/10'
                : dragOverFolderId === folder.id
                  ? 'bg-cyan-500/10 ring-1 ring-inset ring-cyan-400/70'
                  : draggingFolderId === folder.id
                    ? 'opacity-50'
                    : ''
            }`}
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-requestloom-folder', folder.id);
              event.dataTransfer.effectAllowed = 'move';
              setDraggingFolderId(folder.id);
              setDraggingRequestId(null);
            }}
            onDragEnd={clearDragState}
            onClick={() => {
              if (draggingFolderId || renamingFolderId === folder.id) return;
              setCollapsedFolders((previous) => {
                const next = new Set(previous);
                if (next.has(folder.id)) next.delete(folder.id);
                else next.add(folder.id);
                return next;
              });
            }}
            onContextMenu={(event) => handleContextMenu(event, 'folder', folder.id)}
            onDoubleClick={(event) => { event.stopPropagation(); startRenameFolder(folder.id, folder.name); }}
            onDragOver={(event) => {
              if (draggingFolderId) {
                if (draggingFolderId === folder.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (getFolderDropZone(event) === 'nest') {
                  setDragOverFolderId(folder.id);
                  setDragOverFolderOrderId(null);
                } else {
                  setDragOverFolderOrderId(folder.id);
                  setDragOverFolderId(null);
                }
                setDragOverServiceId(null);
                setDragOverRequestId(null);
                return;
              }
              if (!getDraggedRequestId(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragOverFolderId(folder.id);
              setDragOverServiceId(null);
              setDragOverRequestId(null);
            }}
            onDragLeave={(event) => {
              if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) {
                setDragOverFolderId((current) => current === folder.id ? null : current);
                setDragOverFolderOrderId((current) => current === folder.id ? null : current);
              }
            }}
            onDrop={(event) => {
              if (getDraggedFolderId(event)) handleDropOnFolderOrder(event, service.id, folder.id);
              else handleDropOnFolder(event, folder.id);
            }}
          >
            <span
              aria-hidden="true"
              className="w-3 cursor-grab select-none text-[13px] leading-none text-gray-600 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:text-gray-400 active:cursor-grabbing"
              title="Drag to reorder folders"
            >
              ⠿
            </span>
            <svg className={`h-3 w-3 flex-shrink-0 text-gray-500 transition-transform ${folderCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
            {renamingFolderId === folder.id ? (
              <input
                autoFocus
                value={renamingFolderName}
                onChange={(event) => setRenamingFolderName(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void commitRenameFolder(service.id, folder.id, event.currentTarget.value);
                  if (event.key === 'Escape') { setRenamingFolderId(null); setRenamingFolderName(''); }
                }}
                onBlur={(event) => { void commitRenameFolder(service.id, folder.id, event.currentTarget.value); }}
                className="min-w-0 flex-1 border border-gray-600 bg-gray-900 px-1 py-0.5 text-xs text-gray-100 outline-none"
                aria-label="Folder name"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate" title="Double-click to rename">{folder.name}</span>
            )}
            <span
              className="ml-auto min-w-5 text-right text-[10px] text-gray-500"
              title={`${folderRequests.length} request${folderRequests.length === 1 ? '' : 's'}`}
            >
              {folderRequests.length}
            </span>
            {!compact && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setCollapsedFolders((previous) => { const next = new Set(previous); next.delete(folder.id); return next; });
                  setAddingRequestToService(null);
                  setAddingRequestToFolder({ serviceId: service.id, folderId: folder.id });
                  setNewRequestName('');
                }}
                className="p-0.5 text-gray-500 hover:text-gray-200"
                title="Add request to folder"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              </button>
            )}
            {!compact && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setContextMenu({ type: 'folder', id: folder.id, x: bounds.right, y: bounds.bottom });
                }}
                className="p-0.5 text-gray-500 hover:text-gray-300"
                title="Folder menu"
                aria-label={`Open ${folder.name} menu`}
              >
                <span className="text-sm leading-none">⋯</span>
              </button>
            )}
          </div>
          {!folderCollapsed && renderFolderLevel(service, folder.id, depth + 1, folderShowsAll)}
          {!folderCollapsed && visibleFolderRequests.map((request) => renderRequest(request, REQUEST_INDENTS[Math.min(depth, REQUEST_INDENTS.length - 1)]))}
          {!folderCollapsed && addingRequestToFolder?.serviceId === service.id && addingRequestToFolder.folderId === folder.id && (
            <div style={{ paddingLeft: 72 + depth * 16 }} className={`pr-3 py-1 ${QUICK_FORM_ROW}`}>
              <input
                autoFocus
                className={QUICK_FORM_INPUT}
                placeholder="Request name (Enter to add)"
                value={newRequestName}
                onChange={(event) => setNewRequestName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleAddRequest(service.id, folder.id);
                  if (event.key === 'Escape') setAddingRequestToFolder(null);
                }}
                onBlur={() => {
                  setTimeout(() => {
                    if (!addRequestSubmitting.current) setAddingRequestToFolder(null);
                  }, 150);
                 }}
               />
              <button
                type="button"
                className={QUICK_FORM_CANCEL}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setAddingRequestToFolder(null)}
              >
                Cancel
              </button>
             </div>
          )}
        </div>
      );
      });
  };

  const renderRequest = (request: ApiRequest, indentation = 'pl-2') => {
    if (renamingRequestId === request.id) {
      return (
        <div key={request.id} className={`${indentation} pr-3 py-1`}>
          <input
            autoFocus
            value={renamingRequestName}
            onChange={(event) => setRenamingRequestName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commitRenameRequest(request.id, event.currentTarget.value);
              if (event.key === 'Escape') cancelRenameRequest();
            }}
            onBlur={(event) => { void commitRenameRequest(request.id, event.currentTarget.value); }}
            className="w-full border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100 outline-none focus:border-gray-400"
            placeholder="Request name"
          />
        </div>
      );
    }

    const trimMethodName = (method: string) => {
      switch (method.toUpperCase()) {
        case 'DELETE':
          return 'DEL';
        case 'CONNECT':
          return 'CONN';
        case 'OPTIONS':
          return 'OPT';
        default:
          return method.toUpperCase();
      } 
    };

    return (
      <div
        key={request.id}
        draggable
        onDragStart={(event) => {
          const dragsSelection = selectedRequestIds.has(request.id) && selectedRequestIds.size > 1;
          const ids = dragsSelection
            ? getVisibleRequestOrder().filter((id) => selectedRequestIds.has(id))
            : [request.id];
          if (!dragsSelection && selectedRequestIds.size > 0) setSelectedRequestIds(new Set());
          event.dataTransfer.setData('text/plain', request.id);
          event.dataTransfer.setData('application/x-requestloom-requests', JSON.stringify(ids));
          event.dataTransfer.effectAllowed = 'move';
          setDraggingRequestId(request.id);
          setDraggingRequestIds(ids);
        }}
        onDragEnd={clearDragState}
        onDragOver={(event) => {
          event.stopPropagation();
          if (!getDraggedRequestId(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDragOverRequestId(request.id);
          setDragOverFolderId(null);
          setDragOverServiceId(null);
        }}
        onDragLeave={(event) => {
          event.stopPropagation();
          if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragOverRequestId((current) => current === request.id ? null : current);
          }
        }}
        onDrop={(event) => handleDropOnRequest(event, request)}
        className={`group relative select-none ${indentation} transition-colors ${
          dragOverRequestId === request.id
            ? 'border-t-2 border-cyan-400/80 bg-cyan-500/10'
            : selectedRequestIds.has(request.id)
              ? 'bg-cyan-500/20 ring-1 ring-inset ring-cyan-400/40'
              : activeRequestId === request.id
              ? 'bg-gray-800/70'
              : 'hover:bg-gray-900/50'
        }`}
      >
        <button
          onClick={(event) => {
            if (handleRequestSelectionClick(event, request.id)) return;
            setServiceSettingsServiceId(null);
            setActiveScriptFile(null);
            void selectRequest(request.id);
          }}
          onContextMenu={(event) => handleContextMenu(event, 'request', request.id)}
          onDoubleClick={() => startRenameRequest(request.id)}
          title={`${request.name}${request.url ? ` — ${request.url}` : ''} (double-click to rename)`}
          className={`flex w-full items-center gap-2 py-1 pr-3 text-left text-xs active:cursor-grabbing ${
            activeRequestId === request.id ? 'text-gray-100' : 'text-gray-400'
          }`}
        >
          <span
            aria-hidden="true"
            className="w-3 cursor-grab select-none text-[13px] leading-none text-gray-600 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:text-gray-400 active:cursor-grabbing"
            title="Drag to move"
          >
            ⠿
          </span>
          <span className={`w-7 font-mono text-[10px] font-bold ${METHOD_COLORS[request.method]}`}>
            {trimMethodName(request.method)}
          </span>
          <span className="truncate">{request.name}</span>
          {isRequestDirty(request.id) && (
            <span className="ml-auto inline-block h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" title="Unsaved changes" />
          )}
        </button>
      </div>
    );
  };

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

          <div className="border-b border-gray-800/80 px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Workspace</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={toggleTopLevelRequestComposer}
                title="Create a top-level request"
                aria-pressed={addingTopLevelRequest}
                className={`flex h-9 items-center justify-center gap-2 border text-[11px] font-semibold transition-colors ${compact ? 'px-0' : 'px-2'} ${
                  addingTopLevelRequest
                    ? 'border-[#ff6c37] bg-[#ff6c37]/20 text-[#ffd2c2] ring-1 ring-inset ring-[#ff6c37]/70'
                    : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:bg-gray-800'
                }`}
              >
                <MenuIcon name="plus" />
                <span className={compact ? 'sr-only' : undefined}>New request</span>
              </button>
              <button
                type="button"
                onClick={toggleCollectionComposer}
                title="Create a collection"
                aria-pressed={addingService}
                className={`flex h-9 items-center justify-center gap-2 border text-[11px] font-medium transition-colors ${compact ? 'px-0' : 'px-2'} ${
                  addingService
                    ? 'border-[#ff6c37] bg-[#ff6c37]/20 text-[#ffd2c2] ring-1 ring-inset ring-[#ff6c37]/70'
                    : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:bg-gray-800'
                }`}
              >
                <MenuIcon name="folder-plus" />
                <span className={compact ? 'sr-only' : undefined}>New collection</span>
              </button>
            </div>
            {addingTopLevelRequest && (
              <div className={`mt-2 ${QUICK_FORM_ROW}`}>
                <input
                  autoFocus
                  className={QUICK_FORM_INPUT}
                  placeholder="Request name"
                  value={newRequestName}
                  onChange={(event) => setNewRequestName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleAddTopLevelRequest();
                    if (event.key === 'Escape') closeTopLevelRequestComposer();
                  }}
                />
                <button
                  type="button"
                  onClick={() => { void handleAddTopLevelRequest(); }}
                  className={QUICK_FORM_PRIMARY}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={closeTopLevelRequestComposer}
                  className={QUICK_FORM_CANCEL}
                >
                  Cancel
                </button>
              </div>
            )}
            {addingService && (
              <div className="mt-2 space-y-1.5">
                <div className={QUICK_FORM_ROW}>
                  <input
                    autoFocus
                    className={QUICK_FORM_INPUT}
                    placeholder="Collection name"
                    value={newServiceName}
                    onChange={(e) => setNewServiceName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddService();
                      if (e.key === 'Escape') closeCollectionComposer();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => { void handleAddService(); }}
                    className={QUICK_FORM_PRIMARY}
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={closeCollectionComposer}
                    className={QUICK_FORM_CANCEL}
                  >
                    Cancel
                  </button>
                </div>
                {settings?.storageMode === 'json' && settings.jsonStorageStrategy === 'perCollection' && (
                  <div className="flex gap-1">
                    <input
                      className="h-7 min-w-0 flex-1 border border-gray-700 bg-gray-900 px-2 text-[10px] text-gray-300 outline-none focus:border-gray-400"
                      placeholder="Collection folder (optional)"
                      value={newServicePath}
                      onChange={(e) => setNewServicePath(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => { void chooseCollectionFolder(); }}
                      className="h-7 border border-gray-700 px-1.5 text-[10px] text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                      title="Choose collection folder"
                    >
                      …
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>


          {/* Filter */}
          {!workspaceIsEmpty && (
            <div className="border-b border-gray-800/80 px-3 py-2">
              <div className="relative">
                <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  type="search"
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Escape') setFilterQuery(''); }}
                  placeholder="Filter requests"
                  aria-label="Filter requests"
                  className="h-7 w-full border border-gray-700 bg-gray-900 pl-7 pr-2 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-gray-500"
                />
              </div>
            </div>
          )}

          {requestsLoading && workspaceIsEmpty && (
            <div className="space-y-2 px-3 py-3" aria-busy="true" aria-label="Loading collections">
              {[72, 56, 64, 48, 60].map((width, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="h-3 w-7 animate-pulse bg-gray-800" />
                  <div className="h-3 animate-pulse bg-gray-800/80" style={{ width: `${width}%` }} />
                </div>
              ))}
            </div>
          )}

          {!requestsLoading && workspaceIsEmpty && (
            <div className="px-4 py-6 text-center">
              <div className="text-xs font-semibold text-gray-300">No requests yet</div>
              <p className="mt-1 text-[11px] leading-4 text-gray-500">Create one or import from Postman, SoapUI or cURL.</p>
              <div className="mt-3 grid gap-1.5">
                <button type="button" onClick={() => setNewRequestModalOpen(true)} className={QUICK_FORM_PRIMARY} title="New request (Ctrl+N)">
                  New request
                </button>
                <div className="grid grid-cols-3 gap-1.5">
                  <button type="button" onClick={() => setImportDialogKind('postman')} className={QUICK_FORM_CANCEL}>Postman</button>
                  <button type="button" onClick={() => setImportDialogKind('soapui')} className={QUICK_FORM_CANCEL}>SoapUI</button>
                  <button type="button" onClick={() => setImportDialogKind('curl')} className={QUICK_FORM_CANCEL}>cURL</button>
                </div>
              </div>
            </div>
          )}

          {filterActive && visibleServices.length === 0 && visibleTopLevelRequests.length === 0 && (
            <div className="px-4 py-6 text-center text-[11px] text-gray-500">
              No requests match “{filterQuery.trim()}”.
              <button type="button" onClick={() => setFilterQuery('')} className="ml-1 text-gray-300 underline hover:text-gray-100">
                Clear filter
              </button>
            </div>
          )}

          {/* Top-level requests */}
          {!workspaceIsEmpty && !(filterActive && visibleTopLevelRequests.length === 0) && (
          <div
            className={`border-b border-gray-800/80 px-3 py-2 ${dragOverServiceId === '__top_level__' ? 'bg-cyan-500/10 ring-1 ring-inset ring-cyan-400/70' : ''}`}
            onDragOver={(event) => {
              if (!getDraggedRequestId(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragOverServiceId('__top_level__');
              setDragOverServiceOrderId(null);
              setDragOverFolderId(null);
              setDragOverFolderOrderId(null);
              setDragOverRequestId(null);
            }}
            onDragLeave={(event) => {
              if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) {
                setDragOverServiceId((current) => current === '__top_level__' ? null : current);
              }
            }}
            onDrop={handleDropOnTopLevel}
          >
            <button
              type="button"
              className="flex w-full items-center justify-between pb-1.5 text-left"
              onClick={() => setTopLevelCollapsed((collapsed) => !collapsed)}
              aria-expanded={!topLevelCollapsed}
              title={topLevelCollapsed ? 'Expand no collection' : 'Collapse no collection'}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <svg className={`h-3 w-3 flex-shrink-0 transition-transform ${topLevelCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span>No collection</span>
              </span>
            </button>
            {(filterActive || !topLevelCollapsed) && visibleTopLevelRequests.map((request) => renderRequest(request, '-mx-3 pl-3'))}
            {!topLevelCollapsed && topLevelRequests.length === 0 && draggingRequestId !== null && (
              <div className="py-1 text-[10px] text-cyan-300/80">Drop here for top level</div>
            )}
          </div>
          )}

          {/* Favorites */}
          {!filterActive && favorites.length > 0 && (
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
          {visibleServices.map((service) => (
            <div key={service.id} className="border-b border-gray-900/70">
              <div
                draggable
                className={`group flex cursor-grab items-center px-3 py-1.5 text-xs font-semibold text-gray-200 transition-colors hover:bg-gray-900/60 active:cursor-grabbing ${
                  dragOverServiceOrderId === service.id
                    ? 'bg-cyan-500/10 ring-1 ring-inset ring-cyan-400/70'
                    : dragOverServiceId === service.id
                      ? 'bg-cyan-500/10 ring-1 ring-inset ring-cyan-400/70'
                      : draggingServiceId === service.id
                        ? 'opacity-50'
                        : ''
                }`}
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-requestloom-service', service.id);
                  event.dataTransfer.effectAllowed = 'move';
                  setDraggingServiceId(service.id);
                  setDraggingRequestId(null);
                  setDraggingFolderId(null);
                }}
                onDragEnd={clearDragState}
                onClick={() => {
                  if (draggingServiceId || renamingServiceId === service.id) return;
                  toggleCollapse(service.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, 'service', service.id)}
                onDoubleClick={() => startRenameService(service.id)}
                onDragOver={(event) => {
                  if (draggingServiceId) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDragOverServiceOrderId(service.id);
                    setDragOverServiceId(null);
                    setDragOverFolderId(null);
                    setDragOverFolderOrderId(null);
                    setDragOverRequestId(null);
                    return;
                  }
                  if (draggingFolderId) {
                    if (!service.folders.some((row) => row.id === draggingFolderId)) return;
                  } else if (!getDraggedRequestId(event)) {
                    return;
                  }
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDragOverServiceId(service.id);
                  setDragOverServiceOrderId(null);
                  setDragOverFolderId(null);
                  setDragOverRequestId(null);
                }}
                onDragLeave={(event) => {
                  if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) {
                    setDragOverServiceId((current) => current === service.id ? null : current);
                    setDragOverServiceOrderId((current) => current === service.id ? null : current);
                  }
                }}
                onDrop={(event) => {
                  if (getDraggedServiceId(event)) handleDropOnServiceOrder(event, service.id);
                  else if (getDraggedFolderId(event)) handleDropFolderOnService(event, service.id);
                  else handleDropOnService(event, service.id);
                }}
              >
                <svg
                  className={`mr-1.5 h-3 w-3 text-gray-500 transition-transform ${isServiceCollapsed(service.id) ? '' : 'rotate-90'}`}
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
                <div className="ml-1 flex items-center gap-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCollectionRunner({ serviceId: service.id });
                    }}
                    className="p-0.5 text-gray-500 hover:bg-gray-800 hover:text-emerald-400"
                    title="Run collection"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
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
                    setAddingRequestToFolder(null);
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
              </div>

              {/* Request folders and direct service requests */}
              {!isServiceCollapsed(service.id) && renderFolderLevel(service, null, 0, serviceShowsAll(service))}

              {!isServiceCollapsed(service.id) && service.requests
                .filter((request) => !request.folderId && (serviceShowsAll(service) || requestMatchesFilter(request)))
                .map((request) => renderRequest(request))}

              {/* Collection JavaScript files */}
              {!isServiceCollapsed(service.id) && scriptFiles
                .filter((file) => file.serviceId === service.id && (serviceShowsAll(service) || textMatchesFilter(file.name)))
                .map((file) => (
                  <button
                    key={file.key}
                    type="button"
                    onClick={() => handleOpenScriptFile(service.id, file)}
                    onContextMenu={(event) => handleContextMenu(event, 'script', file.key)}
                    className="flex w-full items-center gap-2 px-8 py-1 text-left text-xs text-gray-400 hover:bg-gray-900/50 hover:text-gray-200"
                  >
                    <svg className="h-3.5 w-3.5 flex-shrink-0 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <path d="M7 3h7l4 4v14H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5" />
                      <path d="M10 13l-2 2 2 2M14 13l2 2-2 2" />
                    </svg>
                    <span className="truncate">{file.name}</span>
                  </button>
                ))}

              {/* Add request inline */}
              {!isServiceCollapsed(service.id) && addingRequestToService === service.id && (
                <div className={`pl-8 pr-3 py-1 ${QUICK_FORM_ROW}`}>
                  <input
                    autoFocus
                    className={QUICK_FORM_INPUT}
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
                  <button
                    type="button"
                    className={QUICK_FORM_CANCEL}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setAddingRequestToService(null)}
                  >
                    Cancel
                  </button>
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

      {sidebarTab === 'docs' && (
        <DocumentationSidebar />
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label={contextMenu.type === 'request' ? 'Request actions' : contextMenu.type === 'folder' ? 'Folder actions' : contextMenu.type === 'script' ? 'JavaScript file actions' : 'Collection actions'}
          className="fixed z-50 max-h-[calc(100vh-1rem)] min-w-[210px] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-gray-700/80 bg-[#1b1b1b] p-1 shadow-[0_16px_36px_rgba(0,0,0,0.55)] ring-1 ring-black/40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'request' && selectedRequestIds.size > 1 && selectedRequestIds.has(contextMenu.id) && (() => {
            const ids = getVisibleRequestOrder().filter((id) => selectedRequestIds.has(id));
            const label = `${ids.length} requests`;
            const selected = ids.map((id) => allRequests.find((request) => request.id === id)).filter((request): request is ApiRequest => !!request);
            const sameCollection = selected.length > 0 && selected.every((request) => request.serviceId && request.serviceId === selected[0].serviceId);
            return (
              <>
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500">{label} selected</div>
                {selected.some((request) => request.serviceId) && (
                  <ContextMenuItem
                    icon="folder"
                    onClick={() => {
                      setContextMenu(null);
                      void (async () => {
                        try {
                          for (const request of selected) if (request.serviceId) await moveRequestToTopLevel(request.id);
                          setSelectedRequestIds(new Set());
                        } catch (error) {
                          setAlertMessage(error instanceof Error ? error.message : 'Failed to move requests');
                        }
                      })();
                    }}
                  >
                    Move to top level
                  </ContextMenuItem>
                )}
                {services.length > 0 && (
                  <ContextMenuItem icon="folder" onClick={() => { setBulkMove({ kind: 'collection', ids }); setContextMenu(null); }}>
                    Move to collection…
                  </ContextMenuItem>
                )}
                {sameCollection && (
                  <ContextMenuItem icon="folder" onClick={() => { setBulkMove({ kind: 'folder', ids }); setContextMenu(null); }}>
                    Move to Folder…
                  </ContextMenuItem>
                )}
                <div role="separator" className="my-1.5 border-t border-gray-800/80" />
                <ContextMenuItem icon="trash" danger onClick={() => {
                  setContextMenu(null);
                  setSelectedRequestIds(new Set());
                  deleteRequestsWithUndo(ids);
                }}>
                  Delete {label}
                </ContextMenuItem>
              </>
            );
          })()}
          {contextMenu.type === 'request' && !(selectedRequestIds.size > 1 && selectedRequestIds.has(contextMenu.id)) && (
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
              {allRequests.find((request) => request.id === contextMenu.id)?.serviceId ? (
                <>
                  <ContextMenuItem icon="folder" onClick={() => { void handleMoveRequestToTopLevel(contextMenu.id); }}>
                    Move to top level
                  </ContextMenuItem>
                  {services.length > 1 && (
                    <ContextMenuItem
                      icon="folder"
                      onClick={() => {
                        setMoveRequestToCollectionId(contextMenu.id);
                        setContextMenu(null);
                      }}
                    >
                      Move to collection…
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem icon="folder" onClick={() => { setMoveRequestId(contextMenu.id); setContextMenu(null); }}>
                    Move to Folder…
                  </ContextMenuItem>
                </>
              ) : services.length > 0 ? (
                <ContextMenuItem
                  icon="folder"
                  onClick={() => {
                    setMoveRequestToCollectionId(contextMenu.id);
                    setContextMenu(null);
                  }}
                >
                  Move to collection…
                </ContextMenuItem>
              ) : null}
              <ContextMenuItem
                icon="code"
                onClick={() => {
                  const request = allRequests.find((row) => row.id === contextMenu.id);
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
                  const request = allRequests.find((row) => row.id === contextMenu.id);
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
              <ContextMenuItem icon="trash" danger onClick={() => { deleteRequestsWithUndo([contextMenu.id]); setContextMenu(null); }}>
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
                  setAddingRequestToFolder(null);
                  setAddingRequestToService(contextMenu.id);
                  setNewRequestName('');
                  setContextMenu(null);
                }}
              >
                New Request
              </ContextMenuItem>
              {settings?.storageMode === 'json' && (
                <ContextMenuItem icon="folder-plus" onClick={() => { void handleCreateCollectionAsset(contextMenu.id, 'folder'); }}>
                  New File Folder
                </ContextMenuItem>
              )}
              <ContextMenuItem icon="folder-plus" onClick={() => { openCreateFolderDialog(contextMenu.id); }}>
                New Request Folder
              </ContextMenuItem>
              {settings?.storageMode === 'json' && (
                <ContextMenuItem icon="file-code" onClick={() => { void handleCreateCollectionAsset(contextMenu.id, 'js'); }}>
                  New JS File
                </ContextMenuItem>
              )}
              <div role="separator" className="my-1.5 border-t border-gray-800/80" />
              <ContextMenuItem icon="play" onClick={() => { setShowCollectionRunner({ serviceId: contextMenu.id }); setContextMenu(null); }}>
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
                  deleteServiceWithUndo(activeWorkspaceId, contextMenu.id);
                  setContextMenu(null);
                }}
              >
                Remove
              </ContextMenuItem>
            </>
          )}
          {contextMenu.type === 'folder' && (() => {
            const service = services.find((row) => row.folders.some((folder) => folder.id === contextMenu.id));
            const folder = service?.folders.find((row) => row.id === contextMenu.id);
            if (!service || !folder) return null;

            return (
              <>
                <ContextMenuItem
                  icon="plus"
                  onClick={() => {
                    setCollapsedServices((previous) => { const next = new Set(previous); next.delete(service.id); return next; });
                    setCollapsedFolders((previous) => { const next = new Set(previous); next.delete(folder.id); return next; });
                    setAddingRequestToService(null);
                    setAddingRequestToFolder({ serviceId: service.id, folderId: folder.id });
                    setNewRequestName('');
                    setContextMenu(null);
                  }}
                >
                  New Request
                </ContextMenuItem>
                <ContextMenuItem icon="folder-plus" onClick={() => { openCreateFolderDialog(service.id, folder.id); }}>
                  New Subfolder
                </ContextMenuItem>
                <ContextMenuItem icon="play" onClick={() => { setShowCollectionRunner({ serviceId: service.id, folderId: folder.id }); setContextMenu(null); }}>
                  Run Folder
                </ContextMenuItem>
                <ContextMenuItem icon="rename" onClick={() => { startRenameFolder(folder.id, folder.name); }}>
                  Rename
                </ContextMenuItem>
                <div role="separator" className="my-1.5 border-t border-gray-800/80" />
                <ContextMenuItem
                  icon="trash"
                  danger
                  onClick={() => {
                    setContextMenu(null);
                    setFolderToDelete({ serviceId: service.id, id: folder.id, name: folder.name });
                  }}
                >
                  Delete Folder
                </ContextMenuItem>
              </>
            );
          })()}
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

      {folderDialog && (
        <TextInputModal
          title={folderDialog.mode === 'create' ? (folderDialog.parentFolderId ? 'Create request subfolder' : 'Create request folder') : 'Rename request folder'}
          label="Folder name"
          placeholder="e.g. Users"
          initialValue={folderDialog.initialValue}
          confirmLabel={folderDialog.mode === 'create' ? 'Create' : 'Save'}
          onConfirm={handleFolderDialogSubmit}
          onClose={() => setFolderDialog(null)}
        />
      )}

      {collectionPathDialogOpen && (
        <TextInputModal
          title="Collection folder"
          label="Folder path"
          placeholder="e.g. D:\collections\orders"
          initialValue={newServicePath}
          confirmLabel="Use folder"
          onConfirm={(value) => { setNewServicePath(value); setCollectionPathDialogOpen(false); }}
          onClose={() => setCollectionPathDialogOpen(false)}
        />
      )}

      {folderToDelete && (() => {
        const service = services.find((item) => item.id === folderToDelete.serviceId);
        const folder = service?.folders.find((item) => item.id === folderToDelete.id);
        if (!service || !folder) return null;

        return (
          <DeleteRequestFolderModal
            folder={folder}
            folders={service.folders}
            requestFolderIds={service.requests.map((request) => request.folderId ?? null)}
            onConfirm={(contents, targetFolderId) => handleDeleteFolder(contents, targetFolderId)}
            onClose={() => setFolderToDelete(null)}
          />
        );
      })()}

      {moveRequestId && (() => {
        const request = allRequests.find((item) => item.id === moveRequestId);
        const service = services.find((item) => item.requests.some((itemRequest) => itemRequest.id === moveRequestId));
        if (!request || !service) return null;

        return (
          <MoveRequestFolderModal
            requestName={request.name}
            folders={service.folders}
            currentFolderId={request.folderId}
            onConfirm={async (folderId) => {
              try {
                await moveRequestToFolder(request.id, folderId);
                setMoveRequestId(null);
              } catch (error) {
                setAlertMessage(error instanceof Error ? error.message : 'Failed to move request');
              }
            }}
            onClose={() => setMoveRequestId(null)}
          />
        );
      })()}

      {bulkMove?.kind === 'folder' && (() => {
        const requests = bulkMove.ids.map((id) => allRequests.find((item) => item.id === id)).filter((item): item is ApiRequest => !!item);
        const service = services.find((item) => item.id === requests[0]?.serviceId);
        if (!service) return null;
        const sameFolder = requests.every((request) => request.folderId === requests[0].folderId);

        return (
          <MoveRequestFolderModal
            requestName={`${requests.length} requests`}
            folders={service.folders}
            currentFolderId={sameFolder ? requests[0].folderId : null}
            onConfirm={async (folderId) => {
              try {
                for (const request of requests) await moveRequestToFolder(request.id, folderId);
                setBulkMove(null);
              } catch (error) {
                setAlertMessage(error instanceof Error ? error.message : 'Failed to move requests');
              }
            }}
            onClose={() => setBulkMove(null)}
          />
        );
      })()}

      {bulkMove?.kind === 'collection' && (() => {
        const requests = bulkMove.ids.map((id) => allRequests.find((item) => item.id === id)).filter((item): item is ApiRequest => !!item);
        if (requests.length === 0) return null;

        return (
          <MoveRequestCollectionModal
            requestName={`${requests.length} requests`}
            collections={services.map((service) => ({ id: service.id, name: service.name }))}
            currentCollectionId={null}
            onConfirm={async (serviceId) => {
              try {
                for (const request of requests) {
                  if (request.serviceId !== serviceId) await moveRequestToService(request.id, serviceId);
                }
                setBulkMove(null);
              } catch (error) {
                setAlertMessage(error instanceof Error ? error.message : 'Failed to move requests to collection');
              }
            }}
            onClose={() => setBulkMove(null)}
          />
        );
      })()}

      {moveRequestToCollectionId && (() => {
        const request = allRequests.find((item) => item.id === moveRequestToCollectionId);
        if (!request || services.length === 0) return null;

        return (
          <MoveRequestCollectionModal
            requestName={request.name}
            collections={services.filter((service) => service.id !== request.serviceId).map((service) => ({ id: service.id, name: service.name }))}
            currentCollectionId={null}
            onConfirm={async (serviceId) => {
              try {
                await moveRequestToService(request.id, serviceId);
                setMoveRequestToCollectionId(null);
              } catch (error) {
                setAlertMessage(error instanceof Error ? error.message : 'Failed to move request to collection');
              }
            }}
            onClose={() => setMoveRequestToCollectionId(null)}
          />
        );
      })()}

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
          serviceId={showCollectionRunner.serviceId}
          folderId={showCollectionRunner.folderId}
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
