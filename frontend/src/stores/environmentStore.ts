import { create } from 'zustand';
import type { Environment } from '../types';
import { environmentsApi } from '../services/api';
import { scheduleUndoableDelete, flushPendingDeletes } from '../lib/undoableDelete';

let loadVersion = 0;

interface EnvironmentState {
  workspaceId: string | null;
  environments: Environment[];
  loading: boolean;
  error: string | null;
  load: (workspaceId: string) => Promise<void>;
  create: (workspaceId: string, name: string) => Promise<Environment>;
  update: (workspaceId: string, id: string, name: string) => Promise<void>;
  activate: (workspaceId: string, id: string) => Promise<void>;
  remove: (workspaceId: string, id: string) => Promise<void>;
  removeWithUndo: (workspaceId: string, id: string) => void;
  getActive: () => Environment | undefined;
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  workspaceId: null,
  error: null,
  environments: [],
  loading: false,

  load: async (workspaceId) => {
    await flushPendingDeletes();
    const version = ++loadVersion;
    if (get().workspaceId !== workspaceId) set({ workspaceId, environments: [] });
    set({ loading: true, error: null });
    try {
      const values = await environmentsApi.getAll(workspaceId);
      if (version === loadVersion) set({ environments: values, loading: false });
    } catch (error) {
      if (version === loadVersion) set({ loading: false,
        error: error instanceof Error ? error.message : 'Could not load workspace data. Retry loading it.' });
    }
  },
  create: async (workspaceId, name) => {
    const env = await environmentsApi.create(workspaceId, name);
    if (get().workspaceId !== workspaceId) return env;
    set((s) => ({ environments: [...s.environments, env] }));
    return env;
  },

  update: async (workspaceId, id, name) => {
    const updated = await environmentsApi.update(workspaceId, id, name);
    if (get().workspaceId !== workspaceId) return;
    set((s) => ({
      environments: s.environments.map((e) => (e.id === id ? updated : e)),
    }));
  },

  activate: async (workspaceId, id) => {
    await environmentsApi.activate(workspaceId, id);
    if (get().workspaceId !== workspaceId) return;
    set((s) => ({
      environments: s.environments.map((e) => ({
        ...e,
        isActive: e.id === id,
      })),
    }));
  },

  remove: async (workspaceId, id) => {
    await environmentsApi.delete(workspaceId, id);
    if (get().workspaceId !== workspaceId) return;
    set((s) => ({
      environments: s.environments.filter((e) => e.id !== id),
    }));
  },

  removeWithUndo: (workspaceId, id) => {
    const environment = get().environments.find((e) => e.id === id);
    if (!environment) return;
    let index = -1;
    scheduleUndoableDelete({
      message: `Deleted environment "${environment.name}"`,
      unloadUrls: [`/api/workspaces/${workspaceId}/environments/${id}`],
      hide: () => {
        index = get().environments.findIndex((e) => e.id === id);
        set((s) => ({ environments: s.environments.filter((e) => e.id !== id) }));
      },
      restore: () => {
        if (get().workspaceId !== workspaceId) return;
        set((s) => {
          const environments = [...s.environments];
          environments.splice(Math.min(index, environments.length), 0, environment);
          return { environments };
        });
      },
      commit: () => get().remove(workspaceId, id),
    });
  },

  getActive: () => get().environments.find((e) => e.isActive),
}));
