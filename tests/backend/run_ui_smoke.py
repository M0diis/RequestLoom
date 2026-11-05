"""Build frontend/backend first. Runs Chromium against temporary backend storage."""
import functools
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import test_regressions as backend

if os.environ.get('REQUESTLOOM_TEST_DLL'):
    backend.DLL = Path(os.environ['REQUESTLOOM_TEST_DLL'])
frontend = Path(os.environ.get('REQUESTLOOM_TEST_FRONTEND', str(backend.ROOT / 'frontend')))
with tempfile.TemporaryDirectory(prefix='requestloom-ui-') as directory:
    app = backend.Backend(directory=directory).start()
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(SimpleHTTPRequestHandler, directory=str(frontend / 'dist')))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        env = dict(os.environ, REQUESTLOOM_API=f'http://127.0.0.1:{app.port}',
                   REQUESTLOOM_UI=f'http://127.0.0.1:{server.server_port}',
                   REQUESTLOOM_SCREENSHOT=str(Path(tempfile.gettempdir()) / 'requestloom-extraction.png'))
        subprocess.run(['node', str(frontend / 'tests/request-workflows.e2e.cjs')], env=env, check=True)
    finally:
        server.shutdown()
        server.server_close()
        app.stop()
