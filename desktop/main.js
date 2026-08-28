const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const APP_URL = process.env.REQUESTLOOM_APP_URL || 'http://127.0.0.1:5056';
const DEBUG_MODE = process.env.REQUESTLOOM_ELECTRON_DEBUG === '1';
const HEALTH_PATH = '/api/workspaces';
const STARTUP_TIMEOUT_MS = 120000;
const RETRY_INTERVAL_MS = 500;

let backendProcess = null;
let shuttingDown = false;

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

function getBackendLogPath() {
  return path.join(getBackendDir(), 'desktop-backend.log');
}

function appendLog(message) {
  try {
    fs.appendFileSync(getBackendLogPath(), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Ignore logging failures in desktop shell.
  }
}

let activeDrag = null;

function registerWindowControlHandlers() {
  ipcMain.handle('window:start-drag', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const [winX, winY] = win.getPosition();
    const { x: startX, y: startY } = screen.getCursorScreenPoint();
    activeDrag = { win, winX, winY, startX, startY };
  });

  ipcMain.on('window:drag-move', () => {
    if (!activeDrag) return;
    const { win, winX, winY, startX, startY } = activeDrag;
    if (win.isDestroyed()) { activeDrag = null; return; }
    const { x, y } = screen.getCursorScreenPoint();
    win.setPosition(Math.round(winX + (x - startX)), Math.round(winY + (y - startY)));
  });

  ipcMain.handle('window:stop-drag', () => {
    activeDrag = null;
  });

  ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.handle('window:maximize-toggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return false;
    }

    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }

    return win.isMaximized();
  });

  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  ipcMain.handle('window:is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
  });
}

function broadcastMaximizedState(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.webContents.send('window:maximized-changed', win.isMaximized());
}

function waitForBackendReady(baseUrl, timeoutMs) {
  const started = Date.now();
  const targetUrl = new URL(HEALTH_PATH, baseUrl);

  return new Promise((resolve, reject) => {
    const tryOnce = () => {
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

function startBackend() {
  const backendDir = getBackendDir();
  const exePath = getBackendExecutablePath();

  if (!fs.existsSync(exePath)) {
    throw new Error(`Backend executable missing: ${exePath}`);
  }

  appendLog(`Starting backend executable: ${exePath}`);

  backendProcess = spawn(exePath, [], {
    cwd: backendDir,
    env: {
      ...process.env,
      ASPNETCORE_URLS: APP_URL,
    },
    windowsHide: true,
    stdio: 'pipe',
  });

  backendProcess.stdout.on('data', (chunk) => {
    appendLog(`[stdout] ${String(chunk).trimEnd()}`);
  });

  backendProcess.stderr.on('data', (chunk) => {
    appendLog(`[stderr] ${String(chunk).trimEnd()}`);
  });

  backendProcess.on('exit', (code, signal) => {
    appendLog(`Backend exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);

    if (shuttingDown) {
      return;
    }

    dialog.showErrorBox(
      'RequestLoom Backend Stopped',
      `The embedded backend exited unexpectedly.\nCode: ${code ?? 'null'}\nSignal: ${signal ?? 'null'}\n\nSee desktop-backend.log in the app folder for details.`
    );

    app.quit();
  });

  backendProcess.on('error', (err) => {
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

function createMainWindow() {
  const windowOptions = {
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
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
  stopBackend();
});

app.whenReady().then(async () => {
  registerWindowControlHandlers();
  const mainWindow = createMainWindow();

  try {
    startBackend();
    await waitForBackendReady(APP_URL, STARTUP_TIMEOUT_MS);
    await mainWindow.loadURL(APP_URL);

    if (DEBUG_MODE) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox('Failed To Start RequestLoom', message);
    stopBackend();
    app.quit();
  }
});
