const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopShell', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  reloadApp: () => ipcRenderer.invoke('app:reload'),
  onMaximizeChanged: (callback) => {
    const handler = (_event, isMaximized) => {
      callback(Boolean(isMaximized));
    };

    ipcRenderer.on('window:maximized-changed', handler);

    return () => {
      ipcRenderer.removeListener('window:maximized-changed', handler);
    };
  },
  selectDirectory: () => ipcRenderer.invoke('shell:select-directory'),
  revealPath: (targetPath) => ipcRenderer.invoke('shell:reveal-path', targetPath),
  startTerminal: (cwd) => ipcRenderer.invoke('terminal:start', cwd),
  writeTerminal: (terminalId, input) => ipcRenderer.send('terminal:write', terminalId, input),
  killTerminal: (terminalId) => ipcRenderer.invoke('terminal:kill', terminalId),
  onTerminalData: (callback) => {
    const handler = (_event, terminalId, data) => callback(String(terminalId), String(data));
    ipcRenderer.on('terminal:data', handler);
    return () => ipcRenderer.removeListener('terminal:data', handler);
  },
  onTerminalError: (callback) => {
    const handler = (_event, terminalId, message) => callback(String(terminalId), String(message));
    ipcRenderer.on('terminal:error', handler);
    return () => ipcRenderer.removeListener('terminal:error', handler);
  },
  onTerminalExit: (callback) => {
    const handler = (_event, terminalId, code) => callback(String(terminalId), Number(code));
    ipcRenderer.on('terminal:exit', handler);
    return () => ipcRenderer.removeListener('terminal:exit', handler);
  },
});
