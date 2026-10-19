"""HTTP/storage regression contracts. Uses only Python's standard library and a built backend."""
import json
from contextlib import closing
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
CONFIGURATION = os.environ.get('REQUESTLOOM_TEST_CONFIGURATION', 'Debug')
DLL = ROOT / f'backend/bin/{CONFIGURATION}/net10.0/RequestLoom.Api.dll'


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Echo(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond()

    def do_POST(self):
        self.respond()

    def respond(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        response = ('\u20ac' * 500_000).encode() if self.path == '/unicode' else json.dumps({
            'path': self.path, 'headers': dict(self.headers), 'body': body.decode(),
        }).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response)))
        self.end_headers()
        self.wfile.flush()
        if self.path == '/slow-body':
            time.sleep(.4)
        try:
            self.wfile.write(response)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def log_message(self, *args):
        pass


class Backend:
    def __init__(self, mode='sqlite', strategy='single', directory=None):
        self.temporary = None if directory else tempfile.TemporaryDirectory(prefix='requestloom-tests-')
        self.directory = Path(directory or self.temporary.name).resolve()
        self.mode, self.strategy = mode, strategy
        self.process = None

    def start(self, expect_failure=False):
        env = dict(os.environ)
        env.pop('STORAGE_MODE', None)
        env.update({
            'Storage__Mode': self.mode, 'Storage__JsonPath': str(self.directory / 'data.json'),
            'Database__Path': str(self.directory / 'data.db'), 'Settings__JsonStorageStrategy': self.strategy,
            'ASPNETCORE_ENVIRONMENT': 'Production', 'Logging__LogLevel__Default': 'Warning',
            # Test processes should not write into the machine's Windows Event Log.
            'Logging__EventLog__LogLevel__Default': 'None',
        })
        self.port = free_port()
        self.log = (self.directory / 'backend.log').open('w', encoding='utf-8')
        self.process = subprocess.Popen(['dotnet', str(DLL), '--urls', f'http://127.0.0.1:{self.port}'],
                                        cwd=self.directory, env=env, stdout=self.log, stderr=self.log)
        for _ in range(150):
            if self.process.poll() is not None:
                if expect_failure:
                    return self
                raise RuntimeError((self.directory / 'backend.log').read_text(encoding='utf-8'))
            try:
                self.api('GET', '/workspaces')
                if expect_failure:
                    raise AssertionError('Corrupted storage unexpectedly started')
                return self
            except (OSError, HTTPError):
                time.sleep(.1)
        raise RuntimeError('Backend startup timed out')

    def api(self, method, route, payload=None, expected=200):
        data = None if payload is None else json.dumps(payload).encode()
        req = Request(f'http://127.0.0.1:{self.port}/api' + route, data=data,
                      method=method, headers={'Content-Type': 'application/json'})
        try:
            response = urlopen(req, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            body = response.read()
            if response.status != expected:
                raise AssertionError(f'{method} {route}: expected {expected}, got {response.status}: {body.decode()[:600]}')
            return json.loads(body) if body else None

    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=10)
        if hasattr(self, 'log'):
            self.log.close()

    def close(self):
        self.stop()
        if self.temporary:
            self.temporary.cleanup()


class Contracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not DLL.exists():
            raise RuntimeError(f'Build the backend first: {DLL}')
        cls.echo = ThreadingHTTPServer(('127.0.0.1', 0), Echo)
        threading.Thread(target=cls.echo.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.echo.server_port}'
        cls.apps = []
        try:
            for mode, strategy in [('sqlite', 'single'), ('json', 'single'), ('json', 'perCollection')]:
                app = Backend(mode, strategy)
                cls.apps.append(app)
                app.start()
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        for app in cls.apps:
            app.stop()
        for app in cls.apps:
            app.close()
        cls.echo.shutdown()
        cls.echo.server_close()

    def workspace(self, app):
        return app.api('POST', '/workspaces', {'name': self._testMethodName}, 201)['id']

    def service(self, app, workspace, **extra):
        return app.api('POST', f'/workspaces/{workspace}/services', {'name': 'Collection', **extra}, 201)

    def request(self, app, service, name='Request', **extra):
        return app.api('POST', f'/requests/service/{service}', {'name': name, 'url': self.url + '/echo', **extra}, 201)

    def update(self, app, request, **extra):
        return app.api('PUT', f'/requests/{request["id"]}', {
            'name': request['name'], 'method': 'GET', 'url': self.url + '/echo', **extra,
        })

    def test_archive_roundtrip_preserves_behavior_and_references(self):
        for app in self.apps:
            with self.subTest(storage=(app.mode, app.strategy)):
                workspace = self.workspace(app)
                envs = app.api('GET', f'/workspaces/{workspace}/environments')
                service = self.service(app, workspace, auth={'authType': 'basic', 'configJson': '{"username":"u","password":"p"}'})
                request = self.request(app, service['id'])
                script = 'test("saved", () => expect(1).toBe(1));'
                self.update(app, request, testScript=script, auth={'authType': 'none'})
                call = app.api('POST', '/execute', {'workspaceId': workspace, 'serviceId': service['id'],
                    'requestId': request['id'], 'url': self.url + '/echo', 'auth': {'authType': 'none'}})
                self.assertNotIn('Authorization', json.loads(call['body'])['headers'])
                app.api('PUT', f'/requests/{request["id"]}/settings', {'maxRedirects': 3, 'proxyMode': 'disabled', 'followRedirects': False})
                for env in envs[:2]:
                    app.api('PUT', f'/workspaces/{workspace}/variables', {'environmentId': env['id'], 'key': 'target', 'value': env['name']})
                    app.api('PUT', f'/services/{service["id"]}/variables', {'environmentId': env['id'], 'key': 'serviceTarget', 'value': env['name']})
                app.api('POST', f'/workspaces/{workspace}/environments/{envs[1]["id"]}/activate', expected=204)
                original = app.api('GET', f'/workspaces/{workspace}/export')
                exported_request = original['services'][0]['requests'][0]
                self.assertEqual(exported_request['testScript'], script)
                restored_workspace = app.api('POST', '/workspaces/import', original, 201)['id']
                restored = app.api('GET', f'/workspaces/{restored_workspace}/export')
                restored_request = restored['services'][0]['requests'][0]
                self.assertNotEqual(restored_request['id'], request['id'])
                self.assertEqual(restored_request['testScript'], script)
                self.assertEqual(restored_request['auth']['authType'], 'none')
                self.assertEqual(restored_request['settings']['maxRedirects'], 3)
                self.assertEqual(restored_request['settings']['proxyMode'], 'disabled')
                restored_env_ids = {env['id'] for env in restored['environments']}
                self.assertTrue(all(v['environmentId'] in restored_env_ids for v in restored['workspaceVariables']))
                self.assertTrue(all(v['environmentId'] in restored_env_ids for v in restored['services'][0]['variables']))
                self.assertEqual(next(e['name'] for e in restored['environments'] if e['isActive']), envs[1]['name'])
                self.assertEqual(restored['history'][0]['requestId'], restored_request['id'])
                full = app.api('GET', f'/requests/{restored_request["id"]}')
                self.assertEqual(full['workspaceId'], restored_workspace)

    def test_archive_includes_mocks_scripts_and_can_exclude_secrets(self):
        for app in self.apps:
            with self.subTest(storage=(app.mode, app.strategy)):
                workspace = self.workspace(app)
                service = self.service(app, workspace, auth={'authType': 'bearer', 'configJson': '{"token":"top-secret"}'})
                mock = app.api('POST', f'/workspaces/{workspace}/mockservers',
                               {'name': 'Mock', 'slug': f'mock-{app.mode}-{app.strategy}-{workspace[:6]}', 'port': 0}, 201)
                app.api('POST', f'/workspaces/{workspace}/mockservers/{mock["id"]}/endpoints',
                        {'method': 'GET', 'path': '/hello', 'statusCode': 201, 'responseBody': 'hi'}, 201)
                env = app.api('GET', f'/workspaces/{workspace}/environments')[0]
                app.api('PUT', f'/workspaces/{workspace}/variables',
                        {'environmentId': env['id'], 'key': 'token', 'value': 'swordfish', 'isSecret': True})
                if app.mode == 'json':
                    app.api('POST', f'/workspaces/{workspace}/services/{service["id"]}/files', {'name': 'helpers', 'kind': 'js'})
                    app.api('PUT', f'/workspaces/{workspace}/services/{service["id"]}/files/helpers.js', {'content': 'module.exports = { a: 1 };'}, 204)

                full = app.api('GET', f'/workspaces/{workspace}/export')
                self.assertEqual(full['formatVersion'], 3)
                self.assertEqual(full['mockServers'][0]['endpoints'][0]['statusCode'], 201)
                if app.mode == 'json':
                    self.assertEqual(full['services'][0]['scriptFiles'][0]['content'], 'module.exports = { a: 1 };')

                restored = app.api('POST', '/workspaces/import', full, 201)['id']
                again = app.api('GET', f'/workspaces/{restored}/export')
                self.assertEqual(again['mockServers'][0]['endpoints'][0]['path'], '/hello')
                self.assertNotEqual(again['mockServers'][0]['slug'], full['mockServers'][0]['slug'])
                if app.mode == 'json':
                    self.assertEqual(again['services'][0]['scriptFiles'][0]['name'], 'helpers.js')

                redacted = app.api('GET', f'/workspaces/{workspace}/export?includeSecrets=false&includeHistory=false')
                self.assertFalse(redacted['includesSecrets'])
                text = json.dumps(redacted)
                self.assertNotIn('swordfish', text)
                self.assertNotIn('top-secret', text)

    def test_archive_from_newer_format_is_rejected(self):
        for app in self.apps:
            with self.subTest(storage=(app.mode, app.strategy)):
                app.api('POST', '/workspaces/import', {'formatVersion': 99, 'name': 'Future',
                        'environments': [{'name': 'DEV'}]}, 400)

    def test_invalid_scope_import_rolls_back_instead_of_making_it_global(self):
        for app in self.apps:
            with self.subTest(storage=(app.mode, app.strategy)):
                before = app.api('GET', '/workspaces')
                app.api('POST', '/workspaces/import', {'name': 'Bad scope', 'environments': [{'name': 'DEV'}],
                    'workspaceVariables': [{'key': 'secret', 'value': 'x', 'environmentId': 'unknown-source-id'}]}, 400)
                self.assertEqual(app.api('GET', '/workspaces'), before)

    def test_legacy_history_without_request_map_is_detached_and_not_dropped(self):
        for app in self.apps:
            with self.subTest(storage=(app.mode, app.strategy)):
                archive = {'name': 'History', 'topLevelRequests': [{'name': 'R', 'url': self.url}],
                    'history': [{'requestId': 'unknown-old-id', 'url': self.url, 'method': 'GET'} for _ in range(205)]}
                workspace = app.api('POST', '/workspaces/import', archive, 201)['id']
                exported = app.api('GET', f'/workspaces/{workspace}/export')
                self.assertEqual(len(exported['history']), 205)
                self.assertTrue(all(h.get('requestId') is None for h in exported['history']))

    def test_assertions_are_type_sensitive_and_structural(self):
        script = '''test("strict",()=>expect(1).toBe("1"));
test("object mismatch",()=>expect({a:1}).toEqual({a:2}));
test("nested equal",()=>expect({a:[1,null,{b:true}]}).toEqual({a:[1,null,{b:true}]}));
test("missing",()=>expect({a:undefined}).toEqual({}));
test("negative",()=>expect({a:1}).not.toEqual({a:2}));'''
        for app in self.apps:
            with self.subTest(storage=(app.mode, app.strategy)):
                response = app.api('POST', '/execute', {'url': self.url, 'testScript': script})
                self.assertEqual([t['passed'] for t in response['testResults']], [False, False, True, False, True])

    def test_collection_environment_chain_and_tests_share_one_run_context(self):
        for app in self.apps:
            with self.subTest(storage=(app.mode, app.strategy)):
                workspace = self.workspace(app)
                envs = app.api('GET', f'/workspaces/{workspace}/environments')
                for env in envs[:2]:
                    app.api('PUT', f'/workspaces/{workspace}/variables', {'environmentId': env['id'], 'key': 'target', 'value': env['name']})
                service = self.service(app, workspace)
                first = self.request(app, service['id'], 'First')
                second = self.request(app, service['id'], 'Second')
                self.update(app, first, url=self.url + '/{{target}}', postRequestScript='setVar("chained", "from-first");',
                    testScript='test("selected",()=>expect(vars.target).toBe("STG"));')
                self.update(app, second, url=self.url + '/{{chained}}')
                run = app.api('POST', f'/services/{service["id"]}/run', {'environmentId': envs[1]['id']})
                self.assertEqual(run['failedRequests'], 0)
                history = app.api('GET', f'/workspaces/{workspace}/history')
                first_history = next(h for h in history if h['requestId'] == first['id'])
                self.assertEqual(first_history['testResults'], run['results'][0]['tests'])
                self.assertTrue(first_history['url'].endswith('/STG'))
                self.assertTrue(next(h for h in history if h['requestId'] == second['id'])['url'].endswith('/from-first'))
                self.assertEqual(next(e['id'] for e in app.api('GET', f'/workspaces/{workspace}/environments') if e['isActive']), envs[0]['id'])

    def test_http_content_headers_fragment_and_legacy_environment_variables(self):
        for app in self.apps:
            with self.subTest(storage=(app.mode, app.strategy)):
                workspace = self.workspace(app)
                env = app.api('GET', f'/workspaces/{workspace}/environments')[0]
                app.api('PUT', f'/workspaces/{workspace}/environments/{env["id"]}/variables', {'key': 'legacy', 'value': 'resolved'})
                response = app.api('POST', '/execute', {'workspaceId': workspace, 'url': self.url + '/{{legacy}}#fragment',
                    'method': 'POST', 'bodyType': 'xml', 'body': '<root/>', 'params': [{'key': 'q', 'value': 'a b'}],
                    'headers': [{'key': 'Content-Type', 'value': 'application/soap+xml'}, {'key': 'Content-Language', 'value': 'lt'}]})
                wire = json.loads(response['body'])
                self.assertEqual(wire['path'], '/resolved?q=a%20b')
                self.assertEqual(wire['headers']['Content-Type'], 'application/soap+xml')
                self.assertEqual(wire['headers']['Content-Language'], 'lt')

    def test_response_limit_counts_bytes_and_timeout_covers_the_body(self):
        for app in self.apps:
            with self.subTest(storage=(app.mode, app.strategy)):
                app.api('PUT', '/settings', {'maxResponseBodySizeMb': 1, 'requestTimeoutMs': 100})
                try:
                    response = app.api('POST', '/execute', {'url': self.url + '/unicode'})
                    self.assertTrue(response['isTruncated'])
                    self.assertLessEqual(len(response['body'].encode()), 1024 * 1024)
                    self.assertNotIn('\ufffd', response['body'])
                    response = app.api('POST', '/execute', {'url': self.url + '/slow-body'})
                    self.assertEqual(response['statusText'], 'Timeout')
                finally:
                    app.api('PUT', '/settings', {'maxResponseBodySizeMb': 0, 'requestTimeoutMs': 120000})

    def test_curl_parser_preserves_quotes_whitespace_and_bodies(self):
        app = self.apps[0]
        for url in ['https://example.com', '"https://example.com"', "'https://example.com'"]:
            self.assertEqual(app.api('POST', '/tools/curl/parse', {'curl': 'curl ' + url})['url'], 'https://example.com')
        body = '{"name":"a  b", "quote":"it\'s good"}'
        # Shell's standard single-quote escape concatenates three quoted fragments.
        quoted = "'" + body.replace("'", "'\"'\"'") + "'"
        parsed = app.api('POST', '/tools/curl/parse', {'curl': 'curl --data-raw ' + quoted + ' https://example.com'})
        self.assertEqual(parsed['body'], body)
        self.assertEqual(parsed['method'], 'POST')
        self.assertEqual(parsed['bodyType'], 'json')
        parsed = app.api('POST', '/tools/curl/parse', {'curl': "curl -H 'Authorization: Bearer abc' https://example.com/users/1"})
        self.assertEqual(parsed['serviceName'], 'users')
        self.assertEqual(parsed['auth']['authType'], 'bearer')
        self.assertEqual(json.loads(parsed['auth']['configJson'])['token'], 'abc')
        self.assertEqual(parsed['headers'], [])
        app.api('POST', '/tools/curl/parse', {'curl': 'curl --unsupported https://example.com'}, 400)

    def test_parent_routes_cannot_read_or_mutate_other_workspaces(self):
        for app in self.apps:
            with self.subTest(storage=(app.mode, app.strategy)):
                one, two = self.workspace(app), self.workspace(app)
                service = self.service(app, one)
                env = app.api('GET', f'/workspaces/{one}/environments')[0]
                for verb, path, body in [
                    ('GET', f'/workspaces/{two}/services/{service["id"]}', None),
                    ('PUT', f'/workspaces/{two}/services/{service["id"]}', {'name': 'Wrong'}),
                    ('DELETE', f'/workspaces/{two}/environments/{env["id"]}', None),
                    ('POST', f'/workspaces/{two}/environments/{env["id"]}/activate', None),
                    ('PUT', f'/workspaces/{two}/variables', {'key': 'bad', 'environmentId': env['id']}),
                ]:
                    app.api(verb, path, body, 404)
                self.assertEqual(app.api('GET', f'/workspaces/{one}/services/{service["id"]}')['name'], 'Collection')

    def test_sqlite_replacement_update_is_one_transaction(self):
        app = self.apps[0]
        service = self.service(app, self.workspace(app))
        request = self.request(app, service['id'])
        self.update(app, request, headers=[{'key': 'X-Test', 'value': 'original'}])
        with closing(sqlite3.connect(app.directory / 'data.db')) as db, db:
            db.execute("CREATE TRIGGER fail_header BEFORE INSERT ON request_headers WHEN NEW.value = 'fail' BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        try:
            app.api('PUT', f'/requests/{request["id"]}', {'name': 'Changed', 'headers': [{'key': 'X-Test', 'value': 'fail'}]}, 500)
            restored = app.api('GET', f'/requests/{request["id"]}')
            self.assertEqual(restored['name'], 'Request')
            self.assertEqual(restored['headers'][0]['value'], 'original')
        finally:
            with closing(sqlite3.connect(app.directory / 'data.db')) as db, db:
                db.execute('DROP TRIGGER fail_header')

    def test_migration_keeps_active_mode_until_restart_and_blocks_writes(self):
        app = Backend('json').start()
        try:
            service = self.service(app, 'default')
            request = self.request(app, service['id'])
            archive = app.api('GET', '/workspaces/default/export')
            imported = app.api('POST', '/workspaces/import', archive, 201)
            app.api('POST', '/settings/migrate', {'storageMode': 'sqlite'})
            settings = app.api('GET', '/settings')
            self.assertEqual(settings['storageMode'], 'json')
            self.assertEqual(settings['pendingStorageMode'], 'sqlite')
            self.assertTrue(settings['restartRequired'])
            before = (app.directory / 'data.json').read_bytes()
            app.api('POST', '/workspaces/default/services', {'name': 'Blocked'}, 409)
            self.assertEqual((app.directory / 'data.json').read_bytes(), before)
            app.stop(); app.mode = 'sqlite'; app.start()
            self.assertEqual(app.api('GET', '/settings')['storageMode'], 'sqlite')
            self.assertEqual(app.api('GET', f'/requests/{request["id"]}')['workspaceId'], 'default')
            self.assertTrue(app.api('GET', f'/workspaces/{imported["id"]}/services')[0]['requests'][0]['workspaceId'])
        finally:
            app.close()

    def test_corrupt_root_and_collection_are_preserved(self):
        for collection in [False, True]:
            with self.subTest(collection=collection):
                app = Backend('json', 'perCollection' if collection else 'single')
                try:
                    if collection:
                        app.start()
                        service = self.service(app, 'default')
                        target = Path(service['storagePath'])
                        app.stop()
                    else:
                        target = app.directory / 'data.json'
                    broken = b'{"important-data":broken'
                    target.write_bytes(broken)
                    app.start(expect_failure=True)
                    self.assertEqual(target.read_bytes(), broken)
                finally:
                    app.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
