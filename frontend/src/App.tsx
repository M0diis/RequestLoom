import { useEffect, useRef, useCallback, useState } from 'react';
import { MainLayout } from './layouts/MainLayout';
import { Sidebar } from './components/sidebar/Sidebar';
import { RequestBuilder } from './components/request-builder/RequestBuilder';
import { ResponseViewer } from './components/response-viewer/ResponseViewer';
import { VariableManagerPage } from './components/variables/VariableManagerPage';
import { ServiceSettingsPage } from './components/variables/ServiceSettingsPage';
import { MockEndpointDetail } from './components/mockserver/MockEndpointDetail';
import { RequestTabBar } from './components/common/RequestTabBar';
import { useWorkspaceStore } from './stores/workspaceStore';
import { useEnvironmentStore } from './stores/environmentStore';
import { useRequestStore } from './stores/requestStore';
import { useMockServerStore } from './stores/mockServerStore';
import { useUiStore } from './stores/uiStore';
import { useSettingsStore } from './stores/settingsStore';
import { useScriptFileStore } from './stores/scriptFileStore';
import { DevToolsPanel } from './components/common/DevToolsPanel';
import { JavaScriptFileEditor } from './components/script-files/JavaScriptFileEditor';
import { DocumentationPage } from './components/documentation/DocumentationPage';
import { NewRequestModal } from './components/common/NewRequestModal';
import { ImportModal } from './components/common/ImportModal';
import { CommandPalette } from './components/common/CommandPalette';
import { ConfirmHost } from './components/common/ConfirmModal';
import { Toaster } from './components/common/Toaster';
import { flushReloadToast } from './stores/toastStore';
import { flushPendingDeletesOnUnload, hasPendingDeletes } from './lib/undoableDelete';
import { closeActiveTab, cycleTabs, focusUrlBar, saveActiveTab, sendActiveTab } from './lib/appActions';
import type { ApiRequest, HttpMethod } from './types';

function App() {
  const { activeWorkspaceId, load: loadWorkspaces } = useWorkspaceStore();
  const { load: loadEnvironments, error: environmentError } = useEnvironmentStore();
  const {
    loadServices,
    services,
    activeRequestId,
    createRequest,
    createService,
    createTopLevelRequest,
    selectRequest,
    workspaceId: loadedWorkspaceId,
    loading: requestsLoading,
    error: requestError,
  } = useRequestStore();
  const { load: loadScriptFiles, activeFileKey, error: scriptError } = useScriptFileStore();
  const { load: loadMockServers, error: mockServerError } = useMockServerStore();
  const { load: loadSettings } = useSettingsStore();
  const [startupError, setStartupError] = useState<string | null>(null);
  const {
    sidebarTab,
    docsSection,
    serviceSettingsServiceId,
    responseLayout,
    requestPanelSize,
    setRequestPanelSize,
    setSidebarTab,
    setDocsSection,
    responseViewMode,
    responseViewModeByRequest,
    setRequestResponseViewMode,
    setResponseLayout,
    newRequestModalOpen,
    setNewRequestModalOpen,
    importDialogKind,
    setImportDialogKind,
    commandPaletteOpen,
    setCommandPaletteOpen,
  } = useUiStore();

  const panelContainerRef = useRef<HTMLDivElement>(null);
  const isResizingPanel = useRef(false);
  const serviceSignature = JSON.stringify(
    services.map((service) => ({ id: service.id, name: service.name, storagePath: service.storagePath })),
  );

  // Load data on startup and workspace change
  useEffect(() => {
    void Promise.all([loadWorkspaces(), loadSettings()])
      .catch(error => setStartupError(error instanceof Error ? error.message : 'Could not load application data.'));
  }, [loadWorkspaces, loadSettings]);

  useEffect(() => {
    loadEnvironments(activeWorkspaceId);
    loadServices(activeWorkspaceId);
    loadMockServers(activeWorkspaceId);
  }, [activeWorkspaceId, loadEnvironments, loadServices, loadMockServers]);

  useEffect(() => {
    if (loadedWorkspaceId !== activeWorkspaceId || requestsLoading) return;
    const serviceIds = (JSON.parse(serviceSignature) as { id: string }[]).map((service) => service.id);
    void loadScriptFiles(activeWorkspaceId, serviceIds);
  }, [activeWorkspaceId, loadScriptFiles, serviceSignature, loadedWorkspaceId, requestsLoading]);

  useEffect(() => {
    flushReloadToast();
  }, []);

  useEffect(() => {
    // Deletes waiting on an Undo toast are committed with keepalive requests.
    const commitPendingDeletes = () => { if (hasPendingDeletes()) flushPendingDeletesOnUnload(); };
    window.addEventListener('pagehide', commitPendingDeletes);
    return () => window.removeEventListener('pagehide', commitPendingDeletes);
  }, []);

  useEffect(() => {
    const protectDrafts = (event: BeforeUnloadEvent) => {
      if (useRequestStore.getState().dirtyRequests.size > 0 ||
          useScriptFileStore.getState().tabs.some(tab => tab.code !== tab.savedCode)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protectDrafts);
    return () => window.removeEventListener('beforeunload', protectDrafts);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.altKey && !e.shiftKey) {
        const key = e.key.toLowerCase();
        switch (key) {
          case '1':
            setSidebarTab('services');
            e.preventDefault();
            return;
          case '2':
            setSidebarTab('variables');
            e.preventDefault();
            return;
          case '3':
            setSidebarTab('mockservers');
            e.preventDefault();
            return;
          case '4':
            setSidebarTab('docs');
            e.preventDefault();
            return;
          case 'l':
            setResponseLayout(responseLayout === 'right' ? 'bottom' : 'right');
            e.preventDefault();
            return;
          case 'p': {
            if (!activeRequestId) return;
            const current = responseViewModeByRequest[activeRequestId] ?? responseViewMode;
            setRequestResponseViewMode(activeRequestId, current === 'raw' ? 'pretty' : 'raw');
            e.preventDefault();
            return;
          }
        }
      }

      if (mod && !e.altKey && e.key === 'Tab') {
        cycleTabs(e.shiftKey ? -1 : 1);
        e.preventDefault();
        return;
      }

      if (mod && !e.altKey && !e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === 'k') {
          setCommandPaletteOpen(!useUiStore.getState().commandPaletteOpen);
          e.preventDefault();
          return;
        }
        if (key === 's') {
          void saveActiveTab();
          e.preventDefault();
          return;
        }
        if (key === 'n') {
          setNewRequestModalOpen(true);
          e.preventDefault();
          return;
        }
        if (key === 'w' && sidebarTab === 'services') {
          closeActiveTab();
          e.preventDefault();
          return;
        }
        if (key === 'l') {
          focusUrlBar();
          e.preventDefault();
          return;
        }
      }

      if (sidebarTab !== 'services' || serviceSettingsServiceId) return;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        sendActiveTab();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activeRequestId,
    setNewRequestModalOpen,
    setCommandPaletteOpen,
    serviceSettingsServiceId,
    sidebarTab,
    responseLayout,
    responseViewMode,
    responseViewModeByRequest,
    setSidebarTab,
    setResponseLayout,
    setRequestResponseViewMode,
  ]);

  const startPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingPanel.current = true;
    const container = panelContainerRef.current;
    if (!container) return;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingPanel.current || !container) return;
      const rect = container.getBoundingClientRect();
      const ratio = responseLayout === 'right'
        ? ((ev.clientX - rect.left) / rect.width) * 100
        : ((ev.clientY - rect.top) / rect.height) * 100;
      setRequestPanelSize(Math.max(20, Math.min(80, ratio)));
    };

    const onMouseUp = () => {
      isResizingPanel.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = responseLayout === 'right' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [responseLayout, setRequestPanelSize]);

  const isHorizontal = responseLayout === 'right';
  const showServiceSettings = Boolean(serviceSettingsServiceId);
  const showVariables = !showServiceSettings && sidebarTab === 'variables';
  const showMockDetail = !showServiceSettings && sidebarTab === 'mockservers';
  const showDocumentation = !showServiceSettings && sidebarTab === 'docs';
  const showScriptWorkspace = !showServiceSettings && sidebarTab === 'services' && Boolean(activeFileKey);
  const showRequestWorkspace = !showServiceSettings && sidebarTab !== 'variables' && sidebarTab !== 'mockservers' && sidebarTab !== 'docs' && !showScriptWorkspace;
  // The request tab bar only belongs to the Services view.
  const showRequestTabs = !showServiceSettings && sidebarTab === 'services';

  const handleNewRequestCreate = async (draft: {
    name: string;
    method: HttpMethod;
    url: string;
    collectionId: string | null;
    newCollectionName: string;
  }) => {
    let created: ApiRequest;
    if (draft.newCollectionName) {
      const collection = await createService(activeWorkspaceId, draft.newCollectionName);
      created = await createRequest(collection.id, draft.name, draft.method, null, draft.url);
    } else if (draft.collectionId) {
      created = await createRequest(draft.collectionId, draft.name, draft.method, null, draft.url);
    } else {
      created = await createTopLevelRequest(activeWorkspaceId, draft.name, draft.method, draft.url);
    }
    await selectRequest(created.id);
    setNewRequestModalOpen(false);
  };

  return (
    <>
      <MainLayout
        sidebar={<Sidebar />}
        main={(
        <>
          {startupError || requestError || environmentError || mockServerError || scriptError ? (
            <div role="alert" className="flex items-center gap-3 border-b border-rose-900 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
              <span className="flex-1">{startupError || requestError || environmentError || mockServerError || scriptError}</span>
              <button type="button" onClick={() => {
                setStartupError(null);
                void Promise.all([loadWorkspaces(), loadSettings(), loadServices(activeWorkspaceId),
                  loadEnvironments(activeWorkspaceId), loadMockServers(activeWorkspaceId)])
                  .catch(error => setStartupError(error instanceof Error ? error.message : 'Could not reload application data.'));
              }} className="underline">Retry loading</button>
            </div>
          ) : null}
          {showRequestTabs ? <RequestTabBar /> : null}
          <div
            ref={panelContainerRef}
            className={`${showRequestWorkspace ? 'flex' : 'hidden'} flex-1 overflow-hidden ${isHorizontal ? 'flex-row' : 'flex-col'}`}
          >
            <div
              className="overflow-hidden flex flex-col"
              style={isHorizontal ? { width: `${requestPanelSize}%` } : { height: `${requestPanelSize}%` }}
            >
              <RequestBuilder />
            </div>
            <div
              className={isHorizontal ? 'panel-divider panel-divider-v' : 'panel-divider panel-divider-h'}
              onMouseDown={startPanelResize}
            />
            <div className="flex-1 overflow-hidden flex flex-col">
              <ResponseViewer />
            </div>
          </div>

          <div className={`${showScriptWorkspace ? 'flex' : 'hidden'} flex-1 overflow-hidden flex-col`}>
            <JavaScriptFileEditor />
          </div>

          <div className={`${showVariables ? 'flex' : 'hidden'} flex-1 overflow-hidden flex-col`}>
            <VariableManagerPage />
          </div>

          <div className={`${showServiceSettings ? 'flex' : 'hidden'} flex-1 overflow-hidden flex-col`}>
            {serviceSettingsServiceId ? <ServiceSettingsPage serviceId={serviceSettingsServiceId} /> : null}
          </div>

          <div className={`${showMockDetail ? 'flex' : 'hidden'} flex-1 overflow-hidden flex-col`}>
            <MockEndpointDetail />
          </div>
          <div className={`${showDocumentation ? 'flex' : 'hidden'} flex-1 overflow-hidden flex-col`}>
            <DocumentationPage section={docsSection} onSectionChange={setDocsSection} />
          </div>
          <DevToolsPanel />
        </>
        )}
      />
      {newRequestModalOpen && (
        <NewRequestModal
          onClose={() => setNewRequestModalOpen(false)}
          collections={services.map((service) => ({ id: service.id, name: service.name }))}
          onCreate={handleNewRequestCreate}
        />
      )}
      {importDialogKind && (
        <ImportModal
          workspaceId={activeWorkspaceId}
          initialKind={importDialogKind}
          onClose={() => setImportDialogKind(null)}
        />
      )}
      {commandPaletteOpen && <CommandPalette />}
      <ConfirmHost />
      <Toaster />
    </>
  );
}

export default App;
