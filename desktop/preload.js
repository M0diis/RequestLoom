const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopShell', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  startDrag: () => ipcRenderer.invoke('window:start-drag'),
  moveDrag: () => ipcRenderer.send('window:drag-move'),
  stopDrag: () => ipcRenderer.invoke('window:stop-drag'),
  onMaximizeChanged: (callback) => {
    const handler = (_event, isMaximized) => {
      callback(Boolean(isMaximized));
    };

    ipcRenderer.on('window:maximized-changed', handler);

    return () => {
      ipcRenderer.removeListener('window:maximized-changed', handler);
    };
  },
});
