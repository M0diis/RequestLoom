import { create } from 'zustand';
import type { ImportKind } from '../components/common/ImportModal';

export type DevToolTab = 'console' | 'network' | 'performance' | 'terminal';
export type ResponseViewMode = 'pretty' | 'raw' | 'tree' | 'preview';
export type DocumentationSection = 'overview' | 'http' | 'requestloom' | 'automation' | 'mock-servers' | 'scripting' | 'storage' | 'imports';

interface UiState {
  darkMode: boolean;
  sidebarWidth: number;
  sidebarTab: 'services' | 'history' | 'variables' | 'mockservers' | 'docs';
  docsSection: DocumentationSection;
  serviceSettingsServiceId: string | null;
  variableServiceFilterId: string;
  variableSearchQuery: string;
  activeRequestTab: 'params' | 'headers' | 'variables' | 'body' | 'auth' | 'pre-script' | 'post-script' | 'tests' | 'runs' | 'settings' | 'cookies' | 'file' | 'notes';
  activeResponseTab: 'body' | 'headers' | 'info' | 'scripts' | 'tests';
  /** Default body view for tabs that have not picked one yet. */
  responseViewMode: 'pretty' | 'raw';
  /** Body view chosen per request tab. */
  responseViewModeByRequest: Record<string, ResponseViewMode>;
  newRequestModalOpen: boolean;
  importDialogKind: ImportKind | null;
  exportImportModalOpen: boolean;
  settingsModalOpen: boolean;
  commandPaletteOpen: boolean;
  responseLayout: 'right' | 'bottom';
  requestPanelSize: number;
  terminalOpen: boolean;
  terminalCwd: string;
  devToolsOpen: boolean;
  activeDevToolTab: DevToolTab;
  toggleDarkMode: () => void;
  setSidebarWidth: (width: number) => void;
  setSidebarTab: (tab: 'services' | 'history' | 'variables' | 'mockservers' | 'docs') => void;
  setDocsSection: (section: DocumentationSection) => void;
  setServiceSettingsServiceId: (serviceId: string | null) => void;
  setVariableServiceFilterId: (serviceId: string) => void;
  setVariableSearchQuery: (query: string) => void;
  setActiveRequestTab: (tab: 'params' | 'headers' | 'variables' | 'body' | 'auth' | 'pre-script' | 'post-script' | 'tests' | 'runs' | 'settings' | 'cookies' | 'file' | 'notes') => void;
  setActiveResponseTab: (tab: 'body' | 'headers' | 'info' | 'scripts' | 'tests') => void;
  setResponseViewMode: (mode: 'pretty' | 'raw') => void;
  setRequestResponseViewMode: (requestId: string, mode: ResponseViewMode) => void;
  setNewRequestModalOpen: (open: boolean) => void;
  setImportDialogKind: (kind: ImportKind | null) => void;
  setExportImportModalOpen: (open: boolean) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setResponseLayout: (layout: 'right' | 'bottom') => void;
  setRequestPanelSize: (size: number) => void;
  setTerminalOpen: (open: boolean) => void;
  setTerminalCwd: (cwd: string) => void;
  setDevToolsOpen: (open: boolean) => void;
  setActiveDevToolTab: (tab: DevToolTab) => void;
}

const getInitialDarkMode = () => {
  const stored = localStorage.getItem('darkMode');
  if (stored !== null) return stored === 'true';
  return true;
};

export const useUiStore = create<UiState>((set) => ({
  darkMode: getInitialDarkMode(),
  sidebarWidth: 280,
  sidebarTab: 'services',
  docsSection: 'overview',
  serviceSettingsServiceId: null,
  variableServiceFilterId: '',
  variableSearchQuery: '',
  activeRequestTab: 'params',
  activeResponseTab: 'body',
  responseViewMode: 'pretty',
  responseViewModeByRequest: {},
  newRequestModalOpen: false,
  importDialogKind: null,
  exportImportModalOpen: false,
  settingsModalOpen: false,
  commandPaletteOpen: false,
  responseLayout: 'bottom',
  requestPanelSize: 50,
  terminalOpen: false,
  terminalCwd: '',
  devToolsOpen: false,
  activeDevToolTab: 'terminal',

  toggleDarkMode: () => set((state) => {
    const next = !state.darkMode;
    localStorage.setItem('darkMode', String(next));
    return { darkMode: next };
  }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setDocsSection: (section) => set({ docsSection: section }),
  setServiceSettingsServiceId: (serviceId) => set({ serviceSettingsServiceId: serviceId }),
  setVariableServiceFilterId: (serviceId) => set({ variableServiceFilterId: serviceId }),
  setVariableSearchQuery: (query) => set({ variableSearchQuery: query }),
  setActiveRequestTab: (tab) => set({ activeRequestTab: tab }),
  setActiveResponseTab: (tab) => set({ activeResponseTab: tab }),
  setResponseViewMode: (mode) => set({ responseViewMode: mode }),
  setRequestResponseViewMode: (requestId, mode) => set((state) => ({
    responseViewModeByRequest: { ...state.responseViewModeByRequest, [requestId]: mode },
  })),
  setNewRequestModalOpen: (open) => set({ newRequestModalOpen: open }),
  setImportDialogKind: (kind) => set({ importDialogKind: kind }),
  setExportImportModalOpen: (open) => set({ exportImportModalOpen: open }),
  setSettingsModalOpen: (open) => set({ settingsModalOpen: open }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setResponseLayout: (layout) => set({ responseLayout: layout }),
  setRequestPanelSize: (size) => set({ requestPanelSize: size }),
  setTerminalOpen: (open) => set({ terminalOpen: open, devToolsOpen: open }),
  setTerminalCwd: (cwd) => set({ terminalCwd: cwd, terminalOpen: true, devToolsOpen: true, activeDevToolTab: 'terminal' }),
  setDevToolsOpen: (open) => set({ devToolsOpen: open, terminalOpen: open }),
  setActiveDevToolTab: (tab) => set({ activeDevToolTab: tab }),
}));
