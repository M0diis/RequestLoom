import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Monaco requires self.MonacoEnvironment to be set synchronously before any editor mounts.
// globalAPI: true is required for ESM imports (vs CDN loader).

self.MonacoEnvironment = {
  globalAPI: true,
  getWorker(_: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// One-time monaco setup

let monacoInstance: typeof import('monaco-editor') | null = null;

export async function ensureMonacoConfigured(): Promise<void> {
  if (monacoInstance) return;

  // editor.main.js is the standard "batteries included" entry point.
  // It imports all language contributions (javascript, typescript,
  // json, html, css, xml, etc.) and exports the full monaco API.
  const monaco = await import('monaco-editor');

  // Tell @monaco-editor/react to use OUR monaco instance instead
  // of loading from CDN. Must happen before any editor mounts.
  loader.config({ monaco });

  // Register custom script completions on the shared monaco instance
  registerScriptCompletionsInternal(monaco);
  registerDynamicCompletionsInternal(monaco);

  monacoInstance = monaco;
}

// Script completions

let completionsRegistered = false;
let dynamicCompletionsRegistered = false;
let dynamicValueSuggestions: string[] = [];

export function setDynamicValueCompletions(suggestions: string[]): void {
  dynamicValueSuggestions = suggestions;
  if (monacoInstance) {
    registerDynamicCompletionsInternal(monacoInstance);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerDynamicCompletionsInternal(monaco: any): void {
  if (dynamicCompletionsRegistered) return;
  dynamicCompletionsRegistered = true;

  for (const language of ['json', 'plaintext', 'xml', 'javascript']) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['$'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provideCompletionItems: (model: any, position: any) => {
        const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const match = line.match(/\{\{\s*\$[a-zA-Z0-9]*$/);
        if (!match) return { suggestions: [] };

        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - match[0].length,
          endColumn: position.column,
        };
        return {
          suggestions: dynamicValueSuggestions.map((suggestion) => ({
            label: suggestion,
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: suggestion,
            documentation: 'Dynamic request value',
            range,
          })),
        };
      },
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerScriptCompletionsInternal(monaco: any): void {
  if (completionsRegistered) return;
  completionsRegistered = true;

  monaco.languages.registerCompletionItemProvider('javascript', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const K = monaco.languages.CompletionItemKind;
      const R = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;

      const sni = (lbl: string, kind: number, insert: string, doc: string) =>
        ({ label: lbl, kind, insertText: insert, documentation: doc, range, insertTextRules: R });

      const val = (lbl: string, kind: number, insert: string, doc: string) =>
        ({ label: lbl, kind, insertText: insert, documentation: doc, range });

      const suggestions = [
        // Tests
        sni('test', K.Function, 'test("${1:name}", () => {\n\t${0}\n});', 'Define a test case.'),
        sni('expect', K.Function, 'expect(${1:value})', 'Create an assertion. Chain .toBe(), .toContain(), etc.'),
        sni('.toBe', K.Method, '.toBe(${1:expected})', 'Assert strict equality.'),
        sni('.toContain', K.Method, '.toContain(${1:substring})', 'Assert string contains substring.'),
        sni('.toBeGreaterThan', K.Method, '.toBeGreaterThan(${1:n})', 'Assert value is greater than n.'),
        sni('.toBeLessThan', K.Method, '.toBeLessThan(${1:n})', 'Assert value is less than n.'),
        val('.not', K.Property, '.not', 'Negate the next assertion.'),
        // Variables
        sni('setVar', K.Function, 'setVar("${1:key}", ${2:value});', 'Create/update a runtime variable.'),
        sni('getVar', K.Function, 'getVar("${1:key}")', 'Get a runtime variable value.'),
        sni('unsetVar', K.Function, 'unsetVar("${1:key}");', 'Remove a runtime variable.'),
        // Request
        sni('setUrl', K.Function, 'setUrl("${1:url}");', 'Change the request URL.'),
        val('getUrl', K.Function, 'getUrl()', 'Get the current request URL.'),
        sni('setMethod', K.Function, 'setMethod("${1:GET}");', 'Change the HTTP method.'),
        val('getMethod', K.Function, 'getMethod()', 'Get the current HTTP method.'),
        sni('setBody', K.Function, 'setBody(${1:body});', 'Set the request body.'),
        val('getBody', K.Function, 'getBody()', 'Get the current request body.'),
        // Headers
        sni('setHeader', K.Function, 'setHeader("${1:key}", "${2:value}");', 'Add/update a request header.'),
        sni('getHeader', K.Function, 'getHeader("${1:key}")', 'Get a request header value.'),
        sni('removeHeader', K.Function, 'removeHeader("${1:key}");', 'Remove a request header.'),
        // Params
        sni('setParam', K.Function, 'setParam("${1:key}", "${2:value}");', 'Add/update a query parameter.'),
        sni('getParam', K.Function, 'getParam("${1:key}")', 'Get a query parameter value.'),
        sni('removeParam', K.Function, 'removeParam("${1:key}");', 'Remove a query parameter.'),
        // Logging
        sni('log', K.Function, 'log(${1:value});', 'Output to the script log.'),
        // Response
        val('response', K.Variable, 'response', 'Response object: .status, .body, .headers, .contentType, .time, .size.'),
        val('getResponseStatus', K.Function, 'getResponseStatus()', 'Get the HTTP status code.'),
        val('getResponseBody', K.Function, 'getResponseBody()', 'Get the response body string.'),
        sni('getResponseHeader', K.Function, 'getResponseHeader("${1:name}")', 'Get a response header value.'),
        // Objects
        val('request', K.Variable, 'request', 'Current request object: .method, .url, .body, .bodyType.'),
        val('vars', K.Variable, 'vars', 'Resolved variables. Use vars["key"] to read.'),
      ];

      return { suggestions };
    },
  });
}
