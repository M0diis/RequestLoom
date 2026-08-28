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
} from '../types';
import { servicesApi, requestsApi, executeApi, serviceVariablesApi } from '../services/api';

const requestSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const requestSaveVersions = new Map<string, number>();

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

function findRequestById(services: Service[], id: string): ApiRequest | null {
  for (const service of services) {
    const found = service.requests.find((r) => r.id === id);
    if (found) return found;
  }
  return null;
}

interface RequestState {
  services: Service[];
  activeRequestId: string | null;
  activeRequest: ApiRequest | null;
  openRequestIds: string[];
  responses: Record<string, ExecuteResponse | null>;
  runtimeScriptVariablesByRequest: Record<string, Record<string, RuntimeScriptVariable>>;
  sending: boolean;
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

  selectRequest: (id: string) => Promise<void>;
  closeRequest: (id: string) => void;
  createRequest: (serviceId: string, name: string, method: string) => Promise<ApiRequest>;
  updateRequest: (id: string, data: Partial<ApiRequest>) => Promise<void>;
  duplicateRequest: (id: string) => Promise<ApiRequest>;
  deleteRequest: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;

  sendRequest: (workspaceId: string) => Promise<void>;
  setResponseFromHistory: (entry: HistoryEntry) => void;
  cancelRequest: () => void;
  clearResponse: (id: string) => void;

  isRequestDirty: (id: string) => boolean;
  clearDirtyRequest: (id: string) => void;
}

export const useRequestStore = create<RequestState>((set, get) => ({
  services: [],
  activeRequestId: null,
  activeRequest: null,
  openRequestIds: [],
  responses: {},
  runtimeScriptVariablesByRequest: {},
  sending: false,
  loading: false,
  abortController: null,
  dirtyRequests: new Set<string>(),

  loadServices: async (workspaceId) => {
    set({ loading: true });
    const services = await servicesApi.getAll(workspaceId);

    set((state) => {
      if (!state.activeRequestId) {
        return { services, loading: false };
      }

      const activeStillExists = services.some((service) =>
        service.requests.some((request) => request.id === state.activeRequestId)
      );

      if (activeStillExists) {
        return { services, loading: false };
      }

      const knownIds = new Set<string>();
      for (const svc of services) {
        for (const req of svc.requests) knownIds.add(req.id);
      }

      const responses = Object.fromEntries(
        Object.entries(state.responses).filter(([rid]) => knownIds.has(rid))
      );

      return {
        services,
        loading: false,
        activeRequestId: null,
        activeRequest: null,
        responses,
      };
    });
  },

  createService: async (workspaceId, name, storagePath) => {
    const service = await servicesApi.create(workspaceId, name, '', [], null, storagePath);
    service.requests = [];
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

    for (const request of source.requests) {
      const createdRequest = await requestsApi.create(created.id, {
        name: request.name,
        method: request.method,
        url: request.url,
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

  selectRequest: async (id) => {
    set((s) => {
      if (s.activeRequestId === id) return s;
      const nextIds = s.openRequestIds.includes(id)
        ? s.openRequestIds
        : [...s.openRequestIds, id];
      return { activeRequestId: id, openRequestIds: nextIds };
    });
    const request = await requestsApi.getById(id);
    set((s) => {
      const next = new Set(s.dirtyRequests);
      next.delete(id);
      return { activeRequest: request, dirtyRequests: next };
    });
  },

  closeRequest: (id) => {
    set((s) => {
      const nextIds = s.openRequestIds.filter((rid) => rid !== id);
      const isActive = s.activeRequestId === id;
      const newActiveId = isActive ? (nextIds[nextIds.length - 1] ?? null) : s.activeRequestId;

      // When closing the active tab, find the replacement request in the existing services tree
      let newActiveRequest: ApiRequest | null = null;
      if (isActive && newActiveId) {
        newActiveRequest = findRequestById(s.services, newActiveId);
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

  createRequest: async (serviceId, name, method) => {
    const request = await requestsApi.create(serviceId, { name, method, url: '' });
    set((s) => ({
      services: s.services.map((svc) =>
        svc.id === serviceId ? { ...svc, requests: [...svc.requests, request] } : svc
      ),
    }));
    return request;
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
      const source = (s.activeRequest?.id === id ? s.activeRequest : findRequestById(s.services, id));
      if (!source) return s;

      mergedRequest = mergeRequestPatch(source, data);

      return {
        activeRequest: s.activeRequest?.id === id ? mergedRequest : s.activeRequest,
        services: s.services.map((svc) => ({
          ...svc,
          requests: svc.requests.map((r) => (r.id === id ? mergeRequestPatch(r, data) : r)),
        })),
      };
    });

    if (!mergedRequest) return;

    const currentVersion = (requestSaveVersions.get(id) ?? 0) + 1;
    requestSaveVersions.set(id, currentVersion);

    const existingTimer = requestSaveTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      try {
        const state = get();
        const latest = state.activeRequest?.id === id
          ? state.activeRequest
          : findRequestById(state.services, id);

        if (!latest) return;

        const updated = await requestsApi.update(id, buildUpdatePayload(latest));

        if (requestSaveVersions.get(id) !== currentVersion) {
          return;
        }

        // Preserve stable row IDs in the UI to avoid remount/focus loss while editing.
        const stableUpdated: ApiRequest = {
          ...updated,
          headers: latest.headers,
          params: latest.params,
          variables: latest.variables,
        };

        set((s) => {
          const next = new Set(s.dirtyRequests);
          next.delete(id);
          return {
            activeRequest: s.activeRequest?.id === id ? stableUpdated : s.activeRequest,
            services: s.services.map((svc) => ({
              ...svc,
              requests: svc.requests.map((r) => (r.id === id ? { ...r, ...stableUpdated } : r)),
            })),
            dirtyRequests: next,
          };
        });
      } catch (err) {
        console.error('Failed to persist request update', err);
      } finally {
        if (requestSaveVersions.get(id) === currentVersion) {
          requestSaveTimers.delete(id);
        }
      }
    }, 350);

    requestSaveTimers.set(id, timer);
  },

  duplicateRequest: async (id) => {
    const duplicated = await requestsApi.duplicate(id);
    set((s) => ({
      services: s.services.map((svc) =>
        svc.id === duplicated.serviceId
          ? { ...svc, requests: [...svc.requests, duplicated] }
          : svc
      ),
    }));
    return duplicated;
  },

  deleteRequest: async (id) => {
    await requestsApi.delete(id);
    set((s) => {
      const nextIds = s.openRequestIds.filter((rid) => rid !== id);
      const isActive = s.activeRequestId === id;
      const responses = { ...s.responses };
      delete responses[id];
      return {
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

  toggleFavorite: async (id) => {
    await requestsApi.toggleFavorite(id);
    set((s) => ({
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
    if (!activeRequest) return;

    const abortController = new AbortController();
    set((s) => ({ sending: true, abortController, responses: { ...s.responses, [activeRequest.id]: null } }));

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
      set((state) => ({
        responses: { ...state.responses, [activeRequest.id]: response },
        sending: false,
        abortController: null,
        runtimeScriptVariablesByRequest: {
          ...state.runtimeScriptVariablesByRequest,
          [activeRequest.id]: response.scriptVariables ?? {},
        },
      }));
      window.dispatchEvent(new CustomEvent('history:updated'));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'CanceledError') {
        set({ sending: false, abortController: null });
      } else {
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
              error: err instanceof Error ? err.message : 'Unknown error',
              isSoapFault: false,
              scriptVariables: {},
              scriptLogs: [],
              testResults: [],
            },
          },
          sending: false,
          abortController: null,
        }));
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
          statusText: '',
          headers: parsedHeaders,
          body: entry.responseBody ?? '',
          contentType: parsedHeaders['Content-Type']?.[0] ?? parsedHeaders['content-type']?.[0] ?? '',
          responseTimeMs: entry.responseTimeMs,
          responseSizeBytes: entry.responseSizeBytes,
          isSoapFault: false,
          scriptVariables: {},
          scriptLogs: [],
          testResults: [],
        },
      },
    }));
  },

  cancelRequest: () => {
    const { abortController } = get();
    abortController?.abort();
    set({ sending: false, abortController: null });
  },

  clearResponse: (id: string) => set((s) => {
    const responses = { ...s.responses };
    delete responses[id];
    return { responses };
  }),

  isRequestDirty: (id: string) => get().dirtyRequests.has(id),

  clearDirtyRequest: (id: string) => {
    set((s) => {
      const next = new Set(s.dirtyRequests);
      next.delete(id);
      return { dirtyRequests: next };
    });
  },
}));
