import { useEffect, useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react';
import { useUiStore } from '../../stores/uiStore';

function terminalInput(event: KeyboardEvent<HTMLPreElement>): string | null {
  if (event.ctrlKey && event.key.length === 1) {
    const key = event.key.toLowerCase();
    if (key === 'c') return '\u0003';
    if (key === 'd') return '\u0004';
    if (key === 'l') return '\u000c';
  }

  const controlKeys: Record<string, string> = {
    Enter: '\r',
    Backspace: '\b',
    Tab: '\t',
    Escape: '\u001b',
    ArrowUp: '\u001b[A',
    ArrowDown: '\u001b[B',
    ArrowRight: '\u001b[C',
    ArrowLeft: '\u001b[D',
    Home: '\u001b[H',
    End: '\u001b[F',
    Delete: '\u001b[3~',
  };
  if (controlKeys[event.key]) return controlKeys[event.key];
  if (event.altKey && event.key.length === 1) return `\u001b${event.key}`;
  return event.key.length === 1 ? event.key : null;
}

export function TerminalPanel() {
  const { terminalOpen, terminalCwd } = useUiStore();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const outputRef = useRef<HTMLPreElement>(null);
  const desktopShell = window.desktopShell;

  useEffect(() => {
    if (!terminalOpen || !desktopShell) return;

    let disposed = false;
    let currentSessionId: string | null = null;
    setOutput('');
    const append = (value: string) => setOutput((previous) => `${previous}${value}`);
    const unsubscribeData = desktopShell.onTerminalData((id, data) => {
      if (id === currentSessionId) append(data);
    });
    const unsubscribeError = desktopShell.onTerminalError((id, message) => {
      if (id === currentSessionId) append(`\r\n[terminal error] ${message}\r\n`);
    });
    const unsubscribeExit = desktopShell.onTerminalExit((id, code) => {
      if (id === currentSessionId) {
        append(`\r\n[process exited with code ${code}]\r\n`);
        setSessionId(null);
      }
    });

    void desktopShell.startTerminal(terminalCwd || undefined).then((id) => {
      if (disposed) {
        void desktopShell.killTerminal(id);
        return;
      }
      currentSessionId = id;
      setSessionId(id);
      window.setTimeout(() => outputRef.current?.focus(), 0);
    }).catch((error: unknown) => {
      append(`\r\n[failed to start terminal] ${error instanceof Error ? error.message : String(error)}\r\n`);
    });

    return () => {
      disposed = true;
      unsubscribeData();
      unsubscribeError();
      unsubscribeExit();
      if (currentSessionId) void desktopShell.killTerminal(currentSessionId);
      setSessionId(null);
    };
  }, [desktopShell, terminalCwd, terminalOpen]);

  useEffect(() => {
    const element = outputRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [output]);

  const handleKeyDown = (event: KeyboardEvent<HTMLPreElement>) => {
    if (!sessionId || !desktopShell) return;
    const input = terminalInput(event);
    if (input == null) return;
    event.preventDefault();
    desktopShell.writeTerminal(sessionId, input);
  };

  const handlePaste = (event: ClipboardEvent<HTMLPreElement>) => {
    if (!sessionId || !desktopShell) return;
    event.preventDefault();
    desktopShell.writeTerminal(sessionId, event.clipboardData.getData('text'));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0b0b] text-gray-300">
      <div className="flex h-6 flex-shrink-0 items-center border-b border-gray-900 px-3 font-mono text-[10px] text-gray-600">
        <span className="truncate" title={terminalCwd}>{terminalCwd || 'Workspace terminal'}</span>
        <button
          type="button"
          onClick={() => setOutput('')}
          className="ml-auto px-1.5 text-gray-600 hover:text-gray-300"
        >
          Clear
        </button>
      </div>
      <pre
        ref={outputRef}
        tabIndex={0}
        role="textbox"
        aria-label="Integrated terminal"
        onClick={() => outputRef.current?.focus()}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className="min-h-0 flex-1 cursor-text overflow-auto px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre-wrap outline-none"
      >
        {!desktopShell ? 'Integrated terminal is available in the desktop app.' : (output || 'Starting terminal…')}
      </pre>
    </div>
  );
}
