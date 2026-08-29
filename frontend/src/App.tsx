import { useEffect, useRef, useCallback } from 'react';
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

function App() {
  const { activeWorkspaceId, load: loadWorkspaces } = useWorkspaceStore();
  const { load: loadEnvironments } = useEnvironmentStore();
  const { loadServices, sendRequest, services } = useRequestStore();
  const { load: loadScriptFiles, activeFileKey } = useScriptFileStore();
  const { load: loadMockServers } = useMockServerStore();
  const { load: loadSettings } = useSettingsStore();
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
    setResponseViewMode,
    setResponseLayout,
  } = useUiStore();

  const panelContainerRef = useRef<HTMLDivElement>(null);
  const isResizingPanel = useRef(false);
  const serviceSignature = JSON.stringify(
    services.map((service) => ({ id: service.id, name: service.name, storagePath: service.storagePath })),
  );

  // Load data on startup and workspace change
  useEffect(() => {
    loadWorkspaces();
    loadSettings();
  }, [loadWorkspaces, loadSettings]);

  useEffect(() => {
    loadEnvironments(activeWorkspaceId);
    loadServices(activeWorkspaceId);
    loadMockServers(activeWorkspaceId);
  }, [activeWorkspaceId, loadEnvironments, loadServices, loadMockServers]);

  useEffect(() => {
    const serviceIds = (JSON.parse(serviceSignature) as { id: string }[]).map((service) => service.id);
    void loadScriptFiles(activeWorkspaceId, serviceIds);
  }, [activeWorkspaceId, loadScriptFiles, serviceSignature]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
          case 'p':
            setResponseViewMode(responseViewMode === 'pretty' ? 'raw' : 'pretty');
            e.preventDefault();
            return;
        }
      }

      if (sidebarTab !== 'services' || serviceSettingsServiceId) return;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        sendRequest(activeWorkspaceId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activeWorkspaceId,
    sendRequest,
    serviceSettingsServiceId,
    sidebarTab,
    responseLayout,
    responseViewMode,
    setSidebarTab,
    setDocsSection,
    setResponseLayout,
    setResponseViewMode,
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

  return (
    <MainLayout
      sidebar={<Sidebar />}
      main={(
        <>
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
  );
}

export default App;
