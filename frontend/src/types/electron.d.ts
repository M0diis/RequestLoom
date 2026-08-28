export {};

declare global {
  interface DesktopShellApi {
    minimize: () => Promise<void>;
    maximizeToggle: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    reloadApp: () => Promise<boolean>;
    onMaximizeChanged: (callback: (isMaximized: boolean) => void) => () => void;
    selectDirectory: () => Promise<string | null>;
    revealPath: (targetPath: string) => Promise<boolean>;
    startTerminal: (cwd?: string) => Promise<string>;
    writeTerminal: (terminalId: string, input: string) => void;
    killTerminal: (terminalId: string) => Promise<boolean>;
    onTerminalData: (callback: (terminalId: string, data: string) => void) => () => void;
    onTerminalError: (callback: (terminalId: string, message: string) => void) => () => void;
    onTerminalExit: (callback: (terminalId: string, code: number) => void) => () => void;
  }

  interface Window {
    desktopShell?: DesktopShellApi;
  }
}
