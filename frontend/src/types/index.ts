export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  id: string;
  workspaceId: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  variables: EnvironmentVariable[];
}

export interface EnvironmentVariable {
  id: string;
  environmentId: string;
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
}

export interface Service {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  storagePath: string;
  sortOrder: number;
  createdAt: string;
  headers: KeyValueEntry[];
  auth: ServiceAuth | null;
  folders: RequestFolder[];
  requests: ApiRequest[];
}

export interface RequestFolder {
  id: string;
  serviceId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
}

export interface ServiceAuth {
  id: string;
  serviceId: string;
  authType: AuthType;
  configJson: string;
}

export interface ServiceVariable {
  id: string;
  serviceId: string;
  environmentId?: string | null;
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
}

export interface ApiRequest {
  id: string;
  serviceId: string;
  folderId: string | null;
  name: string;
  method: HttpMethod;
  url: string;
  body: string | null;
  bodyType: BodyType;
  preRequestScript: string;
  postRequestScript: string;
  testScript: string;
  notes: string;
  sortOrder: number;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  headers: KeyValueEntry[];
  params: KeyValueEntry[];
  variables: RequestVariable[];
  auth: RequestAuth | null;
}

export interface KeyValueEntry {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface RequestAuth {
  id: string;
  requestId: string;
  authType: AuthType;
  configJson: string;
}

export interface RequestVariable {
  id: string;
  requestId: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface WorkspaceVariable {
  id: string;
  workspaceId: string;
  environmentId?: string | null;
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
}

export interface ExecuteRequestPayload {
  method: string;
  url: string;
  body?: string | null;
  bodyType: string;
  preRequestScript?: string | null;
  postRequestScript?: string | null;
  testScript?: string | null;
  headers: KeyValuePairRequest[];
  params: KeyValuePairRequest[];
  variables: RequestVariableRequest[];
  auth?: AuthRequest | null;
  workspaceId?: string;
  serviceId?: string;
  requestId?: string;
  ignoreSslErrors?: boolean;
  mtls?: MtlsConfig | null;
}

export interface RequestFileUploadResponse {
  filePath: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface MultipartFormField {
  name: string;
  kind: 'text' | 'file';
  value: string;
  filePath: string;
  fileName: string;
  contentType: string;
  enabled: boolean;
}

export interface KeyValuePairRequest {
  key: string;
  value: string;
  enabled: boolean;
}

export interface AuthRequest {
  authType: string;
  configJson: string;
}

export interface OAuth2Configuration {
  authorizationUrl: string;
  tokenUrl: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  redirectUri: string;
  audience: string;
  clientAuthenticationMethod: 'client_secret_post' | 'client_secret_basic';
}

export interface OAuthTokenExchangeResponse {
  connected: boolean;
  tokenType: string;
  expiresAt?: string;
  hasRefreshToken: boolean;
}

export interface OAuthTokenStatus {
  connected: boolean;
  expiresAt?: string;
  hasRefreshToken: boolean;
}

export interface OAuthDiscoveryResponse {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint?: string;
  scopesSupported: string[];
}

export interface RequestVariableRequest {
  key: string;
  value: string;
  enabled: boolean;
}

export interface UpdateApiRequestPayload {
  name: string;
  method: HttpMethod;
  url: string;
  body: string | null;
  bodyType: BodyType;
  preRequestScript: string;
  postRequestScript: string;
  testScript: string;
  notes: string;
  headers: KeyValuePairRequest[];
  params: KeyValuePairRequest[];
  variables: RequestVariableRequest[];
  auth?: AuthRequest | null;
}

export interface ImportSpecificationRequest {
  sourceType: 'url' | 'raw';
  source: string;
  serviceId?: string | null;
  serviceName?: string | null;
}

export interface ImportSpecificationResult {
  serviceId: string;
  createdRequests: number;
  warnings: string[];
}

export interface MtlsConfig {
  certPath: string;
  keyPath: string;
  caPath?: string;
}

export interface ExecuteResponse {
  statusCode: number;
  statusText: string;
  headers: Record<string, string[]>;
  body: string;
  contentType: string;
  responseTimeMs: number;
  responseSizeBytes: number;
  isTruncated?: boolean;
  error?: string;
  isSoapFault: boolean;
  soapFault?: SoapFaultInfo;
  scriptVariables: Record<string, RuntimeScriptVariable>;
  scriptLogs: string[];
  testResults: TestResult[];
}

export interface RuntimeScriptVariable {
  value: string;
  source: string;
}

export interface SoapFaultInfo {
  faultCode: string;
  faultString: string;
  detail?: string;
}

export interface HistoryEntry {
  id: string;
  requestId?: string;
  workspaceId: string;
  method: string;
  url: string;
  requestHeadersJson?: string;
  requestBody?: string;
  responseStatus: number;
  responseHeadersJson?: string;
  responseBody?: string;
  responseTimeMs: number;
  responseSizeBytes: number;
  executedAt: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export type BodyType = 'none' | 'json' | 'xml' | 'text' | 'form' | 'multipart';
export type AuthType = 'none' | 'basic' | 'bearer' | 'apikey' | 'oauth2' | 'mtls';

export interface CookieJarEntry {
  name: string;
  domain: string;
  path: string;
  expiresAt?: string;
  secure: boolean;
  httpOnly: boolean;
}

// Mock Server types

export interface MockServer {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  slug: string;
  port: number;
  isRunning: boolean;
  createdAt: string;
  updatedAt: string;
  endpoints: MockServerEndpoint[];
}

export interface MockServerEndpoint {
  id: string;
  mockServerId: string;
  method: HttpMethod;
  path: string;
  statusCode: number;
  contentType: string;
  responseBody: string;
  responseHeadersJson: string;
  scriptEnabled: boolean;
  script: string;
  behavior: MockEndpointBehavior;
  behaviorConfigJson: string;
  delayMs: number;
  sortOrder: number;
  createdAt: string;
}

export type MockEndpointBehavior =
  | 'static'
  | 'oauth2-authorization'
  | 'oauth2-token'
  | 'oidc-discovery'
  | 'oidc-userinfo'
  | 'oidc-jwks';

export interface CreateMockServerRequest {
  name: string;
  description: string;
  slug: string;
  port: number;
}

export interface UpdateMockServerRequest {
  name: string;
  description: string;
  slug: string;
  port: number;
}

export interface CreateMockEndpointRequest {
  method: HttpMethod;
  path: string;
  statusCode: number;
  contentType: string;
  responseBody: string;
  responseHeaders: KeyValuePairRequest[];
  scriptEnabled: boolean;
  script: string;
  behavior: MockEndpointBehavior;
  behaviorConfigJson: string;
  delayMs: number;
}

export interface UpdateMockEndpointRequest {
  method: HttpMethod;
  path: string;
  statusCode: number;
  contentType: string;
  responseBody: string;
  responseHeaders: KeyValuePairRequest[];
  scriptEnabled: boolean;
  script: string;
  behavior: MockEndpointBehavior;
  behaviorConfigJson: string;
  delayMs: number;
}

// Export/Import types
export interface WorkspaceExport {
  name: string;
  environments: EnvironmentExport[];
  workspaceVariables: WorkspaceVariable[];
  services: ServiceExport[];
  history: HistoryEntry[];
}

export interface EnvironmentExport {
  name: string;
  isActive: boolean;
  sortOrder: number;
  variables: EnvironmentVariableExport[];
}

export interface EnvironmentVariableExport {
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
}

export interface ServiceExport {
  name: string;
  description: string;
  sortOrder: number;
  headers: KeyValuePairRequest[];
  auth: AuthRequest | null;
  folders: RequestFolderExport[];
  variables: ServiceVariableExport[];
  requests: RequestExport[];
}

export interface ServiceVariableExport {
  environmentId?: string | null;
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
}

export interface RequestExport {
  name: string;
  method: string;
  url: string;
  body?: string | null;
  bodyType: string;
  preRequestScript: string;
  postRequestScript: string;
  notes: string;
  sortOrder: number;
  isFavorite: boolean;
  folderName?: string | null;
  headers: KeyValuePairRequest[];
  params: KeyValuePairRequest[];
  variables: RequestVariableRequest[];
  auth: AuthRequest | null;
}

// cURL / Snippets / Collection Runner

export interface CurlParseResult {
  method: string;
  url: string;
  headers: KeyValuePairRequest[];
  body?: string | null;
  bodyType: string;
  auth?: AuthRequest | null;
  serviceName?: string;
}

export interface CodeSnippet {
  language: string;
  client: string;
  code: string;
}

export interface RequestFolderExport {
  name: string;
  sortOrder: number;
}

export interface DynamicValueDefinition {
  name: string;
  signature: string;
  aliases: string[];
  category: string;
  description: string;
  example: string;
  outputType: string;
}

export interface CollectionRunResult {
  serviceId: string;
  serviceName: string;
  folderId?: string | null;
  folderName?: string | null;
  totalRequests: number;
  passedRequests: number;
  failedRequests: number;
  totalTimeMs: number;
  results: CollectionRequestResult[];
}

export interface CollectionRequestResult {
  requestId: string;
  requestName: string;
  method: string;
  url: string;
  statusCode: number;
  responseTimeMs: number;
  passed: boolean;
  error?: string;
  tests: TestResult[];
}

export interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
}

// Settings
export type StorageMode = 'sqlite' | 'json';

export interface AppSettings {
  storageMode: StorageMode;
  storagePath: string;
  jsonStorageStrategy: JsonStorageStrategy;
  restartRequired: boolean;
  requestTimeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  ignoreSslErrors: boolean;
  maxResponseBodySizeMb: number;
  saveHistory: boolean;
  persistCookies: boolean;
  responseFormat: 'pretty' | 'raw';
  proxyEnabled: boolean;
  proxyUrl: string;
  proxyUsername: string;
  proxyPassword: string;
}

export type JsonStorageStrategy = 'single' | 'perCollection';

export type SettingsUpdate = Partial<
  Pick<
    AppSettings,
    | 'storageMode'
    | 'jsonStorageStrategy'
    | 'requestTimeoutMs'
    | 'followRedirects'
    | 'maxRedirects'
    | 'ignoreSslErrors'
    | 'maxResponseBodySizeMb'
    | 'saveHistory'
    | 'persistCookies'
    | 'responseFormat'
    | 'proxyEnabled'
    | 'proxyUrl'
    | 'proxyUsername'
    | 'proxyPassword'
  >
>;

export interface ApiRequestSettings {
  requestId: string;
  followRedirects: boolean;
  maxRedirects: number;
  ignoreSslErrors: boolean;
  timeoutSeconds: number | null;
  proxyMode: RequestProxyMode;
  proxyUrl: string;
  proxyUsername: string;
  proxyPassword: string;
}

export type RequestProxyMode = 'inherit' | 'custom' | 'disabled';

export interface StoredRequestFile {
  requestId: string;
  filePath: string;
  content: string;
  isJsonStorage: boolean;
}

export interface ServiceFileResponse {
  path: string;
  name: string;
  content: string;
}

export interface JavaScriptRunResponse {
  success: boolean;
  logs: string[];
  result?: string | null;
  error?: string | null;
}
