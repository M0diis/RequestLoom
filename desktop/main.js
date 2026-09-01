const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');
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

function stopActiveDrag() {
  activeDrag = null;
}

function registerWindowControlHandlers() {
  ipcMain.handle('window:start-drag', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || win.isMaximized()) return false;

    const [winX, winY] = win.getPosition();
    const { x: startX, y: startY } = screen.getCursorScreenPoint();
    activeDrag = { win, winX, winY, startX, startY };
    return true;
  });

  ipcMain.on('window:drag-move', () => {
    if (!activeDrag) return;

    const { win, winX, winY, startX, startY } = activeDrag;
    if (win.isDestroyed()) {
      activeDrag = null;
      return;
    }

    const { x, y } = screen.getCursorScreenPoint();
    win.setPosition(Math.round(winX + (x - startX)), Math.round(winY + (y - startY)));
  });

  ipcMain.handle('window:stop-drag', () => {
    stopActiveDrag();
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

function registerDesktopUtilityHandlers() {
  ipcMain.handle('app:reload', async (event) => {
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
      await waitForBackendReady(APP_URL, STARTUP_TIMEOUT_MS);
      if (win && !win.isDestroyed()) {
        await win.loadURL(APP_URL);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Application reload failed: ${message}`);
      dialog.showErrorBox('Failed To Reload RequestLoom', message);
      return false;
    } finally {
      reloadingBackend = false;
    }
  });

  ipcMain.handle('shell:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose collection folder',
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('shell:reveal-path', (_event, targetPath) => {
    if (typeof targetPath !== 'string' || !targetPath.trim()) return false;
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved)) return false;
    shell.showItemInFolder(resolved);
    return true;
  });

  ipcMain.handle('terminal:start', (event, cwd) => {
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

  ipcMain.on('terminal:write', (_event, terminalId, input) => {
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

  ipcMain.handle('terminal:kill', (_event, terminalId) => {
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

  const child = spawn(exePath, [], {
    cwd: backendDir,
    env: {
      ...process.env,
      ASPNETCORE_URLS: APP_URL,
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

    dialog.showErrorBox(
      'RequestLoom Backend Stopped',
      `The embedded backend exited unexpectedly.\nCode: ${code ?? 'null'}\nSignal: ${signal ?? 'null'}\n\nSee desktop-backend.log in the app folder for details.`
    );

    app.quit();
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

app.whenReady().then(async () => {
  registerWindowControlHandlers();
  registerDesktopUtilityHandlers();
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
