import { create } from 'zustand';
import type {
  MockServer, MockServerEndpoint,
  CreateMockServerRequest, UpdateMockServerRequest,
  CreateMockEndpointRequest, UpdateMockEndpointRequest,
} from '../types';
import { mockServersApi } from '../services/api';

let loadVersion = 0;

interface MockServerState {
  workspaceId: string | null;
  mockServers: MockServer[];
  selectedServerId: string | null;
  selectedEndpointId: string | null;
  loading: boolean;
  error: string | null;

  // Server actions
  load: (workspaceId: string) => Promise<void>;
  create: (workspaceId: string, data: CreateMockServerRequest) => Promise<MockServer>;
  update: (workspaceId: string, id: string, data: UpdateMockServerRequest) => Promise<void>;
  remove: (workspaceId: string, id: string) => Promise<void>;
  setSelectedServer: (id: string | null) => void;
  start: (workspaceId: string, id: string) => Promise<void>;
  stop: (workspaceId: string, id: string) => Promise<void>;

  // Endpoint actions
  setSelectedEndpoint: (id: string | null) => void;
  createEndpoint: (workspaceId: string, mockServerId: string, data: CreateMockEndpointRequest) => Promise<MockServerEndpoint>;
  updateEndpoint: (workspaceId: string, mockServerId: string, endpointId: string, data: UpdateMockEndpointRequest) => Promise<void>;
  deleteEndpoint: (workspaceId: string, mockServerId: string, endpointId: string) => Promise<void>;
}

export const useMockServerStore = create<MockServerState>((set, get) => ({
  workspaceId: null,
  error: null,
  mockServers: [],
  selectedServerId: null,
  selectedEndpointId: null,
  loading: false,

  load: async (workspaceId) => {
    const version = ++loadVersion;
    if (get().workspaceId !== workspaceId) set({ workspaceId, mockServers: [], selectedServerId: null, selectedEndpointId: null });
    set({ loading: true, error: null });
    try {
      const values = await mockServersApi.getAll(workspaceId);
      if (version === loadVersion) set({ mockServers: values, loading: false });
    } catch (error) {
      if (version === loadVersion) set({ loading: false,
        error: error instanceof Error ? error.message : 'Could not load workspace data. Retry loading it.' });
    }
  },
  create: async (workspaceId, data) => {
    const server = await mockServersApi.create(workspaceId, data);
    if (get().workspaceId !== workspaceId) return server;
    set((s) => ({ mockServers: [...s.mockServers, { ...server, endpoints: server.endpoints ?? [] }] }));
    return server;
  },

  update: async (workspaceId, id, data) => {
    const updated = await mockServersApi.update(workspaceId, id, data);
    if (get().workspaceId !== workspaceId) return;
    set((s) => ({
      mockServers: s.mockServers.map((m) =>
        m.id === id
          ? { ...m, name: updated.name, description: updated.description, slug: updated.slug, port: updated.port, isRunning: updated.isRunning, updatedAt: updated.updatedAt }
          : m
      ),
    }));
  },

  remove: async (workspaceId, id) => {
    await mockServersApi.delete(workspaceId, id);
    if (get().workspaceId !== workspaceId) return;
    set((s) => ({
      mockServers: s.mockServers.filter((m) => m.id !== id),
      selectedServerId: s.selectedServerId === id ? null : s.selectedServerId,
      selectedEndpointId: s.selectedServerId === id ? null : s.selectedEndpointId,
    }));
  },

  setSelectedServer: (id) => set({ selectedServerId: id, selectedEndpointId: null }),

  start: async (workspaceId, id) => {
    await mockServersApi.start(workspaceId, id);
    if (get().workspaceId !== workspaceId) return;
    set((s) => ({
      mockServers: s.mockServers.map((m) => (m.id === id ? { ...m, isRunning: true } : m)),
    }));
  },

  stop: async (workspaceId, id) => {
    await mockServersApi.stop(workspaceId, id);
    if (get().workspaceId !== workspaceId) return;
    set((s) => ({
      mockServers: s.mockServers.map((m) => (m.id === id ? { ...m, isRunning: false } : m)),
    }));
  },

  // Endpoints
  setSelectedEndpoint: (id) => set({ selectedEndpointId: id }),

  createEndpoint: async (workspaceId, mockServerId, data) => {
    const endpoint = await mockServersApi.createEndpoint(workspaceId, mockServerId, data);
    if (get().workspaceId !== workspaceId) return endpoint;
    set((s) => ({
      mockServers: s.mockServers.map((m) =>
        m.id === mockServerId ? { ...m, endpoints: [...m.endpoints, endpoint] } : m
      ),
    }));
    return endpoint;
  },

  updateEndpoint: async (workspaceId, mockServerId, endpointId, data) => {
    const updated = await mockServersApi.updateEndpoint(workspaceId, mockServerId, endpointId, data);
    if (get().workspaceId !== workspaceId) return;
    set((s) => ({
      mockServers: s.mockServers.map((m) =>
        m.id === mockServerId
          ? { ...m, endpoints: m.endpoints.map((e) => (e.id === endpointId ? { ...e, ...updated } : e)) }
          : m
      ),
    }));
  },

  deleteEndpoint: async (workspaceId, mockServerId, endpointId) => {
    await mockServersApi.deleteEndpoint(workspaceId, mockServerId, endpointId);
    if (get().workspaceId !== workspaceId) return;
    set((s) => ({
      mockServers: s.mockServers.map((m) =>
        m.id === mockServerId
          ? { ...m, endpoints: m.endpoints.filter((e) => e.id !== endpointId) }
          : m
      ),
      selectedEndpointId: s.selectedEndpointId === endpointId ? null : s.selectedEndpointId,
    }));
  },
}));
