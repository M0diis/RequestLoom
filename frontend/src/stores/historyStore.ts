import { create } from 'zustand';
import type { HistoryEntry } from '../types';
import { historyApi } from '../services/api';

let loadVersion = 0;

interface HistoryState {
  workspaceId: string | null;
  entries: HistoryEntry[];
  loading: boolean;
  error: string | null;
  load: (workspaceId: string) => Promise<void>;
  getById: (workspaceId: string, id: string) => Promise<HistoryEntry>;
  remove: (workspaceId: string, id: string) => Promise<void>;
  clearAll: (workspaceId: string) => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  workspaceId: null,
  entries: [],
  loading: false,
  error: null,

  load: async (workspaceId) => {
    const version = ++loadVersion;
    if (get().workspaceId !== workspaceId) set({ workspaceId, entries: [] });
    set({ loading: true, error: null });
    try {
      const values = await historyApi.getAll(workspaceId);
      if (version === loadVersion) set({ entries: values, loading: false });
    } catch (error) {
      if (version === loadVersion) set({ loading: false,
        error: error instanceof Error ? error.message : 'Could not load workspace data. Retry loading it.' });
    }
  },
  getById: async (workspaceId, id) => {
    return historyApi.getById(workspaceId, id);
  },

  remove: async (workspaceId, id) => {
    await historyApi.delete(workspaceId, id);
    if (get().workspaceId !== workspaceId) return;
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id), error: null }));
  },

  clearAll: async (workspaceId) => {
    await historyApi.clearAll(workspaceId);
    if (get().workspaceId !== workspaceId) return;
    set({ entries: [], error: null });
  },
}));
