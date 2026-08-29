import axios from 'axios';
import type {
  Workspace, Environment, Service, ApiRequest,
  ExecuteRequestPayload, ExecuteResponse, HistoryEntry,
  WorkspaceVariable, EnvironmentVariable, UpdateApiRequestPayload,
  ServiceVariable, ImportSpecificationRequest, ImportSpecificationResult,
  KeyValuePairRequest, AuthRequest, WorkspaceExport, ServiceExport, RequestExport,
  CurlParseResult, CodeSnippet, CollectionRunResult, DynamicValueDefinition,
  MockServer, CreateMockServerRequest, UpdateMockServerRequest,
  MockServerEndpoint, CreateMockEndpointRequest, UpdateMockEndpointRequest,
  AppSettings, SettingsUpdate, ApiRequestSettings, StoredRequestFile, ServiceFileResponse, JavaScriptRunResponse,
  CookieJarEntry, RequestFileUploadResponse,
  OAuth2Configuration, OAuthDiscoveryResponse, OAuthTokenExchangeResponse, OAuthTokenStatus,
} from '../types';

const api = axios.create({
  baseURL: '/api',
});

// Workspaces
export const workspacesApi = {
  getAll: () => api.get<Workspace[]>('/workspaces').then(r => r.data),
  getById: (id: string) => api.get<Workspace>(`/workspaces/${id}`).then(r => r.data),
  create: (name: string) => api.post<Workspace>('/workspaces', { name }).then(r => r.data),
  update: (id: string, name: string) => api.put<Workspace>(`/workspaces/${id}`, { name }).then(r => r.data),
  delete: (id: string) => api.delete(`/workspaces/${id}`),
};

// Environments
export const environmentsApi = {
  getAll: (workspaceId: string) =>
    api.get<Environment[]>(`/workspaces/${workspaceId}/environments`).then(r => r.data),
  create: (workspaceId: string, name: string) =>
    api.post<Environment>(`/workspaces/${workspaceId}/environments`, { name }).then(r => r.data),
  update: (workspaceId: string, id: string, name: string) =>
    api.put<Environment>(`/workspaces/${workspaceId}/environments/${id}`, { name }).then(r => r.data),
  activate: (workspaceId: string, id: string) =>
    api.post(`/workspaces/${workspaceId}/environments/${id}/activate`),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/workspaces/${workspaceId}/environments/${id}`),
  upsertVariable: (workspaceId: string, envId: string, data: { key: string; value: string; isSecret: boolean; enabled: boolean }) =>
    api.put<EnvironmentVariable>(`/workspaces/${workspaceId}/environments/${envId}/variables`, data).then(r => r.data),
  deleteVariable: (workspaceId: string, envId: string, variableId: string) =>
    api.delete(`/workspaces/${workspaceId}/environments/${envId}/variables/${variableId}`),
};

// Services
export const servicesApi = {
  getAll: (workspaceId: string) =>
    api.get<Service[]>(`/workspaces/${workspaceId}/services?includeRequests=true`).then(r => r.data),
  create: (
    workspaceId: string,
    name: string,
    description: string = '',
    headers: KeyValuePairRequest[] = [],
    auth: AuthRequest | null = null,
    storagePath?: string,
  ) =>
    api.post<Service>(`/workspaces/${workspaceId}/services`, { name, description, headers, auth, storagePath }).then(r => r.data),
  update: (
    workspaceId: string,
    id: string,
    name: string,
    description: string,
    headers: KeyValuePairRequest[] = [],
    auth: AuthRequest | null = null,
  ) =>
    api.put<Service>(`/workspaces/${workspaceId}/services/${id}`, { name, description, headers, auth }).then(r => r.data),
  reorder: (workspaceId: string, serviceIds: string[]) =>
    api.put(`/workspaces/${workspaceId}/services/reorder`, serviceIds),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/workspaces/${workspaceId}/services/${id}`),
};

// Requests
export const requestsApi = {
  upload: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return api.post<RequestFileUploadResponse>('/requests/' + id + '/uploads', form).then(r => r.data);
  },
  getById: (id: string) => api.get<ApiRequest>(`/requests/${id}`).then(r => r.data),
  create: (serviceId: string, data: { name: string; method: string; url: string }) =>
    api.post<ApiRequest>(`/requests/service/${serviceId}`, data).then(r => r.data),
  update: (id: string, data: UpdateApiRequestPayload) =>
    api.put<ApiRequest>(`/requests/${id}`, data).then(r => r.data),
  duplicate: (id: string) => api.post<ApiRequest>(`/requests/${id}/duplicate`).then(r => r.data),
  toggleFavorite: (id: string) => api.post(`/requests/${id}/favorite`),
  moveToService: (id: string, newServiceId: string) =>
    api.post(`/requests/${id}/move/${newServiceId}`),
  delete: (id: string) => api.delete(`/requests/${id}`),
  getFile: (id: string) => api.get<StoredRequestFile>(`/requests/${id}/file`).then(r => r.data),
  getSettings: (id: string) => api.get<ApiRequestSettings>(`/requests/${id}/settings`).then(r => r.data),
  saveSettings: (id: string, data: ApiRequestSettings) =>
    api.put<ApiRequestSettings>(`/requests/${id}/settings`, data).then(r => r.data),
};

export const serviceFilesApi = {
  list: (workspaceId: string, serviceId: string) =>
    api.get<ServiceFileResponse[]>(`/workspaces/${workspaceId}/services/${serviceId}/files`).then(r => r.data),
  create: (workspaceId: string, serviceId: string, name: string, kind: 'folder' | 'js') =>
    api.post<ServiceFileResponse>(`/workspaces/${workspaceId}/services/${serviceId}/files`, { name, kind }).then(r => r.data),
  save: (workspaceId: string, serviceId: string, fileName: string, content: string) =>
    api.put<void>(
      `/workspaces/${workspaceId}/services/${serviceId}/files/${encodeURIComponent(fileName)}`,
      { content },
    ),
  delete: (workspaceId: string, serviceId: string, fileName: string) =>
    api.delete(`/workspaces/${workspaceId}/services/${serviceId}/files/${encodeURIComponent(fileName)}`),
  run: (workspaceId: string, serviceId: string, fileName: string, code: string) =>
    api.post<JavaScriptRunResponse>(
      `/workspaces/${workspaceId}/services/${serviceId}/files/${encodeURIComponent(fileName)}/run`,
      { code },
    ).then(r => r.data),
};

// Execute
export const executeApi = {
  send: (payload: ExecuteRequestPayload, signal?: AbortSignal) =>
    api.post<ExecuteResponse>('/execute', payload, { signal }).then(r => r.data),
};

// OAuth2 / OIDC
export const oauthApi = {
  discover: (issuer: string) =>
    api.get<OAuthDiscoveryResponse>(`/oauth/discover`, { params: { issuer } }).then(r => r.data),
  exchangeCode: (data: {
    ownerKey: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    configuration: OAuth2Configuration;
  }) =>
    api.post<OAuthTokenExchangeResponse>(`/oauth/exchange`, data).then(r => r.data),
  status: (ownerKey: string) =>
    api.get<OAuthTokenStatus>(`/oauth/status`, { params: { ownerKey } }).then(r => r.data),
  disconnect: (ownerKey: string) =>
    api.delete(`/oauth/token`, { params: { ownerKey } }),
};

export const cookiesApi = {
  list: (workspaceId: string) =>
    api.get<CookieJarEntry[]>('/workspaces/' + workspaceId + '/cookies').then(r => r.data),
  clear: (workspaceId: string) =>
    api.delete('/workspaces/' + workspaceId + '/cookies'),
};

// Service Variables
export const serviceVariablesApi = {
  getAll: (serviceId: string) =>
    api.get<ServiceVariable[]>(`/services/${serviceId}/variables`).then(r => r.data),
  upsert: (
    serviceId: string,
    data: {
      id?: string;
      environmentId?: string | null;
      key: string;
      value: string;
      isSecret: boolean;
      enabled: boolean;
    }
  ) =>
    api.put<ServiceVariable>(`/services/${serviceId}/variables`, data).then(r => r.data),
  delete: (serviceId: string, id: string) =>
    api.delete(`/services/${serviceId}/variables/${id}`),
};

// History
export const historyApi = {
  getAll: (workspaceId: string, params?: { limit?: number; offset?: number; method?: string; status?: number; requestId?: string }) =>
    api.get<HistoryEntry[]>(`/workspaces/${workspaceId}/history`, { params }).then(r => r.data),
  getById: (workspaceId: string, id: string) =>
    api.get<HistoryEntry>(`/workspaces/${workspaceId}/history/${id}`).then(r => r.data),
  count: (workspaceId: string, requestId?: string) =>
    api.get<{ count: number }>(`/workspaces/${workspaceId}/history/count`, { params: { requestId } }).then(r => r.data),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/workspaces/${workspaceId}/history/${id}`),
  clearAll: (workspaceId: string) =>
    api.delete(`/workspaces/${workspaceId}/history`),
  clearForRequest: (workspaceId: string, requestId: string) =>
    api.delete<{ deleted: number }>(`/workspaces/${workspaceId}/history/request/${requestId}`).then(r => r.data),
};

// Workspace Variables
export const workspaceVariablesApi = {
  getAll: (workspaceId: string) =>
    api.get<WorkspaceVariable[]>(`/workspaces/${workspaceId}/variables`).then(r => r.data),
  upsert: (
    workspaceId: string,
    data: {
      id?: string;
      environmentId?: string | null;
      key: string;
      value: string;
      isSecret: boolean;
      enabled: boolean;
    }
  ) =>
    api.put<WorkspaceVariable>(`/workspaces/${workspaceId}/variables`, data).then(r => r.data),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/workspaces/${workspaceId}/variables/${id}`),
  getResolved: (workspaceId: string) =>
    api.get<Record<string, string>>(`/workspaces/${workspaceId}/variables/resolved`).then(r => r.data),
};

// Specification import
export const importsApi = {
  openApi: (workspaceId: string, data: ImportSpecificationRequest) =>
    api.post<ImportSpecificationResult>(`/workspaces/${workspaceId}/imports/openapi`, data).then(r => r.data),
  wsdl: (workspaceId: string, data: ImportSpecificationRequest) =>
    api.post<ImportSpecificationResult>(`/workspaces/${workspaceId}/imports/wsdl`, data).then(r => r.data),
  postman: (workspaceId: string, data: ImportSpecificationRequest) =>
    api.post<ImportSpecificationResult>(`/workspaces/${workspaceId}/imports/postman`, data).then(r => r.data),
  bruno: (workspaceId: string, files: File[], serviceId?: string, serviceName?: string) => {
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    if (serviceId) form.append('serviceId', serviceId);
    if (serviceName) form.append('serviceName', serviceName);
    return api.post<ImportSpecificationResult>(`/workspaces/${workspaceId}/imports/bruno`, form).then(r => r.data);
  },
};

// Export / Import
export const exportImportApi = {
  export: (workspaceId: string) =>
    api.get<WorkspaceExport>(`/workspaces/${workspaceId}/export`).then(r => r.data),
  exportService: (serviceId: string) =>
    api.get<ServiceExport>(`/services/${serviceId}/export`).then(r => r.data),
  exportRequest: (requestId: string) =>
    api.get<RequestExport>(`/requests/${requestId}/export`).then(r => r.data),
  import: (data: WorkspaceExport) =>
    api.post<Workspace>('/workspaces/import', data).then(r => r.data),
  importInto: (workspaceId: string, data: WorkspaceExport) =>
    api.post(`/workspaces/${workspaceId}/import`, data),
};

// Tools: cURL & Snippets

export const toolsApi = {
  parseCurl: (curl: string) =>
    api.post<CurlParseResult>('/tools/curl/parse', { curl }).then(r => r.data),
  generateCurl: (payload: ExecuteRequestPayload) =>
    api.post<{ curl: string }>('/tools/curl/generate', payload).then(r => r.data),
  generateSnippets: (payload: {
    method: string;
    url: string;
    body?: string | null;
    bodyType: string;
    headers: KeyValuePairRequest[];
    params?: KeyValuePairRequest[];
    variables?: { key: string; value: string; enabled: boolean }[];
    auth?: AuthRequest | null;
    workspaceId?: string;
    serviceId?: string;
    requestId?: string;
    language?: string;
  }) =>
    api.post<CodeSnippet[]>('/tools/snippets', payload).then(r => r.data),
  getDynamicValues: () =>
    api.get<DynamicValueDefinition[]>('/tools/dynamic-values').then(r => r.data),
};

// Collection Runner

export const collectionRunnerApi = {
  runService: (serviceId: string, stopOnFailure?: boolean) =>
    api.post<CollectionRunResult>(`/services/${serviceId}/run`, { stopOnFailure }).then(r => r.data),
};

// Mock Servers

export const mockServersApi = {
  getAll: (workspaceId: string) =>
    api.get<MockServer[]>(`/workspaces/${workspaceId}/mockservers?includeEndpoints=true`).then(r => r.data),
  getById: (workspaceId: string, id: string) =>
    api.get<MockServer>(`/workspaces/${workspaceId}/mockservers/${id}`).then(r => r.data),
  create: (workspaceId: string, data: CreateMockServerRequest) =>
    api.post<MockServer>(`/workspaces/${workspaceId}/mockservers`, data).then(r => r.data),
  update: (workspaceId: string, id: string, data: UpdateMockServerRequest) =>
    api.put<MockServer>(`/workspaces/${workspaceId}/mockservers/${id}`, data).then(r => r.data),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/workspaces/${workspaceId}/mockservers/${id}`),
  start: (workspaceId: string, id: string) =>
    api.post<{ isRunning: boolean }>(`/workspaces/${workspaceId}/mockservers/${id}/start`).then(r => r.data),
  stop: (workspaceId: string, id: string) =>
    api.post<{ isRunning: boolean }>(`/workspaces/${workspaceId}/mockservers/${id}/stop`).then(r => r.data),

  // Endpoints
  getEndpoints: (workspaceId: string, mockServerId: string) =>
    api.get<MockServerEndpoint[]>(`/workspaces/${workspaceId}/mockservers/${mockServerId}/endpoints`).then(r => r.data),
  createEndpoint: (workspaceId: string, mockServerId: string, data: CreateMockEndpointRequest) =>
    api.post<MockServerEndpoint>(`/workspaces/${workspaceId}/mockservers/${mockServerId}/endpoints`, data).then(r => r.data),
  updateEndpoint: (workspaceId: string, mockServerId: string, endpointId: string, data: UpdateMockEndpointRequest) =>
    api.put<MockServerEndpoint>(`/workspaces/${workspaceId}/mockservers/${mockServerId}/endpoints/${endpointId}`, data).then(r => r.data),
  deleteEndpoint: (workspaceId: string, mockServerId: string, endpointId: string) =>
    api.delete(`/workspaces/${workspaceId}/mockservers/${mockServerId}/endpoints/${endpointId}`),
};

// Settings
export const settingsApi = {
  get: () => api.get<AppSettings>('/settings').then(r => r.data),
  update: (payload: SettingsUpdate) =>
    api.put<AppSettings>('/settings', payload).then(r => r.data),
  clearHistory: () =>
    api.delete<{ deleted: number }>('/settings/history').then(r => r.data),
  generateExamples: () =>
    api.post<{ workspaceId: string; name: string; message: string }>('/settings/examples').then(r => r.data),
  clearAllData: () =>
    api.delete<{ deleted: number; message: string }>('/settings/data').then(r => r.data),
};
