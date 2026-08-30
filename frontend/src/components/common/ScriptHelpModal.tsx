import { useState } from 'react';
import { DocumentationLink } from '../documentation/DocumentationLink';

interface Props {
  onClose: () => void;
  initialTab?: 'pre' | 'post' | 'test';
}

const HELP_CONTENT = {
  pre: {
    title: 'Pre-request Script',
    description: 'Runs before the HTTP request is sent. Use it to set up variables, modify headers, or change the request dynamically.',
    api: [
      { fn: 'setVar(key, value)', desc: 'Create/modify a runtime variable. Survives between requests in the same session.' },
      { fn: 'getVar(key)', desc: 'Get a variable value. Returns null if not defined.' },
      { fn: 'unsetVar(key)', desc: 'Remove a runtime variable.' },
      { fn: 'setUrl(url)', desc: 'Change the request URL.' },
      { fn: 'getUrl()', desc: 'Get the current request URL.' },
      { fn: 'setMethod(method)', desc: 'Change the HTTP method (GET, POST, etc).' },
      { fn: 'getMethod()', desc: 'Get the current HTTP method.' },
      { fn: 'setBody(body)', desc: 'Set the request body.' },
      { fn: 'getBody()', desc: 'Get the current request body.' },
      { fn: 'setHeader(key, value)', desc: 'Add or update a request header.' },
      { fn: 'removeHeader(key)', desc: 'Remove a request header.' },
      { fn: 'getHeader(key)', desc: 'Get a header value.' },
      { fn: 'setParam(key, value)', desc: 'Add or update a query parameter.' },
      { fn: 'removeParam(key)', desc: 'Remove a query parameter.' },
      { fn: 'getParam(key)', desc: 'Get a query parameter value.' },
      { fn: 'log(value)', desc: 'Output to the script log (visible in response).' },
    ],
    examples: [
      `// Set a dynamic auth token
var token = getVar("auth_token");
if (!token) {
    token = "fresh-token-" + Date.now();
    setVar("auth_token", token);
}
setHeader("Authorization", "Bearer " + token);

// Switch to staging URL if variable is set
if (getVar("env") === "staging") {
    setUrl("https://staging.api.example.com" + getUrl());
}

log("Request ready: " + getMethod() + " " + getUrl());`,
    ],
  },
  post: {
    title: 'Post-request Script',
    description: 'Runs after a response is received. Use it to extract data, set variables for chaining, or process the response.',
    api: [
      { fn: 'setVar(key, value)', desc: 'Store a value for use in subsequent requests.' },
      { fn: 'getVar(key)', desc: 'Get a variable value.' },
      { fn: 'getResponseStatus()', desc: 'Get the HTTP status code as a number.' },
      { fn: 'getResponseBody()', desc: 'Get the response body as a string.' },
      { fn: 'getResponseHeader(name)', desc: 'Get a response header value.' },
      { fn: 'response.statusCode', desc: 'Access status code from response object.' },
      { fn: 'response.body', desc: 'Access body from response object.' },
      { fn: 'response.headers', desc: 'Access response headers object.' },
      { fn: 'log(value)', desc: 'Output to the script log (visible in response).' },
    ],
    examples: [
      `// Extract data from JSON response
var body = getResponseBody();
try {
    var data = JSON.parse(body);
    setVar("user_id", data.id);
    setVar("user_name", data.name);
    log("Extracted user: " + data.name);
} catch (e) {
    log("Response is not valid JSON");
}

// Check status
var status = getResponseStatus();
if (status >= 400) {
    log("Request failed with status " + status);
}

// Store auth token for next request
var authHeader = getResponseHeader("Authorization");
if (authHeader) {
    setVar("auth_token", authHeader.replace("Bearer ", ""));
}`,
    ],
  },
  test: {
    title: 'Test Script',
    description: 'Runs after the post-request script. Write assertions to validate the response. Tests run on every request execution and during collection runs.',
    api: [
      { fn: 'test(name, () => { ... })', desc: 'Define a named test case. Passes if no error is thrown.' },
      { fn: 'expect(value).toBe(expected)', desc: 'Assert strict equality.' },
      { fn: 'expect(value).toContain(substring)', desc: 'Assert string contains substring.' },
      { fn: 'expect(value).toBeGreaterThan(n)', desc: 'Assert value is greater than n.' },
      { fn: 'expect(value).toBeLessThan(n)', desc: 'Assert value is less than n.' },
      { fn: 'expect(value).not.toBe(expected)', desc: 'Negated assertion.' },
      { fn: 'response.status', desc: 'HTTP status code (number).' },
      { fn: 'response.body', desc: 'Response body (string).' },
      { fn: 'response.headers', desc: 'Response headers (object).' },
      { fn: 'response.time', desc: 'Response time in ms.' },
      { fn: 'response.contentType', desc: 'Content-Type header value.' },
    ],
    examples: [
      `// Basic status and content checks
test("Status is 200", function() {
    expect(response.status).toBe(200);
});

test("Response is JSON", function() {
    expect(response.contentType).toContain("json");
});

test("Body contains expected data", function() {
    expect(response.body).toContain("user");
});

test("Response is fast enough", function() {
    expect(response.time).toBeLessThan(5000);
});

// More advanced
test("Valid user object returned", function() {
    var body = JSON.parse(response.body);
    expect(body.name).not.toBe(null);
    expect(body.id).toBeGreaterThan(0);
});`,
    ],
  },
};

export function ScriptHelpModal({ onClose, initialTab = 'pre' }: Props) {
  const [tab, setTab] = useState<'pre' | 'post' | 'test'>(initialTab);
  const content = HELP_CONTENT[tab];

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}
    >
      <div className="w-full max-w-2xl max-h-[85vh] border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)] flex flex-col">
        {/* Header tabs */}
        <div className="flex items-center border-b border-gray-800 flex-shrink-0">
          {((['pre', 'post', 'test'] as const)).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors border-r border-gray-800 ${
                tab === t
                  ? 'bg-[#1a1a1a] text-[#ffbca3] border-b-2 border-[#ff6c37] -mb-px'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900/50'
              }`}
            >
              {HELP_CONTENT[t].title}
            </button>
          ))}
          <div className="flex-1" />
          <DocumentationLink section="scripting" onNavigate={onClose} />
          <button onClick={onClose} className="px-3 py-2.5 text-gray-500 hover:text-gray-300">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-5 space-y-5 flex-1">
          <p className="text-xs text-gray-400">{content.description}</p>

          {/* API Reference */}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Available API</h3>
            <div className="space-y-1">
              {content.api.map((item, i) => (
                <div key={i} className="flex items-start gap-3 rounded border border-gray-800 bg-gray-900/30 px-3 py-2">
                  <code className="text-[11px] font-mono text-[#ffbca3] whitespace-nowrap flex-shrink-0">{item.fn}</code>
                  <span className="text-[11px] text-gray-400">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Examples */}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Example</h3>
            {content.examples.map((code, i) => (
              <pre key={i} className="rounded border border-gray-800 bg-gray-950/70 p-3 text-[11px] font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap">
                {code}
              </pre>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
