/** Install the native Tauri API before React components capture the desktop bridge. */
export async function initializeDesktopShell(): Promise<void> {
  const tauri = window.__TAURI__;
  if (!tauri) return;

  const nativeWindow = tauri.window.getCurrentWindow();
  const maximizedListeners = new Set<(isMaximized: boolean) => void>();
  const listen = async <T,>(event: string, callback: (payload: T) => void): Promise<() => void> =>
    tauri.event.listen<T>(event, ({ payload }) => callback(payload));

  const subscribe = <T,>(event: string, callback: (payload: T) => void): (() => void) => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void listen(event, callback).then((stop) => {
      if (disposed) stop();
      else unsubscribe = stop;
    }).catch((error: unknown) => console.error(`Failed to subscribe to ${event}.`, error));
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  };

  window.desktopShell = {
    minimize: () => nativeWindow.minimize(),
    maximizeToggle: async () => {
      await nativeWindow.toggleMaximize();
      return nativeWindow.isMaximized();
    },
    close: () => nativeWindow.close(),
    isMaximized: () => nativeWindow.isMaximized(),
    startDrag: async () => {
      await nativeWindow.startDragging();
      return true;
    },
    moveDrag: () => {},
    stopDrag: async () => {},
    reloadApp: () => tauri.core.invoke<boolean>('restart_backend'),
    onMaximizeChanged: (callback) => {
      maximizedListeners.add(callback);
      return () => maximizedListeners.delete(callback);
    },
    selectDirectory: () => tauri.core.invoke<string | null>('select_directory'),
    revealPath: (targetPath) => tauri.core.invoke<boolean>('reveal_path', { targetPath }),
    saveFile: (filename, contents, mimeType) =>
      tauri.core.invoke<boolean>('save_file', { filename, contents, mimeType }),
    writeClipboard: (value) => tauri.core.invoke<void>('write_clipboard', { value }),
    openOAuthWindow: (url, redirectUri) => tauri.core.invoke<boolean>('open_oauth_window', { url, redirectUri }),
    onOAuthCallback: (callback) => listen<OAuthCallbackPayload>('oauth-callback', callback),
    startTerminal: (cwd) => tauri.core.invoke<string>('start_terminal', { cwd: cwd ?? null }),
    writeTerminal: (terminalId, input) => {
      void tauri.core.invoke<void>('write_terminal', { terminalId, input }).catch((error: unknown) => {
        console.error('Failed to write to the integrated terminal.', error);
      });
    },
    killTerminal: (terminalId) => tauri.core.invoke<boolean>('kill_terminal', { terminalId }),
    onTerminalData: (callback) => subscribe<{ terminalId: string; data: string }>('terminal-data', ({ terminalId, data }) => callback(terminalId, data)),
    onTerminalError: (callback) => subscribe<{ terminalId: string; message: string }>('terminal-error', ({ terminalId, message }) => callback(terminalId, message)),
    onTerminalExit: (callback) => subscribe<{ terminalId: string; code: number }>('terminal-exit', ({ terminalId, code }) => callback(terminalId, code)),
  };

  void nativeWindow.onResized(() => {
    void nativeWindow.isMaximized().then((maximized) => {
      for (const callback of maximizedListeners) callback(maximized);
    });
  }).catch((error: unknown) => console.error('Failed to observe window state.', error));
}
