export {};

declare global {
  interface DesktopShellApi {
    minimize: () => Promise<void>;
    maximizeToggle: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    startDrag: () => Promise<void>;
    moveDrag: () => void;
    stopDrag: () => Promise<void>;
    onMaximizeChanged: (callback: (isMaximized: boolean) => void) => () => void;
  }

  interface Window {
    desktopShell?: DesktopShellApi;
  }
}
