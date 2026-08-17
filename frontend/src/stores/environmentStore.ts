import { create } from 'zustand';
import type { Environment } from '../types';
import { environmentsApi } from '../services/api';

interface EnvironmentState {
  environments: Environment[];
  loading: boolean;
  load: (workspaceId: string) => Promise<void>;
  create: (workspaceId: string, name: string) => Promise<Environment>;
  update: (workspaceId: string, id: string, name: string) => Promise<void>;
  activate: (workspaceId: string, id: string) => Promise<void>;
  remove: (workspaceId: string, id: string) => Promise<void>;
  getActive: () => Environment | undefined;
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  environments: [],
  loading: false,

  load: async (workspaceId) => {
    set({ loading: true, environments: [] });
    try {
      const environments = await environmentsApi.getAll(workspaceId);
      set({ environments, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  create: async (workspaceId, name) => {
    const env = await environmentsApi.create(workspaceId, name);
    set((s) => ({ environments: [...s.environments, env] }));
    return env;
  },

  update: async (workspaceId, id, name) => {
    const updated = await environmentsApi.update(workspaceId, id, name);
    set((s) => ({
      environments: s.environments.map((e) => (e.id === id ? updated : e)),
    }));
  },

  activate: async (workspaceId, id) => {
    await environmentsApi.activate(workspaceId, id);
    set((s) => ({
      environments: s.environments.map((e) => ({
        ...e,
        isActive: e.id === id,
      })),
    }));
  },

  remove: async (workspaceId, id) => {
    await environmentsApi.delete(workspaceId, id);
    set((s) => ({
      environments: s.environments.filter((e) => e.id !== id),
    }));
  },

  getActive: () => get().environments.find((e) => e.isActive),
}));
