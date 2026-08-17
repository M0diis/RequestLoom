import { create } from 'zustand';
import type { HistoryEntry } from '../types';
import { historyApi } from '../services/api';

interface HistoryState {
  entries: HistoryEntry[];
  loading: boolean;
  error: string | null;
  load: (workspaceId: string) => Promise<void>;
  getById: (workspaceId: string, id: string) => Promise<HistoryEntry>;
  remove: (workspaceId: string, id: string) => Promise<void>;
  clearAll: (workspaceId: string) => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  loading: false,
  error: null,

  load: async (workspaceId) => {
    set({ loading: true, error: null });
    try {
      const entries = await historyApi.getAll(workspaceId);
      set({ entries, loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load history' });
    }
  },

  getById: async (workspaceId, id) => {
    return historyApi.getById(workspaceId, id);
  },

  remove: async (workspaceId, id) => {
    await historyApi.delete(workspaceId, id);
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id), error: null }));
  },

  clearAll: async (workspaceId) => {
    await historyApi.clearAll(workspaceId);
    set({ entries: [], error: null });
  },
}));
