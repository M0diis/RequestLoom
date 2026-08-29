import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DocumentationSection } from '../../stores/uiStore';

interface DocumentationPageProps {
  section: DocumentationSection;
  onSectionChange: (section: DocumentationSection) => void;
}

const SECTION_META: Record<DocumentationSection, { label: string; eyebrow: string; title: string; description: string }> = {
  overview: {
    label: 'Overview',
    eyebrow: 'REQUESTLOOM / GUIDE',
    title: 'Build better requests, faster.',
    description: 'A focused field guide to HTTP, RequestLoom’s workspace model, and the tools that turn one request into a repeatable workflow.',
  },
  http: {
    label: 'HTTP reference',
    eyebrow: 'HTTP / REFERENCE',
    title: 'The protocol, at a glance.',
    description: 'Methods describe intent. Status codes describe the result. Use this page when you need a quick, practical reminder while building a request.',
  },
  requestloom: {
    label: 'How RequestLoom works',
    eyebrow: 'REQUESTLOOM / MENTAL MODEL',
    title: 'One workspace. Every part of the loop.',
    description: 'RequestLoom keeps setup, execution, inspection, and repeatability close together so you can move from an idea to a reliable API check without changing tools.',
  },
  automation: {
    label: 'Automation',
    eyebrow: 'REQUESTLOOM / AUTOMATION',
    title: 'Turn a request into a workflow.',
    description: 'Reuse values, prepare requests, assert responses, run collections, and mock endpoints without leaving the app.',
  },
};

const SECTIONS = Object.keys(SECTION_META) as DocumentationSection[];

const METHODS = [
  { method: 'GET', purpose: 'Retrieve a representation', safe: true, idempotent: true, body: 'Usually no', detail: 'Use for reads and queries. A successful response commonly returns 200 or 206.' },
  { method: 'POST', purpose: 'Create or trigger an action', safe: false, idempotent: false, body: 'Often', detail: 'Use when the server creates a resource or performs a non-idempotent action. Common success codes are 201 or 202.' },
  { method: 'PUT', purpose: 'Create or replace a resource', safe: false, idempotent: true, body: 'Often', detail: 'Sending the same request repeatedly should leave the resource in the same state.' },
  { method: 'PATCH', purpose: 'Partially update a resource', safe: false, idempotent: 'Usually', body: 'Often', detail: 'Send only the fields being changed. Idempotency depends on the patch operation.' },
  { method: 'DELETE', purpose: 'Remove a resource', safe: false, idempotent: true, body: 'Rarely', detail: 'A repeated delete normally has the same intended result: the resource is absent.' },
  { method: 'HEAD', purpose: 'Read headers without a body', safe: true, idempotent: true, body: 'No', detail: 'Useful for checking existence, metadata, caching, or size before downloading a representation.' },
  { method: 'OPTIONS', purpose: 'Discover supported communication', safe: true, idempotent: true, body: 'Rarely', detail: 'Often used for capability discovery and CORS preflight requests.' },
] as const;

const HEADER_CATEGORIES = ['all', 'Request', 'Representation', 'Response', 'Caching', 'Conditional', 'Cookies', 'CORS', 'Proxy'] as const;

const HEADERS = [
  { name: 'Accept', category: 'Request', direction: 'request', meaning: 'Media types the client can process.', example: 'application/json' },
  { name: 'Accept-Charset', category: 'Request', direction: 'request', meaning: 'Character encodings the client supports.', example: 'utf-8' },
  { name: 'Accept-Encoding', category: 'Request', direction: 'request', meaning: 'Content encodings the client supports.', example: 'gzip, br' },
  { name: 'Accept-Language', category: 'Request', direction: 'request', meaning: 'Preferred natural languages for the response.', example: 'en-US,en;q=0.9' },
  { name: 'Authorization', category: 'Request', direction: 'request', meaning: 'Credentials for authenticating the request.', example: 'Bearer <token>' },
  { name: 'Cache-Control', category: 'Caching', direction: 'both', meaning: 'Caching directives for a request or response.', example: 'no-cache' },
  { name: 'Connection', category: 'Proxy', direction: 'both', meaning: 'Connection-specific options such as keep-alive.', example: 'keep-alive' },
  { name: 'Content-Disposition', category: 'Representation', direction: 'response', meaning: 'How a representation should be displayed or downloaded.', example: 'attachment; filename="report.csv"' },
  { name: 'Content-Encoding', category: 'Representation', direction: 'both', meaning: 'Encoding applied to the representation body.', example: 'gzip' },
  { name: 'Content-Language', category: 'Representation', direction: 'both', meaning: 'Natural language of the representation.', example: 'en-US' },
  { name: 'Content-Length', category: 'Representation', direction: 'both', meaning: 'Body size in bytes.', example: '1024' },
  { name: 'Content-Location', category: 'Representation', direction: 'both', meaning: 'A more specific location for the representation.', example: '/users/42' },
  { name: 'Content-Range', category: 'Representation', direction: 'response', meaning: 'The byte range returned in a partial response.', example: 'bytes 0-1023/4096' },
  { name: 'Content-Type', category: 'Representation', direction: 'both', meaning: 'Media type and optional parameters of the body.', example: 'application/json; charset=utf-8' },
  { name: 'Cookie', category: 'Cookies', direction: 'request', meaning: 'Cookies sent back to the server.', example: 'session=abc123' },
  { name: 'Date', category: 'Response', direction: 'response', meaning: 'Date and time the message was created.', example: 'Tue, 15 Nov 1994 08:12:31 GMT' },
  { name: 'ETag', category: 'Conditional', direction: 'response', meaning: 'Opaque version identifier for a representation.', example: '"v7-4f2a"' },
  { name: 'Expect', category: 'Request', direction: 'request', meaning: 'Expectation the server should fulfill.', example: '100-continue' },
  { name: 'Host', category: 'Request', direction: 'request', meaning: 'Target host and optional port.', example: 'api.example.com' },
  { name: 'If-Match', category: 'Conditional', direction: 'request', meaning: 'Only perform the request if the entity tag matches.', example: '"v7-4f2a"' },
  { name: 'If-Modified-Since', category: 'Conditional', direction: 'request', meaning: 'Return a body only when the resource changed after this date.', example: 'Wed, 21 Oct 2015 07:28:00 GMT' },
  { name: 'If-None-Match', category: 'Conditional', direction: 'request', meaning: 'Return a body only when the entity tag does not match.', example: '"v7-4f2a"' },
  { name: 'If-Range', category: 'Conditional', direction: 'request', meaning: 'Use a range only when the validator still matches.', example: '"v7-4f2a"' },
  { name: 'If-Unmodified-Since', category: 'Conditional', direction: 'request', meaning: 'Only perform the request if unchanged since this date.', example: 'Wed, 21 Oct 2015 07:28:00 GMT' },
  { name: 'Last-Modified', category: 'Conditional', direction: 'response', meaning: 'Date the representation was last changed.', example: 'Wed, 21 Oct 2015 07:28:00 GMT' },
  { name: 'Location', category: 'Response', direction: 'response', meaning: 'URL to follow or location of a newly created resource.', example: '/users/42' },
  { name: 'Origin', category: 'CORS', direction: 'request', meaning: 'Origin that initiated a cross-origin request.', example: 'https://app.example.com' },
  { name: 'Pragma', category: 'Caching', direction: 'both', meaning: 'Legacy cache directive, commonly no-cache.', example: 'no-cache' },
  { name: 'Range', category: 'Request', direction: 'request', meaning: 'Requests part of a representation.', example: 'bytes=0-1023' },
  { name: 'Referer', category: 'Request', direction: 'request', meaning: 'URL of the resource that led to this request.', example: 'https://app.example.com/' },
  { name: 'Retry-After', category: 'Response', direction: 'response', meaning: 'How long to wait before retrying a request.', example: '120' },
  { name: 'Server', category: 'Response', direction: 'response', meaning: 'Information about the server software.', example: 'api-gateway' },
  { name: 'Set-Cookie', category: 'Cookies', direction: 'response', meaning: 'Creates or updates a cookie in the client.', example: 'session=abc123; Secure; HttpOnly' },
  { name: 'Transfer-Encoding', category: 'Proxy', direction: 'both', meaning: 'Transfer coding used for the message body.', example: 'chunked' },
  { name: 'Upgrade', category: 'Proxy', direction: 'both', meaning: 'Requests or confirms a protocol switch.', example: 'websocket' },
  { name: 'User-Agent', category: 'Request', direction: 'request', meaning: 'Client software identification.', example: 'RequestLoom/1.0' },
  { name: 'Vary', category: 'Caching', direction: 'response', meaning: 'Request fields that influence the selected representation.', example: 'Accept-Encoding' },
  { name: 'Via', category: 'Proxy', direction: 'both', meaning: 'Proxies or gateways a message passed through.', example: '1.1 proxy.example.com' },
  { name: 'WWW-Authenticate', category: 'Response', direction: 'response', meaning: 'Authentication schemes accepted by the server.', example: 'Bearer realm="api"' },
  { name: 'Access-Control-Allow-Credentials', category: 'CORS', direction: 'response', meaning: 'Whether the browser may expose a response to credentialed requests.', example: 'true' },
  { name: 'Access-Control-Allow-Headers', category: 'CORS', direction: 'response', meaning: 'Headers permitted in a CORS request.', example: 'Authorization, Content-Type' },
  { name: 'Access-Control-Allow-Methods', category: 'CORS', direction: 'response', meaning: 'Methods permitted in a CORS request.', example: 'GET, POST, OPTIONS' },
  { name: 'Access-Control-Allow-Origin', category: 'CORS', direction: 'response', meaning: 'Origins permitted to read the response.', example: 'https://app.example.com' },
  { name: 'Access-Control-Expose-Headers', category: 'CORS', direction: 'response', meaning: 'Response headers browser code may read.', example: 'X-Request-ID' },
  { name: 'Access-Control-Max-Age', category: 'CORS', direction: 'response', meaning: 'How long a preflight result may be cached.', example: '86400' },
  { name: 'Access-Control-Request-Headers', category: 'CORS', direction: 'request', meaning: 'Headers requested during a CORS preflight.', example: 'Authorization, Content-Type' },
  { name: 'Access-Control-Request-Method', category: 'CORS', direction: 'request', meaning: 'Method requested during a CORS preflight.', example: 'POST' },
  { name: 'X-Correlation-ID', category: 'Proxy', direction: 'both', meaning: 'Application trace identifier used across services.', example: '4f2a-91c0' },
  { name: 'X-Forwarded-For', category: 'Proxy', direction: 'request', meaning: 'Original client IP forwarded by a proxy.', example: '203.0.113.42' },
  { name: 'X-Forwarded-Host', category: 'Proxy', direction: 'request', meaning: 'Original host requested by the client.', example: 'api.example.com' },
  { name: 'X-Forwarded-Proto', category: 'Proxy', direction: 'request', meaning: 'Original protocol used by the client.', example: 'https' },
  { name: 'X-API-Key', category: 'Request', direction: 'request', meaning: 'Common custom header name for an API key.', example: 'your-api-key' },
  { name: 'X-Request-ID', category: 'Proxy', direction: 'both', meaning: 'Request identifier for logs and diagnostics.', example: 'req_01HZX...' },
  { name: 'X-Requested-With', category: 'Request', direction: 'request', meaning: 'Legacy hint often used to identify XMLHttpRequest clients.', example: 'XMLHttpRequest' },
] as const;

const AUTH_TYPES = [
  { name: 'Inherit', where: 'request only', description: 'Use the service’s default authorization. This is the default request behavior when no request-level auth is saved.', fields: 'Service auth' },
  { name: 'None', where: 'request + service', description: 'Send no authorization and ignore service defaults for this request.', fields: 'None' },
  { name: 'Basic', where: 'request + service', description: 'Send a username and password using the HTTP Basic Authorization scheme.', fields: 'Username, password' },
  { name: 'Bearer Token', where: 'request + service', description: 'Send a token as Authorization: Bearer <token>. Values can use variables.', fields: 'Token' },
  { name: 'API Key', where: 'request + service', description: 'Send a named key/value pair as either a header or a query parameter.', fields: 'Key name, value, Header / Query' },
  { name: 'OAuth2 / OIDC', where: 'request + service', description: 'Connect through an authorization-code flow with PKCE S256. OIDC discovery can fill the provider endpoints.', fields: 'Issuer, URLs, client, scopes, redirect URI' },
  { name: 'mTLS', where: 'execution payload', description: 'Mutual TLS uses a client certificate, private key, and optional CA path. The current auth selector does not expose it as a selectable pill.', fields: 'Certificate, key, optional CA' },
] as const;

const BUILT_IN_VARIABLES = [
  { category: 'Identity and time', tokens: '{{$uuid}} · {{$guid}} · {{$randomUUID}}', description: 'Random UUID. $guid and $randomUUID are aliases.' },
  { category: 'Identity and time', tokens: '{{$timestamp}}', description: 'Current Unix timestamp in seconds.' },
  { category: 'Identity and time', tokens: '{{$isoTimestamp}}', description: 'Current UTC timestamp in ISO 8601 format.' },
  { category: 'Identity and time', tokens: '{{$date("2026-01-01","2026-12-31")}}', description: 'Random date between two ISO dates.' },
  { category: 'Scalars', tokens: '{{$integer(1,100)}} · {{$randomInt(1,100)}}', description: 'Random integer. Defaults to 0–1000; $randomInt is an alias.' },
  { category: 'Scalars', tokens: '{{$decimal(0,100,2)}}', description: 'Random decimal with min, max, and decimal-place arguments. Defaults to 0–1000, 2 places.' },
  { category: 'Scalars', tokens: '{{$boolean}} · {{$randomBoolean}}', description: 'Random true/false value. $randomBoolean is an alias.' },
  { category: 'Strings', tokens: '{{$string(12)}}', description: 'Random alphabetic string. Defaults to 12 characters.' },
  { category: 'Strings', tokens: '{{$alphanumeric(16)}} · {{$randomAlphaNumeric(16)}}', description: 'Random alphanumeric string. Defaults to 1 character; the second form is an alias.' },
  { category: 'Strings', tokens: '{{$pick(["new","active","closed"])}}', description: 'Selects one string from a JSON array.' },
  { category: 'People and contact', tokens: '{{$firstName}} · {{$randomFirstName}}', description: 'Random first name; the second form is an alias.' },
  { category: 'People and contact', tokens: '{{$lastName}} · {{$randomLastName}}', description: 'Random last name; the second form is an alias.' },
  { category: 'People and contact', tokens: '{{$fullName}} · {{$randomFullName}}', description: 'Random full name; the second form is an alias.' },
  { category: 'People and contact', tokens: '{{$email}} · {{$randomEmail}}', description: 'Random email address; the second form is an alias.' },
  { category: 'People and contact', tokens: '{{$username}} · {{$randomUserName}}', description: 'Random username; the second form is an alias.' },
  { category: 'People and contact', tokens: '{{$phone}} · {{$randomPhoneNumber}}', description: 'Random phone number; the second form is an alias.' },
  { category: 'Location and text', tokens: '{{$streetAddress}} · {{$randomStreetAddress}}', description: 'Random street address; the second form is an alias.' },
  { category: 'Location and text', tokens: '{{$city}} · {{$randomCity}}', description: 'Random city; the second form is an alias.' },
  { category: 'Location and text', tokens: '{{$country}} · {{$randomCountry}}', description: 'Random country; the second form is an alias.' },
  { category: 'Location and text', tokens: '{{$word}} · {{$randomWord}}', description: 'Random word; the second form is an alias.' },
  { category: 'Location and text', tokens: '{{$words(3)}} · {{$randomWords(3)}}', description: 'Random group of words. Defaults to three; the second form is an alias.' },
  { category: 'Location and text', tokens: '{{$sentence(8)}} · {{$randomPhrase(8)}}', description: 'Random sentence. Defaults to eight words; the second form is an alias.' },
  { category: 'Location and text', tokens: '{{$paragraph(3)}}', description: 'Random paragraph. Defaults to three sentences.' },
] as const;

const STATUS_CODES = [
  { code: 100, name: 'Continue', group: '1xx', meaning: 'The server received the initial request and the client may continue.' },
  { code: 101, name: 'Switching Protocols', group: '1xx', meaning: 'The server agrees to switch protocols, commonly for an upgrade.' },
  { code: 200, name: 'OK', group: '2xx', meaning: 'The request succeeded.' },
  { code: 201, name: 'Created', group: '2xx', meaning: 'The request succeeded and created a resource.' },
  { code: 202, name: 'Accepted', group: '2xx', meaning: 'The request was accepted for processing, but processing is not complete.' },
  { code: 204, name: 'No Content', group: '2xx', meaning: 'The request succeeded and there is no response body.' },
  { code: 206, name: 'Partial Content', group: '2xx', meaning: 'The server is returning a requested range of a representation.' },
  { code: 301, name: 'Moved Permanently', group: '3xx', meaning: 'The resource has a new permanent URL.' },
  { code: 302, name: 'Found', group: '3xx', meaning: 'The resource is temporarily available at another URL.' },
  { code: 304, name: 'Not Modified', group: '3xx', meaning: 'A cached representation is still valid.' },
  { code: 307, name: 'Temporary Redirect', group: '3xx', meaning: 'Temporarily use another URL while preserving the method and body.' },
  { code: 308, name: 'Permanent Redirect', group: '3xx', meaning: 'Permanently use another URL while preserving the method and body.' },
  { code: 400, name: 'Bad Request', group: '4xx', meaning: 'The server cannot process the request syntax or input.' },
  { code: 401, name: 'Unauthorized', group: '4xx', meaning: 'Authentication is required or the supplied credentials are invalid.' },
  { code: 403, name: 'Forbidden', group: '4xx', meaning: 'The server understood the request but refuses to authorize it.' },
  { code: 404, name: 'Not Found', group: '4xx', meaning: 'The requested resource does not exist at this URL.' },
  { code: 405, name: 'Method Not Allowed', group: '4xx', meaning: 'The resource exists, but not for this HTTP method.' },
  { code: 408, name: 'Request Timeout', group: '4xx', meaning: 'The server timed out waiting for the request.' },
  { code: 409, name: 'Conflict', group: '4xx', meaning: 'The request conflicts with the current state of the resource.' },
  { code: 413, name: 'Content Too Large', group: '4xx', meaning: 'The request body is larger than the server is willing to process.' },
  { code: 415, name: 'Unsupported Media Type', group: '4xx', meaning: 'The server does not support the request body format.' },
  { code: 422, name: 'Unprocessable Content', group: '4xx', meaning: 'The input is understood but fails validation or business rules.' },
  { code: 429, name: 'Too Many Requests', group: '4xx', meaning: 'The client is being rate limited.' },
  { code: 500, name: 'Internal Server Error', group: '5xx', meaning: 'The server encountered an unexpected condition.' },
  { code: 501, name: 'Not Implemented', group: '5xx', meaning: 'The server does not support the functionality required.' },
  { code: 502, name: 'Bad Gateway', group: '5xx', meaning: 'A gateway or proxy received an invalid upstream response.' },
  { code: 503, name: 'Service Unavailable', group: '5xx', meaning: 'The server is temporarily unable to handle the request.' },
  { code: 504, name: 'Gateway Timeout', group: '5xx', meaning: 'A gateway or proxy did not receive an upstream response in time.' },
] as const;

const STATUS_GROUPS = ['all', '1xx', '2xx', '3xx', '4xx', '5xx'] as const;

const FEATURE_CARDS = [
  { title: 'Workspaces', text: 'Keep services, environments, variables, history, and mocks isolated by project or team.', target: 'requestloom' as DocumentationSection, icon: '◈' },
  { title: 'Request builder', text: 'Compose URL, params, headers, body, auth, files, and scripts from one request tab.', target: 'requestloom' as DocumentationSection, icon: '↗' },
  { title: 'Response inspector', text: 'Read formatted or raw bodies, headers, timing, size, script logs, and test results.', target: 'requestloom' as DocumentationSection, icon: '◌' },
  { title: 'Mock servers', text: 'Create a local route with a status, headers, body, delay, and optional response script.', target: 'automation' as DocumentationSection, icon: '◇' },
] as const;

const AUTOMATION_CARDS = [
  { title: 'Variables', text: 'Use {{variable}} in URLs, query parameters, headers, bodies, and scripts. Keep secrets scoped and reusable.', code: '{{base_url}}/users/{{user_id}}' },
  { title: 'Pre-request scripts', text: 'Run before the request to set variables, change the URL or method, and update headers, params, or body.', code: 'setHeader("Authorization", "Bearer " + getVar("token"));' },
  { title: 'Post-request scripts', text: 'Run after a response to extract values and prepare the next request in a chain.', code: 'setVar("user_id", JSON.parse(getResponseBody()).id);' },
  { title: 'Tests', text: 'Add named assertions that run after the response and appear beside the response details.', code: 'test("Created", () => expect(response.status).toBe(201));' },
] as const;

function DocIcon({ name }: { name: 'search' | 'arrow' | 'check' }) {
  const props = {
    className: 'h-4 w-4',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'search':
      return <svg {...props}><circle cx="10.8" cy="10.8" r="6.8" /><path d="M16 16l4.5 4.5" /></svg>;
    case 'arrow':
      return <svg {...props}><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
    case 'check':
      return <svg {...props}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
  }
}

function MethodBadge({ method }: { method: string }) {
  return <span className={`method-${method} inline-flex min-w-16 items-center justify-center border border-current/30 px-1.5 py-1 font-mono text-[10px] font-bold tracking-wide`}>{method}</span>;
}

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-5 border-b border-gray-800 pb-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ffbca3]">{eyebrow}</div>
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-gray-100">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function InfoCard({ title, text, icon, onClick }: { title: string; text: string; icon?: string; onClick?: () => void }) {
  const content = (
    <>
      {icon ? <div className="mb-4 text-lg text-[#ffbca3]">{icon}</div> : null}
      <div className="text-sm font-semibold text-gray-100">{title}</div>
      <div className="mt-1.5 text-xs leading-5 text-gray-500">{text}</div>
      {onClick ? <div className="mt-4 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 transition-colors group-hover:text-[#ffbca3]">Read section <DocIcon name="arrow" /></div> : null}
    </>
  );

  if (onClick) {
    return <button type="button" onClick={onClick} className="group border border-gray-800 bg-[#141414] p-4 text-left transition-colors hover:border-gray-600 hover:bg-[#181818]">{content}</button>;
  }
  return <div className="border border-gray-800 bg-[#141414] p-4">{content}</div>;
}

export function DocumentationPage({ section, onSectionChange }: DocumentationPageProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_GROUPS)[number]>('all');
  const [headerCategory, setHeaderCategory] = useState<(typeof HEADER_CATEGORIES)[number]>('all');
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const meta = SECTION_META[section];
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [section]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const sectionMatches = (candidate: DocumentationSection) => {
    if (!normalizedQuery) return true;
    const sectionData = candidate === 'http'
      ? `${METHODS.map((item) => `${item.method} ${item.purpose} ${item.detail}`).join(' ')} ${STATUS_CODES.map((item) => `${item.code} ${item.name} ${item.meaning}`).join(' ')} ${HEADERS.map((item) => `${item.name} ${item.meaning} ${item.example}`).join(' ')} ${AUTH_TYPES.map((item) => `${item.name} ${item.description}`).join(' ')}`
      : candidate === 'automation'
        ? `${AUTOMATION_CARDS.map((item) => `${item.title} ${item.text} ${item.code}`).join(' ')} ${BUILT_IN_VARIABLES.map((item) => `${item.category} ${item.tokens} ${item.description}`).join(' ')}`
        : '';
    const searchable = `${SECTION_META[candidate].label} ${SECTION_META[candidate].title} ${SECTION_META[candidate].description} ${candidate === 'overview' ? 'quick start build organize send inspect' : ''} ${candidate === 'requestloom' ? 'workspace environment service collection response history import export settings' : ''} ${sectionData}`;
    return searchable.toLowerCase().includes(normalizedQuery);
  };

  const filteredMethods = useMemo(() => {
    if (!normalizedQuery) return METHODS;
    return METHODS.filter((item) => `${item.method} ${item.purpose} ${item.detail} ${item.body}`.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery]);

  const filteredStatuses = useMemo(() => STATUS_CODES.filter((item) => {
    const groupMatches = statusFilter === 'all' || item.group === statusFilter;
    const queryMatches = !normalizedQuery || `${item.code} ${item.name} ${item.group} ${item.meaning}`.toLowerCase().includes(normalizedQuery);
    return groupMatches && queryMatches;
  }), [normalizedQuery, statusFilter]);

  const filteredHeaders = useMemo(() => HEADERS.filter((item) => {
    const categoryMatches = headerCategory === 'all' || item.category === headerCategory;
    const queryMatches = !normalizedQuery || `${item.name} ${item.category} ${item.direction} ${item.meaning} ${item.example}`.toLowerCase().includes(normalizedQuery);
    return categoryMatches && queryMatches;
  }), [headerCategory, normalizedQuery]);

  const goTo = (nextSection: DocumentationSection) => {
    onSectionChange(nextSection);
  };

  return (
    <div ref={contentRef} className="flex-1 overflow-y-auto bg-[#0d0d0d]">
      <div className="mx-auto min-h-full w-full max-w-[1180px] px-5 py-6 sm:px-8 lg:px-10">
        <header className="mb-7">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-600">
                <span className="h-1.5 w-1.5 bg-[#ff6c37]" />
                {meta.eyebrow}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-100 sm:text-3xl">{meta.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">{meta.description}</p>
            </div>
            <div className="relative w-full sm:w-64">
              <div className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-gray-400">
                <DocIcon name="search" />
              </div>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search docs"
                aria-label="Search documentation"
                className="w-full border border-gray-700 bg-[#141414] py-2 pl-9 pr-14 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-[#ff6c37]"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 border border-gray-700 px-1.5 py-0.5 font-mono text-[9px] text-gray-600">⌘ K</span>
              {normalizedQuery ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 border border-gray-700 bg-[#181818] p-1 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                  <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-gray-600">Matching sections</div>
                  {SECTIONS.filter((candidate) => sectionMatches(candidate)).map((candidate) => (
                    <button key={candidate} type="button" onClick={() => goTo(candidate)} className="block w-full px-2 py-1.5 text-left text-[10px] text-gray-400 hover:bg-gray-800 hover:text-gray-100">{SECTION_META[candidate].label}</button>
                  ))}
                  {SECTIONS.every((candidate) => !sectionMatches(candidate)) ? <div className="px-2 py-1.5 text-[10px] text-gray-600">No matching section</div> : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex gap-1 overflow-x-auto border-y border-gray-800 py-1 scrollbar-slim-x" aria-label="Documentation navigation">
            {SECTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => goTo(item)}
                className={`whitespace-nowrap px-3 py-1.5 text-[11px] font-medium transition-colors ${section === item ? 'bg-gray-800 text-gray-100' : 'text-gray-500 hover:bg-gray-900 hover:text-gray-300'}`}
              >
                {SECTION_META[item].label}
              </button>
            ))}
          </div>
        </header>

        {normalizedQuery && !sectionMatches(section) ? (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-amber-900/70 bg-amber-950/20 px-3 py-2.5 text-xs text-amber-200">
            <span>No exact match in {meta.label}. Search another section:</span>
            <div className="flex gap-1">
              {SECTIONS.filter((item) => sectionMatches(item)).map((item) => (
                <button key={item} type="button" onClick={() => goTo(item)} className="border border-amber-800/70 px-2 py-1 text-[10px] hover:bg-amber-900/30">{SECTION_META[item].label}</button>
              ))}
            </div>
          </div>
        ) : null}

        {section === 'overview' ? (
          <OverviewContent onSectionChange={goTo} />
        ) : null}

        {section === 'http' ? (
          <HttpContent
            methods={filteredMethods}
            statuses={filteredStatuses}
            headers={filteredHeaders}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            headerCategory={headerCategory}
            onHeaderCategoryChange={setHeaderCategory}
          />
        ) : null}

        {section === 'requestloom' ? <RequestLoomContent onSectionChange={goTo} /> : null}
        {section === 'automation' ? <AutomationContent /> : null}
      </div>
    </div>
  );
}

function OverviewContent({ onSectionChange }: { onSectionChange: (section: DocumentationSection) => void }) {
  return (
    <div className="space-y-7">
      <section className="grid gap-3 border border-gray-800 bg-[#141414] p-5 md:grid-cols-[1.25fr_1fr] md:p-6">
        <div>
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-600">The short version</div>
          <p className="max-w-xl text-base leading-7 text-gray-300">RequestLoom is a self-hosted API workbench. Store requests in collections, point them at the right environment, run them, then use the response to debug, document, or automate the next step.</p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-gray-800">
          {[
            ['01', 'Compose', 'URL, params, headers, body, auth'],
            ['02', 'Execute', 'Scripts and request settings'],
            ['03', 'Inspect', 'Body, headers, timing, tests'],
            ['04', 'Repeat', 'Variables, history, collections'],
          ].map(([number, title, text]) => (
            <div key={number} className="bg-[#111111] p-3">
              <div className="font-mono text-[10px] text-[#ffbca3]">{number}</div>
              <div className="mt-2 text-xs font-semibold text-gray-200">{title}</div>
              <div className="mt-1 text-[10px] leading-4 text-gray-600">{text}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-600">Start anywhere</div>
            <h2 className="mt-1 text-lg font-semibold text-gray-100">The useful parts, in one place.</h2>
          </div>
          <button type="button" onClick={() => onSectionChange('http')} className="hidden items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 hover:text-[#ffbca3] sm:flex">Browse HTTP reference <DocIcon name="arrow" /></button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURE_CARDS.map((card) => <InfoCard key={card.title} {...card} onClick={() => onSectionChange(card.target)} />)}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="border border-gray-800 bg-[#141414] p-5">
          <SectionHeading eyebrow="A good first request" title="Four small decisions." />
          <div className="space-y-3">
            {[
              ['01', 'Pick the method', 'Start with the action: read, create, replace, update, or remove.'],
              ['02', 'Set the URL', 'Use an environment variable for the host so the request travels cleanly between environments.'],
              ['03', 'Add only what matters', 'Headers, body, auth, and query parameters should describe the contract—not hide it.'],
              ['04', 'Check the response', 'Status, headers, body, timing, and tests together tell you what happened.'],
            ].map(([number, title, text]) => (
              <div key={number} className="flex gap-3 border-b border-gray-800/80 pb-3 last:border-0 last:pb-0">
                <span className="font-mono text-[10px] text-gray-600">{number}</span>
                <div><div className="text-xs font-semibold text-gray-200">{title}</div><div className="mt-1 text-xs leading-5 text-gray-500">{text}</div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="border border-gray-800 bg-[#141414] p-5">
          <SectionHeading eyebrow="Keep close" title="Useful syntax" />
          <div className="space-y-2 font-mono text-xs">
            <div className="flex items-center justify-between gap-4 border border-gray-800 bg-gray-950/50 px-3 py-2.5"><span className="text-[#ffbca3]">{'{{base_url}}'}</span><span className="text-right text-[10px] text-gray-600">variable interpolation</span></div>
            <div className="flex items-center justify-between gap-4 border border-gray-800 bg-gray-950/50 px-3 py-2.5"><span className="text-emerald-400">GET</span><span className="text-right text-[10px] text-gray-600">read a representation</span></div>
            <div className="flex items-center justify-between gap-4 border border-gray-800 bg-gray-950/50 px-3 py-2.5"><span className="text-sky-300">200 OK</span><span className="text-right text-[10px] text-gray-600">successful response</span></div>
            <div className="flex items-center justify-between gap-4 border border-gray-800 bg-gray-950/50 px-3 py-2.5"><span className="text-amber-300">401</span><span className="text-right text-[10px] text-gray-600">authentication problem</span></div>
          </div>
          <button type="button" onClick={() => onSectionChange('automation')} className="mt-4 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 hover:text-[#ffbca3]">See automation patterns <DocIcon name="arrow" /></button>
        </div>
      </section>
    </div>
  );
}

function HttpContent({
  methods,
  statuses,
  headers,
  statusFilter,
  onStatusFilterChange,
  headerCategory,
  onHeaderCategoryChange,
}: {
  methods: readonly (typeof METHODS)[number][];
  statuses: readonly (typeof STATUS_CODES)[number][];
  headers: readonly (typeof HEADERS)[number][];
  statusFilter: (typeof STATUS_GROUPS)[number];
  onStatusFilterChange: (filter: (typeof STATUS_GROUPS)[number]) => void;
  headerCategory: (typeof HEADER_CATEGORIES)[number];
  onHeaderCategoryChange: (category: (typeof HEADER_CATEGORIES)[number]) => void;
}) {
  return (
    <div className="space-y-7">
      <section>
        <SectionHeading eyebrow="Methods" title="What are you asking the server to do?">
          <span className="hidden text-[10px] text-gray-600 sm:block">Safe ≠ authenticated</span>
        </SectionHeading>
        <div className="overflow-x-auto border border-gray-800">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="bg-[#181818] text-[10px] uppercase tracking-wide text-gray-600">
              <tr><th className="px-3 py-2.5 font-semibold">Method</th><th className="px-3 py-2.5 font-semibold">Intent</th><th className="px-3 py-2.5 font-semibold">Request body</th><th className="px-3 py-2.5 font-semibold">Semantics</th><th className="px-3 py-2.5 font-semibold">Notes</th></tr>
            </thead>
            <tbody>
              {methods.map((item) => (
                <tr key={item.method} className="border-t border-gray-800/80 align-top hover:bg-gray-900/40">
                  <td className="px-3 py-3"><MethodBadge method={item.method} /></td>
                  <td className="px-3 py-3 text-xs font-medium text-gray-200">{item.purpose}</td>
                  <td className="px-3 py-3 text-xs text-gray-500">{item.body}</td>
                  <td className="px-3 py-3"><div className="flex gap-1.5 text-[10px]"><span className={item.safe === true ? 'text-emerald-400' : 'text-gray-600'}>{item.safe === true ? 'safe' : 'not safe'}</span><span className="text-gray-700">·</span><span className={item.idempotent === true ? 'text-sky-300' : 'text-gray-500'}>{item.idempotent === true ? 'idempotent' : item.idempotent}</span></div></td>
                  <td className="max-w-xs px-3 py-3 text-xs leading-5 text-gray-500">{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {methods.length === 0 ? <div className="p-5 text-xs text-gray-500">No methods match this search.</div> : null}
        </div>
        <p className="mt-2 text-[10px] leading-4 text-gray-600">Safe methods are intended to be read-only. Idempotent methods can be repeated with the same intended effect; neither property means a request is risk-free.</p>
      </section>

      <section>
        <SectionHeading eyebrow="Status codes" title="What happened?">
          <div className="hidden items-center gap-1 sm:flex">
            {(['2xx', '3xx', '4xx', '5xx'] as const).map((group) => <span key={group} className={`status-${group} text-[10px]`}>{group}</span>)}
          </div>
        </SectionHeading>
        <div className="mb-4 grid gap-px border border-gray-800 bg-gray-800 sm:grid-cols-4">
          {[
            ['1xx', 'Informational', 'The request is being handled.'],
            ['2xx', 'Success', 'The request achieved its intent.'],
            ['3xx', 'Redirection', 'More action is needed to complete it.'],
            ['4xx / 5xx', 'Failure', 'The client or server needs attention.'],
          ].map(([group, title, text]) => <div key={group} className="bg-[#141414] p-3"><div className={`font-mono text-[10px] ${group === '4xx / 5xx' ? 'text-amber-300' : `status-${group}`}`}>{group}</div><div className="mt-1.5 text-[11px] font-semibold text-gray-200">{title}</div><div className="mt-1 text-[10px] leading-4 text-gray-600">{text}</div></div>)}
        </div>
        <div className="mb-3 flex flex-wrap gap-1">
          {STATUS_GROUPS.map((group) => (
            <button key={group} type="button" onClick={() => onStatusFilterChange(group)} className={`border px-2.5 py-1.5 font-mono text-[10px] transition-colors ${statusFilter === group ? 'border-gray-500 bg-gray-800 text-gray-100' : 'border-gray-800 text-gray-600 hover:border-gray-600 hover:text-gray-300'}`}>{group === 'all' ? 'all codes' : group}</button>
          ))}
        </div>
        <div className="grid gap-px border border-gray-800 bg-gray-800 sm:grid-cols-2 lg:grid-cols-3">
          {statuses.map((item) => (
            <div key={item.code} className="bg-[#141414] p-3.5 hover:bg-[#181818]">
              <div className="flex items-center gap-2"><span className={`status-${item.group} font-mono text-sm font-semibold`}>{item.code}</span><span className="text-xs font-medium text-gray-200">{item.name}</span></div>
              <p className="mt-2 text-[11px] leading-5 text-gray-500">{item.meaning}</p>
            </div>
          ))}
        </div>
        {statuses.length === 0 ? <div className="border border-t-0 border-gray-800 p-5 text-xs text-gray-500">No status codes match this search.</div> : null}
      </section>

      <section>
        <SectionHeading eyebrow="Header reference" title="Metadata that travels with the message.">
          <span className="hidden text-[10px] text-gray-600 sm:block">RequestLoom accepts custom headers too</span>
        </SectionHeading>
        <div className="mb-3 flex flex-wrap gap-1">
          {HEADER_CATEGORIES.map((category) => (
            <button key={category} type="button" onClick={() => onHeaderCategoryChange(category)} className={`border px-2.5 py-1.5 text-[10px] transition-colors ${headerCategory === category ? 'border-gray-500 bg-gray-800 text-gray-100' : 'border-gray-800 text-gray-600 hover:border-gray-600 hover:text-gray-300'}`}>{category === 'all' ? 'all headers' : category}</button>
          ))}
        </div>
        <div className="docs-reference-scroll overflow-auto border border-gray-800">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-[#181818] text-[10px] uppercase tracking-wide text-gray-600">
              <tr><th className="px-3 py-2.5 font-semibold">Header</th><th className="px-3 py-2.5 font-semibold">Direction</th><th className="px-3 py-2.5 font-semibold">What it does</th><th className="px-3 py-2.5 font-semibold">Example</th></tr>
            </thead>
            <tbody>
              {headers.map((item) => (
                <tr key={item.name} className="border-t border-gray-800/80 align-top hover:bg-gray-900/40">
                  <td className="px-3 py-2.5"><code className="font-mono text-[11px] text-[#ffbca3]">{item.name}</code><div className="mt-1 text-[9px] uppercase tracking-wide text-gray-700">{item.category}</div></td>
                  <td className="px-3 py-2.5 text-[10px] text-gray-500">{item.direction}</td>
                  <td className="px-3 py-2.5 text-xs leading-5 text-gray-400">{item.meaning}</td>
                  <td className="max-w-xs px-3 py-2.5 font-mono text-[10px] leading-5 text-gray-600">{item.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {headers.length === 0 ? <div className="p-5 text-xs text-gray-500">No headers match this search.</div> : null}
        </div>
        <p className="mt-2 text-[10px] leading-4 text-gray-600">This is the common working set, including the headers suggested by the editor. Header names are case-insensitive; add an application-specific or custom header directly in the Headers tab.</p>
      </section>

      <section>
        <SectionHeading eyebrow="Authentication" title="Choose how the request proves identity." />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {AUTH_TYPES.map((item) => (
            <div key={item.name} className="border border-gray-800 bg-[#141414] p-4">
              <div className="flex items-start justify-between gap-3"><div className="text-sm font-semibold text-gray-100">{item.name}</div><span className="whitespace-nowrap border border-gray-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-gray-600">{item.where}</span></div>
              <p className="mt-2 text-[11px] leading-5 text-gray-500">{item.description}</p>
              <div className="mt-3 border-t border-gray-800/80 pt-2 text-[10px] text-gray-600"><span className="uppercase tracking-wide">Fields</span><div className="mt-1 font-mono text-[#ffbca3]">{item.fields}</div></div>
            </div>
          ))}
        </div>
        <div className="mt-3 border border-gray-800 bg-gray-950/40 px-3 py-2.5 text-[11px] leading-5 text-gray-500">Request auth overrides service auth. Choose <code className="font-mono text-[#ffbca3]">Inherit</code> to use the service default, or <code className="font-mono text-[#ffbca3]">None</code> to explicitly suppress it for one request. OAuth access and refresh tokens are kept in the backend memory cache.</div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <InfoCard title="Headers" text="Metadata travels with the request or response. Content-Type describes the body; Accept describes what the client wants back; Authorization carries credentials." />
        <InfoCard title="Body" text="The body carries data for methods such as POST, PUT, and PATCH. Match the body format to Content-Type and validate the response format." />
        <InfoCard title="Authentication" text="Authentication proves who you are; authorization decides what you can do. A 401 usually points to credentials, while a 403 points to permissions." />
      </section>
    </div>
  );
}

function RequestLoomContent({ onSectionChange }: { onSectionChange: (section: DocumentationSection) => void }) {
  return (
    <div className="space-y-7">
      <section>
        <SectionHeading eyebrow="The workspace loop" title="From setup to signal." />
        <div className="grid gap-0 border border-gray-800 md:grid-cols-5">
          {[
            ['01', 'Workspace', 'Choose the project boundary.'],
            ['02', 'Environment', 'Activate base URLs and values.'],
            ['03', 'Service', 'Group related requests.'],
            ['04', 'Request', 'Configure and send.'],
            ['05', 'Response', 'Inspect, test, repeat.'],
          ].map(([number, title, text], index) => (
            <div key={number} className={`relative border-gray-800 p-4 ${index < 4 ? 'border-b md:border-b-0 md:border-r' : ''}`}>
              <span className="font-mono text-[10px] text-[#ffbca3]">{number}</span>
              <div className="mt-3 text-xs font-semibold text-gray-100">{title}</div>
              <div className="mt-1.5 text-[10px] leading-4 text-gray-600">{text}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="border border-gray-800 bg-[#141414] p-5">
          <SectionHeading eyebrow="Organize" title="The nouns in the app." />
          <div className="space-y-3">
            {[
              ['Workspace', 'A separate project boundary for data and configuration.'],
              ['Environment', 'A named set of values you can activate, such as local, staging, or production.'],
              ['Service', 'A collection of related requests with shared headers, auth, and variables.'],
              ['Folder', 'An optional group for organizing requests inside a service.'],
              ['Request', 'The executable definition: method, URL, inputs, body, auth, scripts, and tests.'],
            ].map(([title, text]) => <div key={title} className="border-b border-gray-800/80 pb-3 last:border-0 last:pb-0"><div className="text-xs font-semibold text-gray-200">{title}</div><div className="mt-1 text-xs leading-5 text-gray-500">{text}</div></div>)}
          </div>
        </div>
        <div className="border border-gray-800 bg-[#141414] p-5">
          <SectionHeading eyebrow="Where to look" title="A map of the interface." />
          <div className="space-y-2">
            {[
              ['Services', 'Build and organize requests, folders, and scripts.'],
              ['Variables', 'Manage workspace and service values plus environments.'],
              ['Mocks', 'Create local endpoints with canned or scripted responses.'],
              ['Top bar', 'Switch workspaces and environments, import/export, settings, and dev tools.'],
              ['Response tabs', 'Inspect body, headers, info, scripts, tests, and history.'],
            ].map(([title, text]) => <div key={title} className="flex gap-3 border border-gray-800 bg-gray-950/40 p-3"><span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 bg-gray-600" /><div><div className="text-xs font-semibold text-gray-200">{title}</div><div className="mt-1 text-[11px] leading-5 text-gray-500">{text}</div></div></div>)}
          </div>
        </div>
      </section>

      <section>
        <SectionHeading eyebrow="Capabilities" title="Keep the whole workflow nearby." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoCard title="Import and export" text="Bring in OpenAPI/Swagger, WSDL, cURL, or Postman collections. Export a complete workspace when you need to move or back it up." />
          <InfoCard title="History and diffing" text="Review executed requests in the active workspace and compare response bodies when a change needs a closer look." />
          <InfoCard title="Settings and storage" text="Choose SQLite or JSON storage, tune timeouts and redirects, configure proxies, and control history, cookies, and response limits." />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border border-[#5a2f20] bg-[#211611] px-4 py-3">
        <div><div className="text-xs font-semibold text-gray-100">Ready to make it repeatable?</div><div className="mt-1 text-[11px] text-gray-500">Variables and scripts are the shortest path from a one-off call to a workflow.</div></div>
        <button type="button" onClick={() => onSectionChange('automation')} className="flex items-center gap-1.5 border border-[#8d4b32] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#ffbca3] hover:bg-[#3a1d14]">Open automation guide <DocIcon name="arrow" /></button>
      </div>
    </div>
  );
}

function AutomationContent() {
  return (
    <div className="space-y-7">
      <section>
        <SectionHeading eyebrow="Variables and scripts" title="Make the next request easier." />
        <div className="grid gap-3 md:grid-cols-2">
          {AUTOMATION_CARDS.map((card) => (
            <div key={card.title} className="border border-gray-800 bg-[#141414] p-4">
              <div className="text-sm font-semibold text-gray-100">{card.title}</div>
              <p className="mt-1.5 text-xs leading-5 text-gray-500">{card.text}</p>
              <pre className="mt-4 overflow-x-auto border border-gray-800 bg-gray-950/70 p-3 font-mono text-[11px] leading-5 text-[#ffbca3]">{card.code}</pre>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="border border-gray-800 bg-[#141414] p-5">
          <SectionHeading eyebrow="Variable resolution" title="The most specific value wins." />
          <p className="mb-4 text-xs leading-5 text-gray-500">Use <code className="font-mono text-[#ffbca3]">{'{{name}}'}</code> in URLs, query parameters, headers, bodies, auth fields, and scripts. Keys are case-insensitive, and disabled workspace or service entries are skipped.</p>
          <div className="space-y-0">
            {[
              ['01', 'Workspace', 'Global values for the active workspace.'],
              ['02', 'Environment', 'Active-environment workspace values override workspace-wide values.'],
              ['03', 'Service', 'Service values override workspace values; active-environment service values override service-wide values.'],
              ['04', 'Request', 'Request variables override service and workspace values.'],
              ['05', 'Runtime', 'Values created by scripts with setVar() have the highest precedence for the request session.'],
            ].map(([number, title, text]) => <div key={number} className="flex gap-3 border-b border-gray-800/80 py-2.5 last:border-0"><span className="font-mono text-[10px] text-[#ffbca3]">{number}</span><div><div className="text-xs font-semibold text-gray-200">{title}</div><div className="mt-1 text-[11px] leading-5 text-gray-500">{text}</div></div></div>)}
          </div>
          <div className="mt-4 border border-gray-800 bg-gray-950/50 p-3 font-mono text-[11px] leading-5 text-gray-400"><span className="text-gray-600">URL</span>  <span className="text-[#ffbca3]">{'{{base_url}}'}</span>/users/<span className="text-[#ffbca3]">{'{{user_id}}'}</span><br /><span className="text-gray-600">JSON</span> <span className="text-gray-500">{'{ "email": "{{email}}" }'}</span></div>
        </div>
        <div className="border border-gray-800 bg-[#141414] p-5">
          <SectionHeading eyebrow="Built-in dynamic values" title="Generate data at execution time." />
          <p className="mb-3 text-xs leading-5 text-gray-500">Dynamic values use the <code className="font-mono text-[#ffbca3]">{'{{$...}}'}</code> form and are generated when the request executes. They are useful for IDs, timestamps, realistic fixtures, and randomized test inputs.</p>
          <div className="max-h-[480px] overflow-y-auto border border-gray-800">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-[#181818] text-[10px] uppercase tracking-wide text-gray-600"><tr><th className="px-3 py-2.5 font-semibold">Category / token</th><th className="px-3 py-2.5 font-semibold">Behavior</th></tr></thead>
              <tbody>
                {BUILT_IN_VARIABLES.map((item) => <tr key={item.tokens} className="border-t border-gray-800/80 align-top"><td className="px-3 py-2.5"><div className="text-[9px] uppercase tracking-wide text-gray-700">{item.category}</div><code className="mt-1 block font-mono text-[10px] leading-5 text-[#ffbca3]">{item.tokens}</code></td><td className="px-3 py-2.5 text-[11px] leading-5 text-gray-500">{item.description}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="border border-gray-800 bg-[#141414] p-5">
          <SectionHeading eyebrow="Execution order" title="Know when each layer runs." />
          <div className="space-y-0">
            {[
              ['01', 'Resolve inputs', 'Variables in the request are resolved for execution.'],
              ['02', 'Pre-request script', 'Prepare runtime state or change request details.'],
              ['03', 'Send HTTP request', 'Request settings such as timeout, redirects, proxy, and TLS apply here.'],
              ['04', 'Receive response', 'RequestLoom records status, headers, body, timing, and size.'],
              ['05', 'Post-request script', 'Extract values or log response-derived information.'],
              ['06', 'Run tests', 'Assertions produce named pass/fail results for the request or collection run.'],
            ].map(([number, title, text], index) => (
              <div key={number} className="flex gap-3 border-b border-gray-800/80 py-3 first:pt-0 last:border-0 last:pb-0">
                <span className="font-mono text-[10px] text-[#ffbca3]">{number}</span>
                <div><div className="text-xs font-semibold text-gray-200">{title}</div><div className="mt-1 text-[11px] leading-5 text-gray-500">{text}</div></div>
                {index < 5 ? <span className="ml-auto self-center text-gray-700">↓</span> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="border border-gray-800 bg-[#141414] p-5">
          <SectionHeading eyebrow="Collection runner" title="Repeat with confidence." />
          <p className="text-xs leading-6 text-gray-500">Run a whole service or one folder sequentially. Collection results show each request, status, response time, errors, and test outcomes so a workflow is more than a green button.</p>
          <div className="mt-4 space-y-2 text-[11px]">
            {['Use an active environment before the run.', 'Extract IDs or tokens in post-request scripts.', 'Assert the contract in named tests.', 'Read the first failing request in the results.'].map((item) => <div key={item} className="flex items-start gap-2 border border-gray-800 bg-gray-950/40 px-3 py-2.5 text-gray-400"><DocIcon name="check" /><span>{item}</span></div>)}
          </div>
        </div>
      </section>

      <section>
        <SectionHeading eyebrow="Mock servers" title="Design against a stable contract." />
        <div className="grid gap-3 md:grid-cols-3">
          <InfoCard title="Define the route" text="Choose a method and path under the local /mock/ base path." />
          <InfoCard title="Shape the response" text="Set status, content type, headers, body, and an optional delay." />
          <InfoCard title="Add behavior" text="Use a response script to read request.method, path, body, headers, or queryParams and build dynamic output." />
        </div>
      </section>

      <section className="border border-gray-800 bg-[#141414] p-5">
        <SectionHeading eyebrow="Keyboard shortcuts" title="Keep your hands on the work." />
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {[
            ['Ctrl / Cmd + Enter', 'Send the active request'],
            ['Ctrl / Cmd + Alt + 1', 'Open Services'],
            ['Ctrl / Cmd + Alt + 2', 'Open Variables'],
            ['Ctrl / Cmd + Alt + 3', 'Open Mocks'],
            ['Ctrl / Cmd + Alt + 4', 'Open Documentation'],
            ['Ctrl / Cmd + Alt + L', 'Toggle response layout'],
            ['Ctrl / Cmd + Alt + P', 'Toggle pretty / raw response'],
            ['Ctrl / Cmd + K', 'Focus documentation search'],
          ].map(([shortcut, action]) => <div key={shortcut} className="flex items-center justify-between gap-4 border-b border-gray-800/80 py-2.5"><kbd className="border border-gray-700 bg-gray-900 px-1.5 py-1 font-mono text-[10px] text-gray-300">{shortcut}</kbd><span className="text-right text-[11px] text-gray-500">{action}</span></div>)}
        </div>
      </section>
    </div>
  );
}
