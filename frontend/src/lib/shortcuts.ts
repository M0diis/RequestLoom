const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? 'Cmd' : 'Ctrl';
const ALT = isMac ? 'Option' : 'Alt';

export type ShortcutId =
  | 'send'
  | 'save'
  | 'newRequest'
  | 'commandPalette'
  | 'closeTab'
  | 'nextTab'
  | 'previousTab'
  | 'focusUrl'
  | 'servicesPanel'
  | 'variablesPanel'
  | 'mocksPanel'
  | 'docsPanel'
  | 'toggleLayout'
  | 'toggleResponseView';

export const SHORTCUTS: Record<ShortcutId, { keys: string; action: string }> = {
  send: { keys: `${MOD}+Enter`, action: 'Send the current request' },
  save: { keys: `${MOD}+S`, action: 'Save the current request' },
  newRequest: { keys: `${MOD}+N`, action: 'Create a new request' },
  commandPalette: { keys: `${MOD}+K`, action: 'Open the command palette' },
  closeTab: { keys: `${MOD}+W`, action: 'Close the current tab' },
  nextTab: { keys: `${MOD}+Tab`, action: 'Switch to the next tab' },
  previousTab: { keys: `${MOD}+Shift+Tab`, action: 'Switch to the previous tab' },
  focusUrl: { keys: `${MOD}+L`, action: 'Focus the URL bar' },
  servicesPanel: { keys: `${MOD}+${ALT}+1`, action: 'Switch to Services panel' },
  variablesPanel: { keys: `${MOD}+${ALT}+2`, action: 'Switch to Variables panel' },
  mocksPanel: { keys: `${MOD}+${ALT}+3`, action: 'Switch to Mock Servers panel' },
  docsPanel: { keys: `${MOD}+${ALT}+4`, action: 'Switch to Docs panel' },
  toggleLayout: { keys: `${MOD}+${ALT}+L`, action: 'Toggle response layout (bottom/right)' },
  toggleResponseView: { keys: `${MOD}+${ALT}+P`, action: 'Toggle response view (pretty/raw)' },
};

/** Tooltip text with the shortcut appended, e.g. "Send (Ctrl+Enter)". */
export function withShortcut(label: string, id: ShortcutId) {
  return `${label} (${SHORTCUTS[id].keys})`;
}
