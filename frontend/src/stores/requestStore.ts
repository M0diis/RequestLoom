import { create } from 'zustand';
import type {
  Service,
  ApiRequest,
  ExecuteResponse,
  HistoryEntry,
  RuntimeScriptVariable,
  UpdateApiRequestPayload,
  KeyValuePairRequest,
  AuthRequest,
  RequestFolder,
  FolderContentsAction,
} from '../types';
import { servicesApi, requestsApi, executeApi, serviceVariablesApi } from '../services/api';
import { useDevToolsStore } from './devToolsStore';
import { useSettingsStore } from './settingsStore';
import { scheduleUndoableDelete, flushPendingDeletes } from '../lib/undoableDelete';

const requestSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const requestSaveVersions = new Map<string, number>();
const requestSaveQueues = new Map<string, Promise<void>>();
let workspaceLoadVersion = 0;
let selectionVersion = 0;

function buildUpdatePayload(request: ApiRequest): UpdateApiRequestPayload {
  return {
    name: request.name,
    method: request.method,
    url: request.url,
    body: request.body,
    bodyType: request.bodyType,
    preRequestScript: request.preRequestScript,
    postRequestScript: request.postRequestScript,
    testScript: request.testScript,
    notes: request.notes,
    headers: request.headers.map((h) => ({ key: h.key, value: h.value, enabled: h.enabled })),
    params: request.params.map((p) => ({ key: p.key, value: p.value, enabled: p.enabled })),
    variables: request.variables.map((v) => ({ key: v.key, value: v.value, enabled: v.enabled })),
    auth: request.auth
      ? { authType: request.auth.authType, configJson: request.auth.configJson }
      : null,
  };
}

function mergeRequestPatch(request: ApiRequest, patch: Partial<ApiRequest>): ApiRequest {
  return {
    ...request,
    ...patch,
    headers: patch.headers ?? request.headers,
    params: patch.params ?? request.params,
    variables: patch.variables ?? request.variables,
    auth: patch.auth !== undefined ? patch.auth : request.auth,
  };
}

function findRequestById(services: Service[], topLevelRequests: ApiRequest[], id: string): ApiRequest | null {
  const topLevel = topLevelRequests.find((request) => request.id === id);
  if (topLevel) return topLevel;
  for (const service of services) {
    const found = service.requests.find((r) => r.id === id);
    if (found) return found;
  }
  return null;
}

interface RequestState {
  workspaceId: string | null;
  error: string | null;
  draftsById: Record<string, ApiRequest>;
  services: Service[];
  topLevelRequests: ApiRequest[];
  activeRequestId: string | null;
  activeRequest: ApiRequest | null;
  openRequestIds: string[];
  responses: Record<string, ExecuteResponse | null>;
  runtimeScriptVariablesByRequest: Record<string, Record<string, RuntimeScriptVariable>>;
  sending: boolean;
  /** Request currently in flight and when it started (ms epoch), for the live timer. */
  sendingRequestId: string | null;
  sendStartedAt: number | null;
  loading: boolean;
  abortController: AbortController | null;
  dirtyRequests: Set<string>;

  loadServices: (workspaceId: string) => Promise<void>;
  createService: (workspaceId: string, name: string, storagePath?: string) => Promise<Service>;
  duplicateService: (workspaceId: string, id: string) => Promise<Service>;
  updateService: (
    workspaceId: string,
    id: string,
    name: string,
    description: string,
    headers?: KeyValuePairRequest[],
    auth?: AuthRequest | null,
  ) => Promise<void>;
  deleteService: (workspaceId: string, id: string) => Promise<void>;
  moveService: (workspaceId: string, id: string, direction: -1 | 1) => Promise<void>;
  reorderServices: (workspaceId: string, serviceIds: string[]) => Promise<void>;
  createFolder: (workspaceId: string, serviceId: string, name: string, parentFolderId?: string | null) => Promise<RequestFolder>;
  updateFolder: (workspaceId: string, serviceId: string, folderId: string, name: string) => Promise<void>;
  deleteFolder: (workspaceId: string, serviceId: string, folderId: string, contents?: FolderContentsAction, targetFolderId?: string | null) => Promise<void>;
  moveFolder: (workspaceId: string, serviceId: string, folderId: string, parentFolderId: string | null) => Promise<void>;
  reorderFolders: (workspaceId: string, serviceId: string, folderIds: string[]) => Promise<void>;

  selectRequest: (id: string) => Promise<void>;
  closeRequest: (id: string) => void;
  closeOtherRequests: (id: string) => void;
  closeRequestsToRight: (id: string) => void;
  moveOpenRequest: (id: string, beforeId: string | null) => void;
  createRequest: (serviceId: string, name: string, method: string, folderId?: string | null, url?: string) => Promise<ApiRequest>;
  createTopLevelRequest: (workspaceId: string, name: string, method: string, url?: string) => Promise<ApiRequest>;
  saveRequest: (id: string) => Promise<void>;
  updateRequest: (id: string, data: Partial<ApiRequest>) => Promise<void>;
  duplicateRequest: (id: string) => Promise<ApiRequest>;
  moveRequestToService: (id: string, serviceId: string) => Promise<void>;
  moveRequestToTopLevel: (id: string) => Promise<void>;
  moveRequestToFolder: (id: string, folderId: string | null) => Promise<void>;
  reorderRequest: (id: string, folderId: string | null, beforeRequestId?: string | null) => Promise<void>;
  deleteRequest: (id: string) => Promise<void>;
  deleteRequestsWithUndo: (ids: string[]) => void;
  deleteServiceWithUndo: (workspaceId: string, id: string) => void;
  toggleFavorite: (id: string) => Promise<void>;

  sendRequest: (workspaceId: string) => Promise<void>;
  setResponseFromHistory: (entry: HistoryEntry) => void;
  cancelRequest: () => void;
  clearResponse: (id: string) => void;
  clearServiceRuntimeVariables: (serviceId: string) => void;

  isRequestDirty: (id: string) => boolean;
  clearDirtyRequest: (id: string) => void;
}

export const useRequestStore = create<RequestState>((set, get) => ({
  workspaceId: null,
  error: null,
  draftsById: {},
  services: [],
  topLevelRequests: [],
  activeRequestId: null,
  activeRequest: null,
  openRequestIds: [],
  responses: {},
  runtimeScriptVariablesByRequest: {},
  sending: false,
  sendingRequestId: null,
  sendStartedAt: null,
  loading: false,
  abortController: null,
  dirtyRequests: new Set<string>(),

  loadServices: async (workspaceId) => {
    // Pending deletes would otherwise reappear in the freshly loaded tree.
    await flushPendingDeletes();
    const version = ++workspaceLoadVersion;
    if (get().workspaceId !== workspaceId) {
      ++selectionVersion;
      get().cancelRequest();
      set({ workspaceId, services: [], topLevelRequests: [], activeRequestId: null, activeRequest: null,
        openRequestIds: [], responses: {}, runtimeScriptVariablesByRequest: {} });
    }
    set({ loading: true, error: null });
    try {
      const [services, topLevelRequests] = await Promise.all([
        servicesApi.getAll(workspaceId), requestsApi.getTopLevel(workspaceId),
      ]);
      if (version !== workspaceLoadVersion) return;
      const draft = (request: ApiRequest) => get().draftsById[request.id] ?? request;
      const hydratedServices = services.map(service => ({ ...service, requests: service.requests.map(draft) }));
      const hydratedTopLevel = topLevelRequests.map(draft);
      const selected = get().activeRequestId;
      const activeRequest = selected ? findRequestById(hydratedServices, hydratedTopLevel, selected) : null;
      set({ services: hydratedServices, topLevelRequests: hydratedTopLevel, loading: false,
        activeRequest, activeRequestId: activeRequest?.id ?? null });
    } catch (error) {
      if (version === workspaceLoadVersion) set({ loading: false,
        error: error instanceof Error ? error.message : 'Could not load this workspace. Retry loading it.' });
    }
  },

  createService: async (workspaceId, name, storagePath) => {
    const service = await servicesApi.create(workspaceId, name, '', [], null, storagePath);
    service.requests = [];
    service.folders = [];
    set((s) => ({ services: [...s.services, service] }));
    return service;
  },

  duplicateService: async (workspaceId, id) => {
    const source = get().services.find((service) => service.id === id);
    if (!source) throw new Error('Collection not found');

    const created = await servicesApi.create(
      workspaceId,
      `${source.name} (copy)`,
      source.description,
      source.headers.map((header) => ({ key: header.key, value: header.value, enabled: header.enabled })),
      source.auth ? { authType: source.auth.authType, configJson: source.auth.configJson } : null,
    );

    const folderIds = new Map<string, string>();
    const pendingFolders = [...source.folders];
    while (pendingFolders.length > 0) {
      // Create parents before their children.
      const index = pendingFolders.findIndex((folder) => !folder.parentFolderId || folderIds.has(folder.parentFolderId));
      const [folder] = pendingFolders.splice(index < 0 ? 0 : index, 1);
      const createdFolder = await servicesApi.createFolder(
        workspaceId, created.id, folder.name,
        folder.parentFolderId ? folderIds.get(folder.parentFolderId) ?? null : null,
      );
      folderIds.set(folder.id, createdFolder.id);
    }

    for (const request of source.requests) {
      const createdRequest = await requestsApi.create(created.id, {
        name: request.name,
        method: request.method,
        url: request.url,
        folderId: request.folderId ? folderIds.get(request.folderId) ?? null : null,
      });
      await requestsApi.update(createdRequest.id, buildUpdatePayload({
        ...request,
        ...createdRequest,
        id: createdRequest.id,
        serviceId: created.id,
        name: request.name,
      }));
    }

    const variables = await serviceVariablesApi.getAll(source.id);
    for (const variable of variables) {
      await serviceVariablesApi.upsert(created.id, {
        environmentId: variable.environmentId,
        key: variable.key,
        value: variable.value,
        isSecret: variable.isSecret,
        enabled: variable.enabled,
      });
    }

    await get().loadServices(workspaceId);
    return get().services.find((service) => service.id === created.id) ?? { ...created, requests: [] };
  },

  updateService: async (workspaceId, id, name, description, headers, auth) => {
    const currentService = get().services.find((svc) => svc.id === id);
    const effectiveHeaders = headers
      ?? currentService?.headers.map((h) => ({ key: h.key, value: h.value, enabled: h.enabled }))
      ?? [];
    const authWasExplicitlyProvided = auth !== undefined;
    const effectiveAuth = auth === undefined
      ? (currentService?.auth
        ? { authType: currentService.auth.authType, configJson: currentService.auth.configJson }
        : null)
      : auth;

    const updated = await servicesApi.update(workspaceId, id, name, description, effectiveHeaders, effectiveAuth);
    set((s) => ({
      services: s.services.map((svc) =>
        svc.id === id
          ? {
            ...svc,
            ...updated,
            // When service auth is set to "none", backend omits null auth in JSON.
            // Respect explicit save intent by clearing stale auth in client state.
            auth: authWasExplicitlyProvided ? (updated.auth ?? null) : svc.auth,
            folders: svc.folders,
            requests: svc.requests,
          }
          : svc
      ),
    }));
  },

  deleteService: async (workspaceId, id) => {
    await servicesApi.delete(workspaceId, id);
    set((s) => {
      const deletedService = s.services.find((svc) => svc.id === id);
      const deletedRequestIds = new Set(deletedService?.requests.map((r) => r.id) ?? []);
      const nextIds = s.openRequestIds.filter((rid) => !deletedRequestIds.has(rid));
      const isActiveDeleted = s.activeRequestId && deletedRequestIds.has(s.activeRequestId);
      return {
        services: s.services.filter((svc) => svc.id !== id),
        openRequestIds: nextIds,
        activeRequestId: isActiveDeleted ? (nextIds[nextIds.length - 1] ?? null) : s.activeRequestId,
        activeRequest: isActiveDeleted ? null : s.activeRequest,
        responses: Object.fromEntries(
          Object.entries(s.responses).filter(([rid]) => !deletedRequestIds.has(rid))
        ),
      };
    });
  },

  moveService: async (workspaceId, id, direction) => {
    const services = get().services;
    const index = services.findIndex((svc) => svc.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= services.length) return;
    const next = [...services];
    [next[index], next[target]] = [next[target], next[index]];
    set({ services: next });
    try {
      await servicesApi.reorder(workspaceId, next.map((svc) => svc.id));
    } catch (err) {
      console.error('Failed to persist service order', err);
    }
  },

  reorderServices: async (workspaceId, serviceIds) => {
    const services = get().services;
    const knownServiceIds = new Set(services.map((service) => service.id));
    const orderedIds = [
      ...serviceIds.filter((serviceId) => knownServiceIds.has(serviceId)),
      ...services
        .map((service) => service.id)
        .filter((serviceId) => !serviceIds.includes(serviceId)),
    ];
    const serviceById = new Map(services.map((service) => [service.id, service]));
    const nextServices = orderedIds
      .map((serviceId, index) => {
        const service = serviceById.get(serviceId);
        return service ? { ...service, sortOrder: index } : null;
      })
      .filter((service): service is Service => service !== null);

    set({ services: nextServices });

    try {
      await servicesApi.reorder(workspaceId, orderedIds);
    } catch (error) {
      await get().loadServices(workspaceId);
      throw error;
    }
  },

  selectRequest: async (id) => {
    const version = ++selectionVersion;
    const cached = get().draftsById[id] ?? findRequestById(get().services, get().topLevelRequests, id);
    set(state => ({ activeRequestId: id, activeRequest: cached,
      openRequestIds: state.openRequestIds.includes(id) ? state.openRequestIds : [...state.openRequestIds, id] }));
    if (get().draftsById[id]) return;
    try {
      const request = await requestsApi.getById(id);
      if (version !== selectionVersion || get().activeRequestId !== id) return;
      set({ activeRequest: get().draftsById[id] ?? request, error: null });
    } catch (error) {
      if (version === selectionVersion) set({ error: error instanceof Error ? error.message : 'Could not open request' });
    }
  },

  closeRequest: (id) => {
    if (get().activeRequestId === id) ++selectionVersion;
    set((s) => {
      const nextIds = s.openRequestIds.filter((rid) => rid !== id);
      const isActive = s.activeRequestId === id;
      const newActiveId = isActive ? (nextIds[nextIds.length - 1] ?? null) : s.activeRequestId;

      // When closing the active tab, find the replacement request in the existing services tree
      let newActiveRequest: ApiRequest | null = null;
      if (isActive && newActiveId) {
        newActiveRequest = s.draftsById[newActiveId] ?? findRequestById(s.services, s.topLevelRequests, newActiveId);
      }

      const responses = { ...s.responses };
      delete responses[id];

      return {
        openRequestIds: nextIds,
        activeRequestId: newActiveId,
        activeRequest: isActive ? newActiveRequest : s.activeRequest,
        responses,
      };
    });

    // After setting from local state, also fetch fresh data from server
    const s = get();
    if (s.activeRequestId && !s.activeRequest) {
      const { selectRequest } = get();
      selectRequest(s.activeRequestId);
    }
  },

  closeOtherRequests: (id) => {
    set((s) => ({
      openRequestIds: s.openRequestIds.filter((rid) => rid === id),
      responses: s.responses[id] ? { [id]: s.responses[id] } : {},
    }));
    if (get().activeRequestId !== id) void get().selectRequest(id);
  },

  closeRequestsToRight: (id) => {
    const index = get().openRequestIds.indexOf(id);
    if (index < 0) return;
    const closing = get().openRequestIds.slice(index + 1);
    closing.forEach((rid) => get().closeRequest(rid));
  },

  moveOpenRequest: (id, beforeId) => set((s) => {
    if (id === beforeId || !s.openRequestIds.includes(id)) return s;
    const next = s.openRequestIds.filter((rid) => rid !== id);
    const insertAt = beforeId ? next.indexOf(beforeId) : -1;
    next.splice(insertAt < 0 ? next.length : insertAt, 0, id);
    return { openRequestIds: next };
  }),

  createFolder: async (workspaceId, serviceId, name, parentFolderId) => {
    const folder = await servicesApi.createFolder(workspaceId, serviceId, name, parentFolderId);
    set((s) => ({
      services: s.services.map((service) => service.id === serviceId
        ? { ...service, folders: [...service.folders, folder].sort((a, b) => a.sortOrder - b.sortOrder) }
        : service),
    }));
    return folder;
  },

  updateFolder: async (workspaceId, serviceId, folderId, name) => {
    const folder = await servicesApi.updateFolder(workspaceId, serviceId, folderId, name);
    set((s) => ({
      services: s.services.map((service) => service.id === serviceId
        ? { ...service, folders: service.folders.map((item) => item.id === folderId ? folder : item) }
        : service),
    }));
  },

  deleteFolder: async (workspaceId, serviceId, folderId, contents = 'parent', targetFolderId = null) => {
    await servicesApi.deleteFolder(workspaceId, serviceId, folderId, contents, targetFolderId);
    set((s) => {
      const folders = s.services.find((service) => service.id === serviceId)?.folders ?? [];

      if (contents === 'delete') {
        const removedFolderIds = new Set<string>([folderId]);
        for (let grew = true; grew;) {
          grew = false;
          for (const folder of folders) {
            if (folder.parentFolderId && removedFolderIds.has(folder.parentFolderId) && !removedFolderIds.has(folder.id)) {
              removedFolderIds.add(folder.id);
              grew = true;
            }
          }
        }
        const removedRequestIds = new Set(
          (s.services.find((service) => service.id === serviceId)?.requests ?? [])
            .filter((request) => request.folderId && removedFolderIds.has(request.folderId))
            .map((request) => request.id),
        );
        removedRequestIds.forEach((id) => {
          const timer = requestSaveTimers.get(id);
          if (timer) clearTimeout(timer);
          requestSaveTimers.delete(id);
          requestSaveVersions.set(id, (requestSaveVersions.get(id) ?? 0) + 1);
        });
        const nextIds = s.openRequestIds.filter((id) => !removedRequestIds.has(id));
        const activeRemoved = s.activeRequestId !== null && removedRequestIds.has(s.activeRequestId);
        const responses = { ...s.responses };
        const draftsById = { ...s.draftsById };
        removedRequestIds.forEach((id) => {
          delete responses[id];
          delete draftsById[id];
        });
        return {
          services: s.services.map((service) => service.id === serviceId
            ? {
              ...service,
              folders: service.folders.filter((folder) => !removedFolderIds.has(folder.id)),
              requests: service.requests.filter((request) => !removedRequestIds.has(request.id)),
            }
            : service),
          responses,
          draftsById,
          dirtyRequests: new Set([...s.dirtyRequests].filter((id) => !removedRequestIds.has(id))),
          openRequestIds: nextIds,
          activeRequestId: activeRemoved ? (nextIds[nextIds.length - 1] ?? null) : s.activeRequestId,
          activeRequest: activeRemoved ? null : s.activeRequest,
        };
      }

      // Children and requests move to the chosen destination.
      const deletedParentId = folders.find((folder) => folder.id === folderId)?.parentFolderId ?? null;
      const parentId = contents === 'root' ? null : contents === 'folder' ? (targetFolderId ?? null) : deletedParentId;
      return {
        services: s.services.map((service) => service.id === serviceId
          ? {
            ...service,
            folders: service.folders
              .filter((folder) => folder.id !== folderId)
              .map((folder) => folder.parentFolderId === folderId ? { ...folder, parentFolderId: parentId } : folder),
            requests: service.requests.map((request) => request.folderId === folderId ? { ...request, folderId: parentId } : request),
          }
          : service),
        activeRequest: s.activeRequest?.folderId === folderId ? { ...s.activeRequest, folderId: parentId } : s.activeRequest,
      };
    });
  },

  moveFolder: async (workspaceId, serviceId, folderId, parentFolderId) => {
    const moved = await servicesApi.moveFolder(workspaceId, serviceId, folderId, parentFolderId);
    set((s) => ({
      services: s.services.map((service) => service.id === serviceId
        ? {
          ...service,
          folders: service.folders
            .map((folder) => folder.id === folderId ? moved : folder)
            .sort((a, b) => a.sortOrder - b.sortOrder),
        }
        : service),
    }));
  },

  reorderFolders: async (workspaceId, serviceId, folderIds) => {
    const service = get().services.find((item) => item.id === serviceId);
    if (!service) return;

    const knownFolderIds = new Set(service.folders.map((folder) => folder.id));
    const orderedIds = [
      ...folderIds.filter((folderId) => knownFolderIds.has(folderId)),
      ...service.folders
        .map((folder) => folder.id)
        .filter((folderId) => !folderIds.includes(folderId)),
    ];
    const nextFolders = orderedIds.map((folderId, index) => {
      const folder = service.folders.find((item) => item.id === folderId);
      return folder ? { ...folder, sortOrder: index } : null;
    }).filter((folder): folder is RequestFolder => folder !== null);

    set((s) => ({
      services: s.services.map((item) => item.id === serviceId ? { ...item, folders: nextFolders } : item),
    }));

    try {
      await servicesApi.reorderFolders(workspaceId, serviceId, orderedIds);
    } catch (error) {
      await get().loadServices(workspaceId);
      throw error;
    }
  },

  createRequest: async (serviceId, name, method, folderId = null, url = '') => {
    const request = await requestsApi.create(serviceId, { name, method, url, folderId });
    set((s) => ({
      services: s.services.map((svc) =>
        svc.id === serviceId ? { ...svc, requests: [...svc.requests, request] } : svc
      ),
    }));
    return request;
  },

  createTopLevelRequest: async (workspaceId, name, method, url = '') => {
    const request = await requestsApi.createTopLevel(workspaceId, { name, method, url });
    set((s) => ({ topLevelRequests: [...s.topLevelRequests, request] }));
    return request;
  },

  saveRequest: async (id) => {
    const timer = requestSaveTimers.get(id);
    if (timer) clearTimeout(timer);
    requestSaveTimers.delete(id);
    const save = (requestSaveQueues.get(id) ?? Promise.resolve()).then(async () => {
      const state = get();
      const latest = state.draftsById[id] ?? (state.activeRequest?.id === id ? state.activeRequest
        : findRequestById(state.services, state.topLevelRequests, id));
      if (!latest) return;
      const revision = requestSaveVersions.get(id) ?? 0;
      try {
        const updated = await requestsApi.update(id, buildUpdatePayload(latest));
        if ((requestSaveVersions.get(id) ?? 0) !== revision) return;
        const stableUpdated = { ...updated, headers: latest.headers, params: latest.params, variables: latest.variables };
        set(current => {
          const dirtyRequests = new Set(current.dirtyRequests);
          dirtyRequests.delete(id);
          const draftsById = { ...current.draftsById };
          delete draftsById[id];
          return { activeRequest: current.activeRequest?.id === id ? stableUpdated : current.activeRequest,
            topLevelRequests: current.topLevelRequests.map(request => request.id === id ? stableUpdated : request),
            services: current.services.map(service => ({ ...service,
              requests: service.requests.map(request => request.id === id ? stableUpdated : request) })),
            dirtyRequests, draftsById, error: null };
        });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : 'Could not save request. Your draft is retained.' });
      }
    });
    requestSaveQueues.set(id, save);
    try { await save; }
    finally { if (requestSaveQueues.get(id) === save) requestSaveQueues.delete(id); }
  },

  updateRequest: async (id, data) => {
    let mergedRequest: ApiRequest | null = null;

    // Mark as dirty immediately
    set((s) => {
      const next = new Set(s.dirtyRequests);
      next.add(id);
      return { dirtyRequests: next };
    });

    set((s) => {
      const source = (s.activeRequest?.id === id ? s.activeRequest : findRequestById(s.services, s.topLevelRequests, id));
      if (!source) return s;

      mergedRequest = mergeRequestPatch(source, data);

      return {
        activeRequest: s.activeRequest?.id === id ? mergedRequest : s.activeRequest,
        draftsById: { ...s.draftsById, [id]: mergedRequest! },
        error: null,
        topLevelRequests: s.topLevelRequests.map((request) => (
          request.id === id ? mergeRequestPatch(request, data) : request
        )),
        services: s.services.map((svc) => ({
          ...svc,
          requests: svc.requests.map((r) => (r.id === id ? mergeRequestPatch(r, data) : r)),
        })),
      };
    });

    if (!mergedRequest) return;

    requestSaveVersions.set(id, (requestSaveVersions.get(id) ?? 0) + 1);
    if (useSettingsStore.getState().settings?.autoSave === false) return;

    const existingTimer = requestSaveTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      void get().saveRequest(id);
    }, 350);

    requestSaveTimers.set(id, timer);
  },

  duplicateRequest: async (id) => {
    const duplicated = await requestsApi.duplicate(id);
    set((s) => ({
      topLevelRequests: duplicated.serviceId === null
        ? [...s.topLevelRequests, duplicated]
        : s.topLevelRequests,
      services: s.services.map((svc) =>
        svc.id === duplicated.serviceId
          ? { ...svc, requests: [...svc.requests, duplicated] }
          : svc
      ),
    }));
    return duplicated;
  },

  moveRequestToService: async (id, serviceId) => {
    await requestsApi.moveToService(id, serviceId);
    set((s) => {
      const sourceService = s.services.find((service) => service.requests.some((request) => request.id === id));
      const request = s.topLevelRequests.find((item) => item.id === id)
        ?? sourceService?.requests.find((item) => item.id === id);
      if (!request) return s;
      const movedRequest = { ...request, serviceId, folderId: null };
      return {
        topLevelRequests: s.topLevelRequests.filter((item) => item.id !== id),
        services: s.services.map((service) => service.id === serviceId
          ? { ...service, requests: [...service.requests.filter((item) => item.id !== id), movedRequest] }
          : { ...service, requests: service.requests.filter((item) => item.id !== id) }),
        activeRequest: s.activeRequest?.id === id ? movedRequest : s.activeRequest,
      };
    });
  },

  moveRequestToTopLevel: async (id) => {
    await requestsApi.moveToTopLevel(id);
    set((s) => {
      const service = s.services.find((item) => item.requests.some((request) => request.id === id));
      const request = service?.requests.find((item) => item.id === id);
      if (!service || !request) return s;

      const movedRequest = { ...request, serviceId: null, folderId: null };
      return {
        topLevelRequests: [...s.topLevelRequests, movedRequest],
        services: s.services.map((item) => item.id === service.id
          ? { ...item, requests: item.requests.filter((itemRequest) => itemRequest.id !== id) }
          : item),
        activeRequest: s.activeRequest?.id === id ? movedRequest : s.activeRequest,
      };
    });
  },

  moveRequestToFolder: async (id, folderId) => {
    await requestsApi.moveToFolder(id, folderId);
    set((s) => ({
      topLevelRequests: s.topLevelRequests.map((request) => request.id === id ? { ...request, folderId } : request),
      services: s.services.map((service) => ({
        ...service,
        requests: service.requests.map((request) => request.id === id ? { ...request, folderId } : request),
      })),
      activeRequest: s.activeRequest?.id === id ? { ...s.activeRequest, folderId } : s.activeRequest,
    }));
  },

  reorderRequest: async (id, folderId, beforeRequestId = null) => {
    await requestsApi.reorder(id, folderId, beforeRequestId);
    set((s) => {
      const topLevelRequest = s.topLevelRequests.find((item) => item.id === id);
      if (topLevelRequest) {
        const nextRequests = s.topLevelRequests.filter((item) => item.id !== id);
        const movedRequest = { ...topLevelRequest, folderId: null };
        let insertIndex = beforeRequestId
          ? nextRequests.findIndex((item) => item.id === beforeRequestId)
          : nextRequests.length;
        if (insertIndex < 0) insertIndex = nextRequests.length;
        nextRequests.splice(insertIndex, 0, movedRequest);
        return {
          topLevelRequests: nextRequests,
          activeRequest: s.activeRequest?.id === id ? movedRequest : s.activeRequest,
        };
      }

      const service = s.services.find((item) => item.requests.some((request) => request.id === id));
      if (!service) return s;

      const request = service.requests.find((item) => item.id === id);
      if (!request) return s;

      const nextRequests = service.requests.filter((item) => item.id !== id);
      const movedRequest = { ...request, folderId };
      let insertIndex = beforeRequestId
        ? nextRequests.findIndex((item) => item.id === beforeRequestId && item.folderId === folderId)
        : nextRequests.findLastIndex((item) => item.folderId === folderId) + 1;
      if (insertIndex < 0) insertIndex = nextRequests.length;
      nextRequests.splice(insertIndex, 0, movedRequest);

      return {
        services: s.services.map((item) => item.id === service.id ? { ...item, requests: nextRequests } : item),
        activeRequest: s.activeRequest?.id === id ? { ...s.activeRequest, folderId } : s.activeRequest,
      };
    });
  },

  deleteRequest: async (id) => {
    const timer = requestSaveTimers.get(id);
    if (timer) clearTimeout(timer);
    requestSaveTimers.delete(id);
    await requestSaveQueues.get(id);
    await requestsApi.delete(id);
    requestSaveVersions.set(id, (requestSaveVersions.get(id) ?? 0) + 1);
    set((s) => {
      const nextIds = s.openRequestIds.filter((rid) => rid !== id);
      const isActive = s.activeRequestId === id;
      const responses = { ...s.responses };
      delete responses[id];
      const draftsById = { ...s.draftsById };
      delete draftsById[id];
      const dirtyRequests = new Set(s.dirtyRequests);
      dirtyRequests.delete(id);
      return {
        draftsById, dirtyRequests,
        topLevelRequests: s.topLevelRequests.filter((request) => request.id !== id),
        services: s.services.map((svc) => ({
          ...svc,
          requests: svc.requests.filter((r) => r.id !== id),
        })),
        openRequestIds: nextIds,
        activeRequestId: isActive ? (nextIds[nextIds.length - 1] ?? null) : s.activeRequestId,
        activeRequest: isActive ? null : s.activeRequest,
        responses,
      };
    });
  },

  deleteRequestsWithUndo: (ids) => {
    const idSet = new Set(ids.filter((id) => findRequestById(get().services, get().topLevelRequests, id)));
    if (idSet.size === 0) return;
    const first = findRequestById(get().services, get().topLevelRequests, [...idSet][0]);
    const committed = new Set<string>();
    let placements: { request: ApiRequest; serviceId: string | null; index: number; openIndex: number; wasActive: boolean }[] = [];

    scheduleUndoableDelete({
      message: idSet.size === 1 ? `Deleted "${first?.name ?? 'request'}"` : `Deleted ${idSet.size} requests`,
      unloadUrls: [...idSet].map((id) => `/api/requests/${id}`),
      hide: () => {
        const s = get();
        placements = [...idSet].map((id) => {
          const service = s.services.find((svc) => svc.requests.some((request) => request.id === id));
          const list = service ? service.requests : s.topLevelRequests;
          const index = list.findIndex((request) => request.id === id);
          return { request: list[index], serviceId: service?.id ?? null, index,
            openIndex: s.openRequestIds.indexOf(id), wasActive: s.activeRequestId === id };
        });
        const nextIds = s.openRequestIds.filter((id) => !idSet.has(id));
        const activeHidden = s.activeRequestId !== null && idSet.has(s.activeRequestId);
        if (activeHidden) ++selectionVersion;
        set({
          topLevelRequests: s.topLevelRequests.filter((request) => !idSet.has(request.id)),
          services: s.services.map((svc) => ({ ...svc, requests: svc.requests.filter((request) => !idSet.has(request.id)) })),
          openRequestIds: nextIds,
          ...(activeHidden ? { activeRequestId: null, activeRequest: null } : {}),
        });
        if (activeHidden && nextIds.length > 0) void get().selectRequest(nextIds[nextIds.length - 1]);
      },
      restore: () => {
        const restorable = placements.filter((placement) => !committed.has(placement.request.id)).sort((a, b) => a.index - b.index);
        set((s) => {
          const topLevelRequests = [...s.topLevelRequests];
          const services = s.services.map((svc) => ({ ...svc, requests: [...svc.requests] }));
          const openRequestIds = [...s.openRequestIds];
          for (const placement of restorable) {
            const request = s.draftsById[placement.request.id] ?? placement.request;
            const target = placement.serviceId
              ? services.find((svc) => svc.id === placement.serviceId)?.requests
              : topLevelRequests;
            if (!target) continue;
            target.splice(Math.min(placement.index, target.length), 0, request);
            if (placement.openIndex >= 0) openRequestIds.splice(Math.min(placement.openIndex, openRequestIds.length), 0, request.id);
          }
          return { topLevelRequests, services, openRequestIds };
        });
        const active = restorable.find((placement) => placement.wasActive);
        if (active) void get().selectRequest(active.request.id);
      },
      commit: async () => {
        const results = await Promise.allSettled([...idSet].map(async (id) => {
          await get().deleteRequest(id);
          committed.add(id);
        }));
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failure) throw failure.reason;
      },
    });
  },

  deleteServiceWithUndo: (workspaceId, id) => {
    const service = get().services.find((svc) => svc.id === id);
    if (!service) return;
    let index = -1;
    let openRequestIds: string[] = [];
    let activeRequestId: string | null = null;

    scheduleUndoableDelete({
      message: `Removed collection "${service.name}"`,
      unloadUrls: [`/api/workspaces/${workspaceId}/services/${id}`],
      hide: () => {
        const s = get();
        index = s.services.findIndex((svc) => svc.id === id);
        const requestIds = new Set(s.services[index].requests.map((request) => request.id));
        openRequestIds = s.openRequestIds;
        activeRequestId = s.activeRequestId;
        const nextIds = s.openRequestIds.filter((rid) => !requestIds.has(rid));
        const activeHidden = s.activeRequestId !== null && requestIds.has(s.activeRequestId);
        if (activeHidden) ++selectionVersion;
        set({
          services: s.services.filter((svc) => svc.id !== id),
          openRequestIds: nextIds,
          ...(activeHidden ? { activeRequestId: null, activeRequest: null } : {}),
        });
        if (activeHidden && nextIds.length > 0) void get().selectRequest(nextIds[nextIds.length - 1]);
      },
      restore: () => {
        const requestIds = new Set(service.requests.map((request) => request.id));
        set((s) => {
          const services = [...s.services];
          services.splice(Math.min(index, services.length), 0, service);
          // Reopen the collection's tabs in their old positions.
          const stillOpen = new Set(s.openRequestIds);
          const reopened = openRequestIds.filter((rid) => stillOpen.has(rid) || requestIds.has(rid));
          const extra = s.openRequestIds.filter((rid) => !reopened.includes(rid));
          return { services, openRequestIds: [...reopened, ...extra] };
        });
        if (activeRequestId && requestIds.has(activeRequestId)) void get().selectRequest(activeRequestId);
      },
      commit: () => get().deleteService(workspaceId, id),
    });
  },

  toggleFavorite: async (id) => {
    await requestsApi.toggleFavorite(id);
    set((s) => ({
      topLevelRequests: s.topLevelRequests.map((request) =>
        request.id === id ? { ...request, isFavorite: !request.isFavorite } : request
      ),
      services: s.services.map((svc) => ({
        ...svc,
        requests: svc.requests.map((r) =>
          r.id === id ? { ...r, isFavorite: !r.isFavorite } : r
        ),
      })),
      activeRequest: s.activeRequest?.id === id
        ? { ...s.activeRequest, isFavorite: !s.activeRequest.isFavorite }
        : s.activeRequest,
    }));
  },

  sendRequest: async (workspaceId) => {
    const { activeRequest } = get();
    if (!activeRequest || get().sending || get().activeRequestId !== activeRequest.id ||
      (get().workspaceId && get().workspaceId !== workspaceId)) return;

    const abortController = new AbortController();
    const startedAt = new Date().toISOString();
    const startedAtMs = performance.now();
    set((s) => ({ sending: true, sendingRequestId: activeRequest.id, sendStartedAt: Date.now(), abortController, responses: { ...s.responses, [activeRequest.id]: null } }));

    try {
      const response = await executeApi.send({
        method: activeRequest.method,
        url: activeRequest.url,
        body: activeRequest.body,
        bodyType: activeRequest.bodyType,
        preRequestScript: activeRequest.preRequestScript,
        postRequestScript: activeRequest.postRequestScript,
        testScript: activeRequest.testScript,
        headers: activeRequest.headers.map((h) => ({ key: h.key, value: h.value, enabled: h.enabled })),
        params: activeRequest.params.map((p) => ({ key: p.key, value: p.value, enabled: p.enabled })),
        variables: activeRequest.variables.map((v) => ({ key: v.key, value: v.value, enabled: v.enabled })),
        auth: activeRequest.auth
          ? { authType: activeRequest.auth.authType, configJson: activeRequest.auth.configJson }
          : null,
        workspaceId,
        serviceId: activeRequest.serviceId,
        requestId: activeRequest.id,
      }, abortController.signal);
      if (get().abortController !== abortController) return;
      set((state) => ({
        responses: { ...state.responses, [activeRequest.id]: response },
        sending: false,
        sendingRequestId: null,
        abortController: null,
        runtimeScriptVariablesByRequest: (() => {
          const nextRuntimeVariables = { ...state.runtimeScriptVariablesByRequest };
          const service = state.services.find((item) => item.id === activeRequest.serviceId);
          const requestIds = service?.requests.map((request) => request.id) ?? [activeRequest.id];
          for (const requestId of requestIds) {
            if (requestId === activeRequest.id) {
              nextRuntimeVariables[requestId] = response.scriptVariables ?? {};
              continue;
            }

            const requestVariables = Object.fromEntries(
              Object.entries(nextRuntimeVariables[requestId] ?? {})
                .filter(([, variable]) => variable.scope !== 'service')
            );
            nextRuntimeVariables[requestId] = {
              ...requestVariables,
              ...(response.serviceScriptVariables ?? {}),
            };
          }
          return nextRuntimeVariables;
        })(),
      }));
      if (activeRequest.serviceId && response.serviceScriptVariables) {
        window.dispatchEvent(new CustomEvent('service-variables:updated', {
          detail: { serviceId: activeRequest.serviceId },
        }));
      }
      useDevToolsStore.getState().recordNetworkEntry({
        requestId: activeRequest.id,
        method: activeRequest.method,
        url: activeRequest.url,
        status: response.statusCode,
        statusText: response.statusText || (response.statusCode ? 'Response' : 'Error'),
        durationMs: response.responseTimeMs || performance.now() - startedAtMs,
        sizeBytes: response.responseSizeBytes,
        startedAt,
        error: response.error,
      });
      window.dispatchEvent(new CustomEvent('history:updated'));
    } catch (err: unknown) {
      if (get().abortController !== abortController) return;
      if (err instanceof Error && err.name === 'CanceledError') {
        set({ sending: false, sendingRequestId: null, abortController: null });
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        set((s) => ({
          responses: {
            ...s.responses,
            [activeRequest.id]: {
              statusCode: 0,
              statusText: 'Error',
              headers: {},
              body: '',
              contentType: '',
              responseTimeMs: 0,
              responseSizeBytes: 0,
              error: errorMessage,
              isSoapFault: false,
              scriptVariables: {},
              scriptLogs: [],
              testResults: [],
            },
          },
          sending: false,
          sendingRequestId: null,
          abortController: null,
        }));
        useDevToolsStore.getState().recordNetworkEntry({
          requestId: activeRequest.id,
          method: activeRequest.method,
          url: activeRequest.url,
          status: 0,
          statusText: 'Error',
          durationMs: performance.now() - startedAtMs,
          sizeBytes: 0,
          startedAt,
          error: errorMessage,
        });
      }
    }
  },

  setResponseFromHistory: (entry) => {
    let parsedHeaders: Record<string, string[]> = {};
    if (entry.responseHeadersJson) {
      try {
        const parsed = JSON.parse(entry.responseHeadersJson) as Record<string, unknown>;
        parsedHeaders = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => {
            if (Array.isArray(value)) {
              return [key, value.map((item) => String(item))];
            }

            return [key, [String(value ?? '')]];
          })
        );
      } catch {
        parsedHeaders = {};
      }
    }

    const { activeRequestId } = get();
    if (!activeRequestId) return;
    set((s) => ({
      responses: {
        ...s.responses,
        [activeRequestId]: {
          statusCode: entry.responseStatus,
          statusText: entry.statusText ?? '',
          headers: parsedHeaders,
          body: entry.responseBody ?? '',
          contentType: entry.contentType
            || parsedHeaders['Content-Type']?.[0]
            || parsedHeaders['content-type']?.[0]
            || '',
          responseTimeMs: entry.responseTimeMs,
          responseSizeBytes: entry.responseSizeBytes,
          isTruncated: entry.isTruncated ?? false,
          error: entry.error,
          isSoapFault: entry.isSoapFault ?? false,
          soapFault: entry.soapFault,
          scriptVariables: entry.scriptVariables ?? {},
          serviceScriptVariables: entry.serviceScriptVariables ?? {},
          scriptLogs: entry.scriptLogs ?? [],
          testResults: entry.testResults ?? [],
        },
      },
    }));
  },

  cancelRequest: () => {
    const { abortController } = get();
    abortController?.abort();
    set({ sending: false, sendingRequestId: null, abortController: null });
  },

  clearResponse: (id: string) => set((s) => {
    const responses = { ...s.responses };
    delete responses[id];
    return { responses };
  }),

  clearServiceRuntimeVariables: (serviceId: string) => {
    set((state) => {
      const service = state.services.find((item) => item.id === serviceId);
      const requestIds = new Set(service?.requests.map((request) => request.id) ?? []);
      if (requestIds.size === 0) return state;

      const nextRuntimeVariables = { ...state.runtimeScriptVariablesByRequest };
      for (const requestId of requestIds) {
        const requestVariables = nextRuntimeVariables[requestId];
        if (!requestVariables) continue;

        nextRuntimeVariables[requestId] = Object.fromEntries(
          Object.entries(requestVariables)
            .filter(([, variable]) => variable.scope !== 'service')
        );
      }

      return { runtimeScriptVariablesByRequest: nextRuntimeVariables };
    });
  },

  isRequestDirty: (id: string) => get().dirtyRequests.has(id),

  clearDirtyRequest: (id: string) => {
    set((s) => {
      const next = new Set(s.dirtyRequests);
      next.delete(id);
      return { dirtyRequests: next };
    });
  },
}));
