import { create } from 'zustand';
import { serviceFilesApi } from '../services/api';
import type { JavaScriptRunResponse, ServiceFileResponse } from '../types';

export interface ScriptFileEntry extends ServiceFileResponse {
  serviceId: string;
  key: string;
}

export interface ScriptFileTab extends ScriptFileEntry {
  code: string;
  savedCode: string;
  saving: boolean;
  running: boolean;
  runResponse: JavaScriptRunResponse | null;
  error: string | null;
}

let loadVersion = 0;

interface ScriptFileState {
  workspaceId: string | null;
  error: string | null;
  files: ScriptFileEntry[];
  tabs: ScriptFileTab[];
  openFileKeys: string[];
  activeFileKey: string | null;
  loading: boolean;
  load: (workspaceId: string, serviceIds: string[]) => Promise<void>;
  addFile: (serviceId: string, file: ServiceFileResponse) => void;
  openFile: (serviceId: string, file: ServiceFileResponse) => void;
  closeFile: (key: string) => void;
  removeFile: (key: string) => void;
  setActiveFile: (key: string | null) => void;
  updateCode: (key: string, code: string) => void;
  save: (workspaceId: string, key: string) => Promise<void>;
  run: (workspaceId: string, key: string) => Promise<void>;
}

function makeKey(serviceId: string, fileName: string): string {
  return `${serviceId}:${fileName}`;
}

function toEntry(serviceId: string, file: ServiceFileResponse): ScriptFileEntry {
  return { ...file, serviceId, key: makeKey(serviceId, file.name) };
}

function toTab(entry: ScriptFileEntry): ScriptFileTab {
  return {
    ...entry,
    code: entry.content,
    savedCode: entry.content,
    saving: false,
    running: false,
    runResponse: null,
    error: null,
  };
}

export const useScriptFileStore = create<ScriptFileState>((set, get) => ({
  workspaceId: null,
  error: null,
  files: [],
  tabs: [],
  openFileKeys: [],
  activeFileKey: null,
  loading: false,

  load: async (workspaceId, serviceIds) => {
    const version = ++loadVersion;
    if (get().workspaceId !== workspaceId) set({ workspaceId, files: [], openFileKeys: [], activeFileKey: null });
    set({ loading: true, error: null });
    try {
      const responses = await Promise.all(serviceIds.map(async serviceId => {
        try { return await serviceFilesApi.list(workspaceId, serviceId); }
        catch (error) {
          // Collection files are intentionally unavailable in SQLite mode.
          if ((error as { response?: { status: number } }).response?.status === 400) return [];
          throw error;
        }
      }));
      if (version !== loadVersion) return;
      const files = responses.flatMap((serviceFiles, index) => serviceFiles.map(file => toEntry(serviceIds[index], file)));
      set(state => {
        const fileMap = new Map(files.map(file => [file.key, file]));
        const tabs = state.tabs.filter(tab => fileMap.has(tab.key) || tab.code !== tab.savedCode)
          .map(tab => ({ ...tab, ...fileMap.get(tab.key) } as ScriptFileTab));
        const openFileKeys = state.openFileKeys.filter(key => fileMap.has(key));
        const activeFileKey = state.activeFileKey && openFileKeys.includes(state.activeFileKey)
          ? state.activeFileKey : openFileKeys[openFileKeys.length - 1] ?? null;
        return { files, tabs, openFileKeys, activeFileKey, loading: false };
      });
    } catch (error) {
      if (version === loadVersion) set({ loading: false,
        error: error instanceof Error ? error.message : 'Could not load collection files. Your drafts are retained.' });
    }
  },

  addFile: (serviceId, file) => {
    const entry = toEntry(serviceId, file);
    set((state) => {
      const existing = state.tabs.find((tab) => tab.key === entry.key);
      const tabs = existing
        ? state.tabs.map((tab) => tab.key === entry.key ? { ...tab, ...entry } : tab)
        : [...state.tabs, toTab(entry)];
      const files = state.files.some((item) => item.key === entry.key)
        ? state.files.map((item) => item.key === entry.key ? entry : item)
        : [...state.files, entry];
      const openFileKeys = state.openFileKeys.includes(entry.key)
        ? state.openFileKeys
        : [...state.openFileKeys, entry.key];
      return { files, tabs, openFileKeys, activeFileKey: entry.key };
    });
  },

  openFile: (serviceId, file) => {
    const entry = toEntry(serviceId, file);
    set((state) => {
      const existing = state.tabs.find((tab) => tab.key === entry.key);
      const tabs = existing
        ? state.tabs.map((tab) => tab.key === entry.key ? { ...tab, ...entry } : tab)
        : [...state.tabs, toTab(entry)];
      const openFileKeys = state.openFileKeys.includes(entry.key)
        ? state.openFileKeys
        : [...state.openFileKeys, entry.key];
      return { tabs, openFileKeys, activeFileKey: entry.key };
    });
  },

  closeFile: (key) => {
    set((state) => {
      const index = state.openFileKeys.indexOf(key);
      const openFileKeys = state.openFileKeys.filter((item) => item !== key);
      if (state.activeFileKey !== key) {
        return { tabs: state.tabs.filter((tab) => tab.key !== key || tab.code !== tab.savedCode), openFileKeys };
      }

      const replacement = openFileKeys[index - 1] ?? openFileKeys[index] ?? null;
      return {
        tabs: state.tabs.filter((tab) => tab.key !== key || tab.code !== tab.savedCode),
        openFileKeys,
        activeFileKey: replacement,
      };
    });
  },

  removeFile: (key) => {
    set((state) => {
      const index = state.openFileKeys.indexOf(key);
      const openFileKeys = state.openFileKeys.filter((item) => item !== key);
      const activeFileKey = state.activeFileKey === key
        ? (openFileKeys[index - 1] ?? openFileKeys[index] ?? null)
        : state.activeFileKey;
      return {
        files: state.files.filter((file) => file.key !== key),
        tabs: state.tabs.filter((tab) => tab.key !== key),
        openFileKeys,
        activeFileKey,
      };
    });
  },

  setActiveFile: (key) => set({ activeFileKey: key }),

  updateCode: (key, code) => set((state) => ({
    tabs: state.tabs.map((tab) => tab.key === key
      ? { ...tab, code, error: null, runResponse: null }
      : tab),
  })),

  save: async (workspaceId, key) => {
    const tab = get().tabs.find((item) => item.key === key);
    if (!tab || tab.saving || tab.running) return;

    set((state) => ({
      tabs: state.tabs.map((item) => item.key === key ? { ...item, saving: true, error: null } : item),
    }));
    try {
      await serviceFilesApi.save(workspaceId, tab.serviceId, tab.name, tab.code);
      set((state) => ({
        tabs: state.tabs.map((item) => item.key === key
          ? { ...item, savedCode: tab.code, content: tab.code, saving: false }
          : item),
        files: state.files.map((item) => item.key === key ? { ...item, content: tab.code } : item),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save JavaScript file';
      set((state) => ({
        tabs: state.tabs.map((item) => item.key === key ? { ...item, saving: false, error: message } : item),
      }));
      throw error;
    }
  },

  run: async (workspaceId, key) => {
    const tab = get().tabs.find((item) => item.key === key);
    if (!tab || tab.saving || tab.running) return;

    set((state) => ({
      tabs: state.tabs.map((item) => item.key === key
        ? { ...item, running: true, error: null, runResponse: null }
        : item),
    }));
    try {
      const runResponse = await serviceFilesApi.run(workspaceId, tab.serviceId, tab.name, tab.code);
      set((state) => ({
        tabs: state.tabs.map((item) => item.key === key
          ? { ...item, savedCode: tab.code, content: tab.code, running: false, runResponse }
          : item),
        files: state.files.map((item) => item.key === key ? { ...item, content: tab.code } : item),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not run JavaScript file';
      set((state) => ({
        tabs: state.tabs.map((item) => item.key === key ? { ...item, running: false, error: message } : item),
      }));
      throw error;
    }
  },
}));
