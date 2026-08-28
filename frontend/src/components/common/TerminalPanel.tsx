import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { useUiStore } from '../../stores/uiStore';

export function TerminalPanel() {
  const { terminalOpen, terminalCwd } = useUiStore();
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const desktopShell = window.desktopShell;

  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!terminalOpen || !container) return;

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      fontSize: 12,
      scrollback: 10000,
      theme: {
        background: '#0b0b0b',
        foreground: '#d4d4d4',
        cursor: '#ffb59a',
        selectionBackground: '#3f3f46',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;

    let currentSessionId: string | null = null;
    let disposed = false;
    let lineInputLength = 0;
    const pendingOutput: string[] = [];
    const backspace = String.fromCharCode(8);

    const writeShellOutput = (data: string) => {
      // Redirected PowerShell emits only BS, which moves xterm's cursor but
      // leaves the old glyph painted. Add the erase space and move back.
      terminal.write(data.split(backspace).join(`${backspace} ${backspace}`));
    };

    const fitTerminal = () => {
      try {
        fitAddon.fit();
      } catch {
        // The terminal can briefly be hidden while switching Dev Tools tabs.
      }
    };

    const resizeObserver = new ResizeObserver(fitTerminal);
    resizeObserver.observe(container);
    window.requestAnimationFrame(fitTerminal);

    const sendInput = (data: string) => {
      if (currentSessionId && desktopShell) {
        desktopShell.writeTerminal(currentSessionId, data);
      }
    };

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || event.key !== 'Delete' || event.ctrlKey || event.altKey || event.metaKey) {
        return true;
      }

      // PowerShell running through redirected stdin does not understand the
      // xterm Delete escape sequence. Treat Delete as Backspace and ignore it
      // at an empty prompt instead of sending a sequence that can be parsed as
      // an invalid command.
      if (lineInputLength > 0) {
        lineInputLength -= 1;
        sendInput('\b');
      }
      return false;
    });

    const inputDisposable = terminal.onData((data) => {
      if (data === '\x7f' || data === '\b') {
        if (lineInputLength === 0) return;
        lineInputLength -= 1;
      } else if (data === '\r' || data === '\n') {
        lineInputLength = 0;
      } else if (data === '\x03' || data === '\x04') {
        lineInputLength = 0;
      } else if (!data.startsWith('\x1b')) {
        lineInputLength += data.length;
      }

      sendInput(data);
    });

    const unsubscribeData = desktopShell?.onTerminalData((id, data) => {
      if (disposed) return;
      if (id === currentSessionId) {
        writeShellOutput(data);
      } else if (!currentSessionId) {
        pendingOutput.push(data);
      }
    });
    const unsubscribeError = desktopShell?.onTerminalError((id, message) => {
      if (disposed) return;
      if (id === currentSessionId) terminal.write(`\r\n[terminal error] ${message}\r\n`);
    });
    const unsubscribeExit = desktopShell?.onTerminalExit((id, code) => {
      if (disposed) return;
      if (id === currentSessionId) {
        terminal.write(`\r\n[process exited with code ${code}]\r\n`);
        currentSessionId = null;
      }
    });

    if (!desktopShell) {
      terminal.write('Integrated terminal is available in the desktop app.\r\n');
    } else {
      void desktopShell.startTerminal(terminalCwd || undefined).then((id) => {
        if (disposed) {
          void desktopShell.killTerminal(id);
          return;
        }
        currentSessionId = id;
        if (pendingOutput.length > 0) writeShellOutput(pendingOutput.join(''));
        terminal.focus();
        fitTerminal();
      }).catch((error: unknown) => {
        terminal.write(`\r\n[failed to start terminal] ${error instanceof Error ? error.message : String(error)}\r\n`);
      });
    }

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      unsubscribeData?.();
      unsubscribeError?.();
      unsubscribeExit?.();
      if (currentSessionId && desktopShell) void desktopShell.killTerminal(currentSessionId);
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [desktopShell, terminalCwd, terminalOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0b0b] text-gray-300">
      <div className="flex h-6 flex-shrink-0 items-center border-b border-gray-900 px-3 font-mono text-[10px] text-gray-600">
        <span className="truncate" title={terminalCwd}>{terminalCwd || 'Workspace terminal'}</span>
        <button
          type="button"
          onClick={() => terminalRef.current?.clear()}
          className="ml-auto px-1.5 text-gray-600 hover:text-gray-300"
        >
          Clear
        </button>
      </div>
      <div ref={terminalContainerRef} className="xterm-container min-h-0 flex-1 overflow-hidden px-2 py-1" />
    </div>
  );
}
