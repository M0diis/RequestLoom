import { create } from 'zustand';
import type { Workspace } from '../types';
import { workspacesApi } from '../services/api';

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  loading: boolean;
  load: () => Promise<void>;
  create: (name: string) => Promise<Workspace>;
  update: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: localStorage.getItem('activeWorkspaceId') || 'default',
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const workspaces = await workspacesApi.getAll();
      const currentActiveId = get().activeWorkspaceId;
      const hasCurrentActive = workspaces.some((workspace) => workspace.id === currentActiveId);
      const fallbackActiveId = workspaces.find((workspace) => workspace.id === 'default')?.id
        ?? workspaces[0]?.id
        ?? 'default';
      const nextActiveId = hasCurrentActive ? currentActiveId : fallbackActiveId;

      if (nextActiveId !== currentActiveId) {
        localStorage.setItem('activeWorkspaceId', nextActiveId);
      }

      set({ workspaces, activeWorkspaceId: nextActiveId, loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  create: async (name) => {
    const workspace = await workspacesApi.create(name);
    localStorage.setItem('activeWorkspaceId', workspace.id);
    set((s) => ({
      workspaces: [...s.workspaces, workspace],
      activeWorkspaceId: workspace.id,
    }));
    return workspace;
  },

  update: async (id, name) => {
    const updated = await workspacesApi.update(id, name);
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? updated : w)),
    }));
  },

  remove: async (id) => {
    await workspacesApi.delete(id);
    const { activeWorkspaceId } = get();
    set((state) => {
      const remaining = state.workspaces.filter((workspace) => workspace.id !== id);
      const nextActiveId = activeWorkspaceId === id
        ? (remaining.find((workspace) => workspace.id === 'default')?.id
          ?? remaining[0]?.id
          ?? 'default')
        : activeWorkspaceId;

      return {
        workspaces: remaining,
        activeWorkspaceId: nextActiveId,
      };
    });

    const nextActiveId = get().activeWorkspaceId;
    localStorage.setItem('activeWorkspaceId', nextActiveId);
  },

  setActive: (id) => {
    if (!get().workspaces.some((workspace) => workspace.id === id)) {
      return;
    }

    localStorage.setItem('activeWorkspaceId', id);
    set({ activeWorkspaceId: id });
  },
}));
