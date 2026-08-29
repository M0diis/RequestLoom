import { create } from 'zustand';
import { settingsApi } from '../services/api';
import { useUiStore } from './uiStore';
import type { AppSettings, SettingsUpdate } from '../types';

interface SettingsState {
  settings: AppSettings | null;
  loading: boolean;
  load: () => Promise<void>;
  update: (patch: SettingsUpdate) => Promise<AppSettings>;
  migrateStorage: (patch: SettingsUpdate) => Promise<AppSettings>;
  clearHistory: () => Promise<number>;
  generateExamples: () => Promise<{ workspaceId: string; name: string; message: string }>;
  clearAllData: () => Promise<number>;
}
  
const toViewMode = (format: string) => (format === 'raw' ? 'raw' : 'pretty');

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const settings = await settingsApi.get();
      set({ settings });
      useUiStore.getState().setResponseViewMode(toViewMode(settings.responseFormat));
    } finally {
      set({ loading: false });
    }
  },

  update: async (patch) => {
    const settings = await settingsApi.update(patch);
    set({ settings });
    if (patch.responseFormat) {
      useUiStore.getState().setResponseViewMode(toViewMode(patch.responseFormat));
    }
    return settings;
  },

  migrateStorage: async (patch) => {
    const settings = await settingsApi.migrate(patch);
    set({ settings });
    if (patch.responseFormat) {
      useUiStore.getState().setResponseViewMode(toViewMode(patch.responseFormat));
    }
    return settings;
  },

  clearHistory: async () => {
    const { deleted } = await settingsApi.clearHistory();
    return deleted;
  },

  generateExamples: async () => {
    const result = await settingsApi.generateExamples();
    return result;
  },

  clearAllData: async () => {
    const { deleted } = await settingsApi.clearAllData();
    return deleted;
  },
}));
