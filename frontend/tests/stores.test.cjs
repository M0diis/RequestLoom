const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Execute the authored store against real Zustand. Mock only HTTP and browser boundaries.
function load(file, api = {}, settings = { autoSave: false }) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const mocks = {
    '../services/api': api,
    './settingsStore': { useSettingsStore: { getState: () => ({ settings }) } },
    './devToolsStore': { useDevToolsStore: { getState: () => ({ recordNetworkEntry() {} }) } },
    '../lib/undoableDelete': {
      scheduleUndoableDelete(options) { options.hide(); scheduledDeletes.push(options); },
      flushPendingDeletes: async () => {},
    },
  };
  vm.runInNewContext(compiled, { module, exports: module.exports,
    require: name => name in mocks ? mocks[name] : require(name),
    crypto: require("node:crypto").webcrypto, console, Error, setTimeout, clearTimeout, AbortController, performance,
    window: { dispatchEvent() {} }, CustomEvent: class {},
  }, { filename: file });
  return module.exports;
}
const scheduledDeletes = [];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const request = id => ({ id, workspaceId: 'w', name: id, method: 'GET', url: 'http://original', headers: [], params: [], variables: [] });
function requests(api) {
  const store = load('stores/requestStore.ts', api).useRequestStore;
  store.setState({ workspaceId: 'w', activeRequestId: 'a', activeRequest: request('a'), topLevelRequests: [request('a'), request('b')] });
  return store;
}
const response = statusCode => ({ statusCode, headers: {}, scriptVariables: {}, serviceScriptVariables: {}, scriptLogs: [] });

test('manual drafts survive selecting another tab and closing/reopening', async () => {
  const store = requests({ requestsApi: { getById: async id => request(id) } });
  await store.getState().updateRequest('a', { url: 'http://draft' });
  await store.getState().selectRequest('b');
  store.getState().closeRequest('a');
  await store.getState().selectRequest('a');
  assert.equal(store.getState().activeRequest.url, 'http://draft');
  assert.equal(store.getState().dirtyRequests.has('a'), true);
});

test('late selection response never replaces the newer active request', async () => {
  const a = deferred(), b = deferred();
  const store = requests({ requestsApi: { getById: id => id === 'a' ? a.promise : b.promise } });
  const first = store.getState().selectRequest('a');
  const second = store.getState().selectRequest('b');
  b.resolve(request('b')); await second;
  a.resolve(request('a')); await first;
  assert.equal(store.getState().activeRequestId, 'b');
  assert.equal(store.getState().activeRequest.id, 'b');
});

test('typing during manual save retains the new dirty revision', async () => {
  const write = deferred();
  const store = requests({ requestsApi: { update: () => write.promise } });
  const saving = store.getState().saveRequest('a');
  await Promise.resolve();
  await store.getState().updateRequest('a', { url: 'http://new-draft' });
  write.resolve(request('a')); await saving;
  assert.equal(store.getState().activeRequest.url, 'http://new-draft');
  assert.equal(store.getState().dirtyRequests.has('a'), true);
});

test('writes for one request are serialized and the newest write wins', async () => {
  const first = deferred();
  const sent = [];
  const store = requests({ requestsApi: { update: async (id, body) => {
    sent.push(body.url);
    if (sent.length === 1) await first.promise;
    return { ...request(id), ...body };
  } } });
  const one = store.getState().saveRequest('a'); await Promise.resolve();
  await store.getState().updateRequest('a', { url: 'http://new' });
  const two = store.getState().saveRequest('a');
  assert.equal(sent.length, 1);
  first.resolve(); await Promise.all([one, two]);
  assert.equal(sent.join(','), 'http://original,http://new');
  assert.equal(store.getState().activeRequest.url, 'http://new');
  assert.equal(store.getState().dirtyRequests.has('a'), false);
});

test('a failed save retains the draft and exposes an actionable error', async () => {
  const store = requests({ requestsApi: { update: async () => { throw new Error('Storage is full'); } } });
  await store.getState().updateRequest('a', { url: 'http://draft' });
  await store.getState().saveRequest('a');
  assert.equal(store.getState().draftsById.a.url, 'http://draft');
  assert.equal(store.getState().dirtyRequests.has('a'), true);
  assert.equal(store.getState().error, 'Storage is full');
});

test('repeated sends are gated and an old cancellation cannot clear a newer send', async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const store = requests({ executeApi: { send: () => ++calls === 1 ? first.promise : second.promise } });
  const one = store.getState().sendRequest('w');
  await store.getState().sendRequest('w');
  assert.equal(calls, 1);
  store.getState().cancelRequest();
  const two = store.getState().sendRequest('w');
  first.reject(new Error('Aborted')); await one;
  assert.equal(store.getState().sending, true);
  second.resolve(response(201)); await two;
  assert.equal(store.getState().responses.a.statusCode, 201);
});

test('request loads discard stale workspaces and retain drafts on refresh', async () => {
  const a = deferred(), b = deferred();
  const store = requests({ servicesApi: { getAll: () => Promise.resolve([]) }, requestsApi: {
    getTopLevel: id => id === 'old' ? a.promise : b.promise,
  } });
  await store.getState().updateRequest('a', { url: 'http://draft' });
  const old = store.getState().loadServices('old');
  const current = store.getState().loadServices('new');
  b.resolve([request('a')]); await current;
  a.resolve([request('b')]); await old;
  assert.equal(store.getState().workspaceId, 'new');
  assert.equal(store.getState().topLevelRequests[0].url, 'http://draft');
});

for (const [file, name, apiName, collection] of [
  ['environmentStore.ts', 'useEnvironmentStore', 'environmentsApi', 'environments'],
  ['mockServerStore.ts', 'useMockServerStore', 'mockServersApi', 'mockServers'],
  ['historyStore.ts', 'useHistoryStore', 'historyApi', 'entries'],
]) {
  test(`${file} ignores late workspace loads and resets loading after failure`, async () => {
    const old = deferred();
    const store = load('stores/' + file, { [apiName]: { getAll: id => id === 'old' ? old.promise : Promise.resolve([{ id }]) } })[name];
    const one = store.getState().load('old');
    await store.getState().load('new');
    old.resolve([{ id: 'old' }]); await one;
    assert.equal(store.getState()[collection][0].id, 'new');
    const failed = load('stores/' + file, { [apiName]: { getAll: async () => { throw new Error('Offline'); } } })[name];
    await failed.getState().load('new');
    assert.equal(failed.getState().loading, false);
    assert.equal(failed.getState().error, 'Offline');
  });
}

for (const action of ['save', 'run']) {
  test(`script ${action} preserves edits typed while the submitted code is pending`, async () => {
    const pending = deferred();
    const store = load('stores/scriptFileStore.ts', { serviceFilesApi: { [action]: () => pending.promise } }).useScriptFileStore;
    store.getState().openFile('s', { name: 'helper.js', content: 'submitted', path: 'helper.js' });
    const task = store.getState()[action]('w', 's:helper.js');
    store.getState().updateCode('s:helper.js', 'new draft');
    pending.resolve({ success: true }); await task;
    assert.equal(store.getState().tabs[0].savedCode, 'submitted');
    assert.equal(store.getState().tabs[0].code, 'new draft');
    store.getState().closeFile('s:helper.js');
    store.getState().openFile('s', { name: 'helper.js', content: 'submitted', path: 'helper.js' });
    assert.equal(store.getState().tabs[0].code, 'new draft');
  });
}

test('script loads ignore old workspaces without losing dirty cached tabs', async () => {
  const old = deferred();
  const store = load('stores/scriptFileStore.ts', { serviceFilesApi: {
    list: workspace => workspace === 'old' ? old.promise : Promise.resolve([{ name: 'new.js', content: '', path: 'new.js' }]),
  } }).useScriptFileStore;
  store.getState().openFile('s', { name: 'draft.js', content: '', path: 'draft.js' });
  store.getState().updateCode('s:draft.js', 'retained draft');
  const one = store.getState().load('old', ['s']);
  await store.getState().load('new', ['s']);
  old.resolve([{ name: 'old.js' }]); await one;
  assert.equal(store.getState().files[0].name, 'new.js');
  assert.equal(store.getState().tabs[0].code, 'retained draft');
});

test('URL query materialization preserves fragments and exact query separators', () => {
  const { appendQueryParameter } = load('lib/requestUrl.ts');
  assert.equal(appendQueryParameter('https://example.com/a#b', 'q', 'a b'), 'https://example.com/a?q=a%20b#b');
  assert.equal(appendQueryParameter('https://example.com/a?x=1#b', 'q', '+'), 'https://example.com/a?x=1&q=%2B#b');
});

test('deleting requests hides them until the undo window closes and undo restores order and tabs', async () => {
  const deleted = [];
  const store = requests({ requestsApi: { delete: async id => { deleted.push(id); }, getById: async id => request(id) } });
  store.setState({ openRequestIds: ['a', 'b'] });
  scheduledDeletes.length = 0;

  store.getState().deleteRequestsWithUndo(['a']);
  assert.deepEqual(Array.from(store.getState().topLevelRequests, r => r.id), ['b']);
  assert.deepEqual(Array.from(store.getState().openRequestIds), ['b']);
  assert.equal(store.getState().activeRequestId, 'b');
  assert.deepEqual(deleted, [], 'nothing is deleted on the backend before the undo window closes');

  scheduledDeletes[0].restore();
  assert.deepEqual(Array.from(store.getState().topLevelRequests, r => r.id), ['a', 'b']);
  assert.deepEqual(Array.from(store.getState().openRequestIds), ['a', 'b']);

  store.getState().deleteRequestsWithUndo(['b']);
  await scheduledDeletes[1].commit();
  assert.deepEqual(deleted, ['b']);
  assert.deepEqual(Array.from(store.getState().topLevelRequests, r => r.id), ['a']);
});


test('ephemeral edits never autosave and disappear with all runtime state on close', async () => {
  let writes = 0;
  const store = load('stores/requestStore.ts', { requestsApi: { update: async () => { writes++; } } }, { autoSave: true }).useRequestStore;
  store.setState({ workspaceId: 'w' });
  const req = store.getState().createEphemeralRequest('w');
  await store.getState().updateRequest(req.id, { url: 'https://example.com', body: 'draft' });
  await store.getState().saveRequest(req.id);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(writes, 0);
  assert.equal(store.getState().topLevelRequests.length, 0);
  store.setState({ responses: { [req.id]: response(200) }, runtimeScriptVariablesByRequest: { [req.id]: { token: {} } } });
  store.getState().closeRequest(req.id);
  assert.equal(store.getState().draftsById[req.id], undefined);
  assert.equal(store.getState().responses[req.id], undefined);
  assert.equal(store.getState().runtimeScriptVariablesByRequest[req.id], undefined);
  assert.equal(store.getState().dirtyRequests.has(req.id), false);
  assert.equal(store.getState().activeRequestId, null);
});

test('ephemeral requests survive tab selection and refresh; close others discards them', async () => {
  const store = requests({ requestsApi: { getById: async id => request(id), getTopLevel: async () => [request('a')] }, servicesApi: { getAll: async () => [] } });
  const req = store.getState().createEphemeralRequest('w');
  await store.getState().updateRequest(req.id, { url: 'https://draft' });
  await store.getState().selectRequest('a');
  await store.getState().selectRequest(req.id);
  await store.getState().loadServices('w');
  assert.equal(store.getState().activeRequest.url, 'https://draft');
  store.getState().closeOtherRequests('a');
  assert.equal(store.getState().draftsById[req.id], undefined);
  assert.equal(store.getState().activeRequestId, 'a');
});

test('closing an in-flight ephemeral send cannot resurrect its response', async () => {
  const pending = deferred(); let payload;
  const store = requests({ executeApi: { send: data => { payload = data; return pending.promise; } } });
  const req = store.getState().createEphemeralRequest('w');
  const sending = store.getState().sendRequest('w');
  assert.equal(payload.ephemeral, true);
  assert.equal(payload.requestId, undefined);
  store.getState().closeRequest(req.id);
  pending.resolve(response(200)); await sending;
  assert.equal(store.getState().responses[req.id], undefined);
  assert.equal(store.getState().sending, false);
});

test('URL extraction finds literal matches with folder paths and replaces only selected occurrences', () => {
  const { findUrlOccurrences, replaceUrlOccurrences } = load('lib/variableExtraction.ts');
  const host = 'https://example.com';
  const req = { ...request('a'), serviceId: 's', folderId: 'child', url: host + '/{00F94C74-0000-C718-9B9F-49BA9C66D80C}?next=' + host };
  const service = { id: 's', name: 'KYC', requests: [req], folders: [{ id: 'parent', name: 'Cases' }, { id: 'child', parentFolderId: 'parent', name: 'Review' }] };
  const found = findUrlOccurrences([service], [], host);
  assert.equal(found.length, 2);
  assert.equal(found[0].location, 'KYC / Cases / Review / a');
  assert.equal(replaceUrlOccurrences(req.url, host, '{{baseUrl}}', [found[0]]), '{{baseUrl}}/{00F94C74-0000-C718-9B9F-49BA9C66D80C}?next=' + host);
  assert.equal(replaceUrlOccurrences(req.url, host, '{{baseUrl}}', found), '{{baseUrl}}/{00F94C74-0000-C718-9B9F-49BA9C66D80C}?next={{baseUrl}}');
  assert.equal(findUrlOccurrences([service], [], req.url).length, 1);
  assert.throws(() => replaceUrlOccurrences(req.url + '/changed', host, '{{baseUrl}}', found), /changed/);
  assert.equal(findUrlOccurrences([service], [], '').length, 0);
});

test('preview resolves double braces and dollar braces, preserving literal single braces', () => {
  const { resolveValueForPreview } = load('components/common/variablePreviewUtils.ts');
  const vars = new Map([['base', { value: 'https://example.com', source: 'global' }], ['id', { value: '123', source: 'request' }]]);
  const result = resolveValueForPreview('{{base}}/${id}/{id}/{00F94C74-0000-C718-9B9F-49BA9C66D80C}', vars);
  assert.equal(result.resolvedValue, 'https://example.com/123/{id}/{00F94C74-0000-C718-9B9F-49BA9C66D80C}');
  assert.equal(result.missingVariables.length, 0);
  assert.equal(resolveValueForPreview('{id}', vars).hasVariables, false);
  const secret = resolveValueForPreview('${token}', new Map([['token', { value: 'secret', source: 'global', isSecret: true }]]));
  assert.equal(secret.resolvedValue, 'secret');
  assert.equal(secret.displayValue.includes('secret'), false);
});
