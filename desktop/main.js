const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');

const PREFERRED_PORT = 5056;
// Resolved at startup: the preferred port when free (keeps the web origin, and so
// its localStorage, stable between launches), otherwise a free loopback port.
let APP_URL = process.env.REQUESTLOOM_APP_URL || `http://127.0.0.1:${PREFERRED_PORT}`;
const DEBUG_MODE = process.env.REQUESTLOOM_ELECTRON_DEBUG === '1';
const HEALTH_PATH = '/api/workspaces';
const STARTUP_TIMEOUT_MS = 60000;
const PAGE_LOAD_TIMEOUT_MS = 30000;
const RETRY_INTERVAL_MS = 500;

// Escape hatch for machines whose GPU driver hangs under Chromium compositing.
if (process.env.REQUESTLOOM_DISABLE_GPU === '1') app.disableHardwareAcceleration();

let backendProcess = null;
let shuttingDown = false;
let reloadingBackend = false;
let terminalSequence = 0;
const terminalSessions = new Map();
let activeDrag = null;

function getAppRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app') : __dirname;
}

function getBackendDir() {
  return path.join(getAppRoot(), 'runtime', 'backend');
}

function getBackendExecutablePath() {
  const exeName = process.platform === 'win32' ? 'RequestLoom.Api.exe' : 'RequestLoom.Api';
  return path.join(getBackendDir(), exeName);
}

function getDataDir() {
  return process.env.REQUESTLOOM_DATA_DIR || path.join(app.getPath('userData'), 'data');
}

function getBackendLogPath() {
  return path.join(app.getPath('userData'), 'logs', 'desktop-backend.log');
}

const DATA_FILE_NAMES = ['RequestLoom.db', 'RequestLoom.db-wal', 'RequestLoom.db-shm', 'requestloom-data.json', 'requestloom.settings.json'];
const DATA_DIR_NAMES = ['uploads', 'requestloom-data'];

// Earlier builds kept mutable data beside the bundled backend. Copy it once into the
// per-user data directory (never overwriting) and leave the original in place.
function migrateLegacyData(dataDir) {
  const legacyDir = getBackendDir();
  if (path.resolve(legacyDir) === path.resolve(dataDir)) return;
  const marker = path.join(dataDir, '.legacy-migrated');
  if (fs.existsSync(marker)) return;

  try {
    for (const name of DATA_FILE_NAMES) {
      const from = path.join(legacyDir, name);
      const to = path.join(dataDir, name);
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
    }
    for (const name of DATA_DIR_NAMES) {
      const from = path.join(legacyDir, name);
      const to = path.join(dataDir, name);
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
    }
    fs.writeFileSync(marker, new Date().toISOString());
    appendLog(`Copied legacy data from ${legacyDir} to ${dataDir}.`);
  } catch (error) {
    appendLog(`Legacy data migration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function resolveAppUrl() {
  if (process.env.REQUESTLOOM_APP_URL) return process.env.REQUESTLOOM_APP_URL;
  const port = (await isPortFree(PREFERRED_PORT)) ? PREFERRED_PORT : await getFreePort();
  return `http://127.0.0.1:${port}`;
}

function isTrustedUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') {
      return path.resolve(decodeURIComponent(parsed.pathname.replace(/^\/([A-Za-z]:)/, '$1'))) === path.resolve(__dirname, 'loading.html');
    }
    return parsed.origin === new URL(APP_URL).origin;
  } catch {
    return false;
  }
}

// Privileged IPC is only honoured for the app's own frames.
function isTrustedSender(event) {
  const url = event.senderFrame?.url || event.sender?.getURL?.() || '';
  return isTrustedUrl(url);
}

function trustedHandle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      appendLog(`Rejected IPC ${channel} from untrusted sender.`);
      throw new Error('Untrusted IPC sender.');
    }
    return handler(event, ...args);
  });
}

function trustedOn(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      appendLog(`Rejected IPC ${channel} from untrusted sender.`);
      return;
    }
    handler(event, ...args);
  });
}

function openExternalIfSafe(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') shell.openExternal(url);
  } catch {
    // Ignore malformed URLs.
  }
}

const MAX_LOG_BYTES = 5 * 1024 * 1024;
let logStream = null;

// Backend output is logged per chunk; a synchronous append on the main thread
// (often re-scanned by antivirus) stalls the UI, so write through a stream and
// rotate the file once it gets large.
function getLogStream() {
  if (logStream) return logStream;
  const logPath = getBackendLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  try {
    if (fs.statSync(logPath).size > MAX_LOG_BYTES) fs.renameSync(logPath, `${logPath}.1`);
  } catch {
    // No existing log to rotate.
  }
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.on('error', () => {});
  return logStream;
}

function appendLog(message) {
  try {
    getLogStream().write(`${new Date().toISOString()} ${message}\n`);
  } catch {
    // Ignore logging failures in desktop shell.
  }
}

function stopActiveDrag() {
  if (!activeDrag) return;

  const { win, winX, winY, width, height, startX, startY, resizeLocked } = activeDrag;
  activeDrag = null;

  if (!resizeLocked || win.isDestroyed()) return;

  win.setResizable(true);
  // Toggling the thick frame can nudge the size on Windows; pin it back to the
  // size the drag started with at the final position.
  const { x, y } = screen.getCursorScreenPoint();
  win.setBounds({
    x: Math.round(winX + (x - startX)),
    y: Math.round(winY + (y - startY)),
    width,
    height,
  }, false);
}

function registerWindowControlHandlers() {
  trustedHandle('window:start-drag', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || win.isMaximized()) return false;

    stopActiveDrag();

    const bounds = win.getBounds();
    const { x: startX, y: startY } = screen.getCursorScreenPoint();
    activeDrag = {
      win,
      winX: bounds.x,
      winY: bounds.y,
      width: bounds.width,
      height: bounds.height,
      startX,
      startY,
      resizeLocked: false,
    };
    return true;
  });

  trustedOn('window:drag-move', () => {
    if (!activeDrag) return;

    const { win, winX, winY, width, height, startX, startY } = activeDrag;
    if (win.isDestroyed()) {
      activeDrag = null;
      return;
    }

    // On Windows 11 a resizable frameless window grows towards the right/bottom
    // while it is moved programmatically. Drop the thick frame for the drag;
    // done lazily so plain clicks and double-clicks never toggle it.
    if (!activeDrag.resizeLocked && win.isResizable()) {
      win.setResizable(false);
      activeDrag.resizeLocked = true;
    }

    const { x, y } = screen.getCursorScreenPoint();
    win.setBounds({
      x: Math.round(winX + (x - startX)),
      y: Math.round(winY + (y - startY)),
      width,
      height,
    }, false);
  });

  trustedHandle('window:stop-drag', () => {
    stopActiveDrag();
  });

  trustedHandle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  trustedHandle('window:maximize-toggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return false;
    }

    // Maximizing while the drag has resizing disabled misbehaves on Windows.
    stopActiveDrag();

    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }

    return win.isMaximized();
  });

  trustedHandle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  trustedHandle('window:is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
  });
}

function registerDesktopUtilityHandlers() {
  trustedHandle('app:reload', async (event) => {
    if (reloadingBackend) return false;

    const win = BrowserWindow.fromWebContents(event.sender);
    reloadingBackend = true;
    try {
      const previousProcess = backendProcess;
      if (previousProcess) {
        stopBackend();
        await waitForProcessExit(previousProcess);
      }

      if (win && !win.isDestroyed()) {
        await win.loadFile(path.join(__dirname, 'loading.html'));
      }
      startBackend();
      await waitForBackendReady(APP_URL, STARTUP_TIMEOUT_MS, backendProcess);
      if (win && !win.isDestroyed()) {
        await loadAppUrl(win);
      }
      return true;
    } catch (error) {
      // A window without a working backend is useless; release everything.
      shutDownWithError('Failed To Reload RequestLoom', error);
      return false;
    } finally {
      reloadingBackend = false;
    }
  });

  trustedHandle('shell:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose collection folder',
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  trustedHandle('shell:reveal-path', (_event, targetPath) => {
    if (typeof targetPath !== 'string' || !targetPath.trim()) return false;
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved)) return false;
    shell.showItemInFolder(resolved);
    return true;
  });

  trustedHandle('terminal:start', (event, cwd) => {
    const requestedCwd = typeof cwd === 'string' ? cwd.trim() : '';
    let terminalCwd = process.cwd();
    if (requestedCwd) {
      try {
        if (fs.existsSync(requestedCwd)) {
          const stats = fs.statSync(requestedCwd);
          terminalCwd = stats.isDirectory() ? requestedCwd : path.dirname(requestedCwd);
        }
      } catch (error) {
        appendLog(`Invalid terminal working directory, using app directory: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const terminalId = String(++terminalSequence);
    const shellPath = process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : (process.env.SHELL || '/bin/sh');
    const shellArgs = process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : [];

    let child;
    try {
      child = spawn(shellPath, shellArgs, {
        cwd: terminalCwd,
        env: { ...process.env, TERM: process.env.TERM || 'xterm-256color' },
        windowsHide: true,
        stdio: 'pipe',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Terminal start failed: ${message}`);
      throw new Error(`Unable to start PowerShell: ${message}`);
    }

    terminalSessions.set(terminalId, { child, sender: event.sender });
    const send = (channel, value) => {
      try {
        if (!event.sender.isDestroyed()) event.sender.send(channel, terminalId, value);
      } catch (error) {
        appendLog(`Terminal event delivery failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    child.stdout.on('data', (chunk) => send('terminal:data', String(chunk)));
    child.stderr.on('data', (chunk) => send('terminal:data', String(chunk)));
    child.stdin.on('error', (error) => {
      // The shell can close before the renderer receives its exit event. Never
      // let an asynchronous EPIPE from a late keypress crash Electron.
      appendLog(`Terminal input stream closed: ${error instanceof Error ? error.message : String(error)}`);
    });
    child.on('error', (error) => send('terminal:error', error.message));
    child.on('exit', (code) => {
      terminalSessions.delete(terminalId);
      send('terminal:exit', code ?? 0);
    });

    return terminalId;
  });

  trustedOn('terminal:write', (_event, terminalId, input) => {
    const session = terminalSessions.get(String(terminalId));
    if (!session || typeof input !== 'string') return;
    const stdin = session.child?.stdin;
    if (stdin?.writable && !stdin.destroyed && !stdin.writableEnded) {
      try {
        // xterm.js uses DEL for Backspace; redirected PowerShell input expects BS.
        stdin.write(input.replace(/\x7f/g, '\x08'));
      } catch (error) {
        appendLog(`Terminal write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  trustedHandle('terminal:kill', (_event, terminalId) => {
    const session = terminalSessions.get(String(terminalId));
    if (!session) return false;
    terminalSessions.delete(String(terminalId));
    session.child?.kill();
    return true;
  });
}

function broadcastMaximizedState(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.webContents.send('window:maximized-changed', win.isMaximized());
}

function waitForBackendReady(baseUrl, timeoutMs, child) {
  const started = Date.now();
  const targetUrl = new URL(HEALTH_PATH, baseUrl);

  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      // No point polling for the full timeout once the backend has died.
      if (child && child.exitCode !== null) {
        reject(new Error(`Backend exited during startup (code ${child.exitCode}).`));
        return;
      }

      const req = http.get(targetUrl, (res) => {
        res.resume();

        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }

        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Backend did not become ready (status ${res.statusCode ?? 'unknown'}).`));
          return;
        }

        setTimeout(tryOnce, RETRY_INTERVAL_MS);
      });

      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error('Backend did not become reachable in time.'));
          return;
        }

        setTimeout(tryOnce, RETRY_INTERVAL_MS);
      });

      req.setTimeout(1000, () => {
        req.destroy(new Error('timeout'));
      });
    };

    tryOnce();
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function loadAppUrl(win) {
  return withTimeout(win.loadURL(APP_URL), PAGE_LOAD_TIMEOUT_MS, 'The RequestLoom window did not finish loading in time.');
}

// Single exit path for failures: release the backend, terminals and windows first,
// then report, then exit without waiting on anything that may be hung.
function shutDownWithError(title, error) {
  if (shuttingDown) return;
  shuttingDown = true;

  const message = error instanceof Error ? error.message : String(error);
  appendLog(`${title}: ${message}`);

  stopActiveDrag();
  stopTerminalSessions();
  stopBackend();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }

  dialog.showErrorBox(title, `${message}\n\nSee desktop-backend.log in the RequestLoom user data folder (logs) for details.`);
  app.exit(1);
}

function waitForProcessExit(process, timeoutMs = 10000) {
  if (!process || process.exitCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    process.once('exit', finish);
    process.once('error', finish);
    setTimeout(finish, timeoutMs);
  });
}

function startBackend() {
  const backendDir = getBackendDir();
  const exePath = getBackendExecutablePath();

  if (!fs.existsSync(exePath)) {
    throw new Error(`Backend executable missing: ${exePath}`);
  }

  appendLog(`Starting backend executable: ${exePath}`);

  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.dirname(getBackendLogPath()), { recursive: true });
  migrateLegacyData(dataDir);

  const child = spawn(exePath, [], {
    cwd: backendDir,
    env: {
      ...process.env,
      ASPNETCORE_URLS: APP_URL,
      REQUESTLOOM_DATA_DIR: dataDir,
      // Force workstation GC even for backends published before the csproj change.
      DOTNET_gcServer: '0',
      // Lets the backend stop itself if this process crashes or is force-killed.
      REQUESTLOOM_PARENT_PID: String(process.pid),
    },
    windowsHide: true,
    stdio: 'pipe',
  });
  backendProcess = child;

  child.stdout.on('data', (chunk) => {
    appendLog(`[stdout] ${String(chunk).trimEnd()}`);
  });

  child.stderr.on('data', (chunk) => {
    appendLog(`[stderr] ${String(chunk).trimEnd()}`);
  });

  child.on('exit', (code, signal) => {
    appendLog(`Backend exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    if (backendProcess === child) backendProcess = null;

    if (shuttingDown || reloadingBackend) {
      return;
    }

    shutDownWithError(
      'RequestLoom Backend Stopped',
      `The embedded backend exited unexpectedly.\nCode: ${code ?? 'null'}\nSignal: ${signal ?? 'null'}`
    );
  });

  child.on('error', (err) => {
    appendLog(`Backend process error: ${err.message}`);
  });
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) {
    return;
  }

  appendLog('Stopping backend process.');

  try {
    backendProcess.kill();
  } catch (err) {
    appendLog(`Error while stopping backend: ${err.message}`);
  }
}

function stopTerminalSessions() {
  for (const session of terminalSessions.values()) {
    try {
      session.child?.kill();
    } catch (err) {
      appendLog(`Error while stopping terminal: ${err.message}`);
    }
  }
  terminalSessions.clear();
}

function createMainWindow() {
  const windowOptions = {
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    // Keep native resizing enabled. Resize messages are blocked below only
    // while the custom titlebar drag is active.
    resizable: true,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    // Match the titlebar color in the native top resize area.
    backgroundColor: '#1a1a1a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  };

  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
  }

  const win = new BrowserWindow(windowOptions);

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isTrustedUrl(url)) return;
    event.preventDefault();
    openExternalIfSafe(url);
  });

  // Only suppress native resize messages while our custom titlebar drag is
  // active. Normal edge/corner resizing must remain available to the user.
  win.on('will-resize', (event) => {
    if (activeDrag?.win === win) {
      event.preventDefault();
    }
  });
  win.on('closed', stopActiveDrag);
  win.on('maximize', () => broadcastMaximizedState(win));
  win.on('unmaximize', () => broadcastMaximizedState(win));

  win.once('ready-to-show', () => {
    broadcastMaximizedState(win);
    win.show();
  });

  win.loadFile(path.join(__dirname, 'loading.html'));
  return win;
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  shuttingDown = true;
  stopActiveDrag();
  stopTerminalSessions();
  stopBackend();
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  APP_URL = await resolveAppUrl();
  registerWindowControlHandlers();
  registerDesktopUtilityHandlers();
  const mainWindow = createMainWindow();

  try {
    startBackend();
    await waitForBackendReady(APP_URL, STARTUP_TIMEOUT_MS, backendProcess);
    await loadAppUrl(mainWindow);

    if (DEBUG_MODE) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } catch (err) {
    shutDownWithError('Failed To Start RequestLoom', err);
  }
});
