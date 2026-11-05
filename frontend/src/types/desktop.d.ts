export {};

declare global {
  interface OAuthCallbackPayload {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }

  interface DesktopShellApi {
    minimize: () => Promise<void>;
    maximizeToggle: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    startDrag: () => Promise<boolean>;
    moveDrag: () => void;
    stopDrag: () => Promise<void>;
    reloadApp: () => Promise<boolean>;
    onMaximizeChanged: (callback: (isMaximized: boolean) => void) => () => void;
    selectDirectory: () => Promise<string | null>;
    revealPath: (targetPath: string) => Promise<boolean>;
    saveFile: (filename: string, contents: string, mimeType: string) => Promise<boolean>;
    writeClipboard: (value: string) => Promise<void>;
    openOAuthWindow: (url: string, redirectUri: string) => Promise<boolean>;
    onOAuthCallback: (callback: (payload: OAuthCallbackPayload) => void) => Promise<() => void>;
    startTerminal: (cwd?: string) => Promise<string>;
    writeTerminal: (terminalId: string, input: string) => void;
    killTerminal: (terminalId: string) => Promise<boolean>;
    onTerminalData: (callback: (terminalId: string, data: string) => void) => () => void;
    onTerminalError: (callback: (terminalId: string, message: string) => void) => () => void;
    onTerminalExit: (callback: (terminalId: string, code: number) => void) => () => void;
  }

  interface TauriApi {
    core: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    };
    event: {
      listen<T>(event: string, callback: (event: { payload: T }) => void): Promise<() => void>;
    };
    window: {
      getCurrentWindow(): {
        minimize(): Promise<void>;
        toggleMaximize(): Promise<void>;
        close(): Promise<void>;
        isMaximized(): Promise<boolean>;
        startDragging(): Promise<void>;
        onResized(callback: () => void): Promise<() => void>;
      };
    };
  }

  interface Window {
    desktopShell?: DesktopShellApi;
    __TAURI__?: TauriApi;
  }
}
