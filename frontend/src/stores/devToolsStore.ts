import { create } from 'zustand';

export interface NetworkEntry {
  id: string;
  requestId: string;
  method: string;
  url: string;
  domain: string;
  path: string;
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  startedAt: string;
  error?: string;
}

interface RecordNetworkEntryInput {
  requestId: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  startedAt: string;
  error?: string;
}

interface DevToolsState {
  networkEntries: NetworkEntry[];
  recordNetworkEntry: (entry: RecordNetworkEntryInput) => void;
  clearNetworkEntries: () => void;
}

function getUrlParts(value: string) {
  try {
    const parsed = new URL(value);
    return {
      domain: parsed.host || '—',
      path: `${parsed.pathname || '/'}${parsed.search}`,
    };
  } catch {
    return { domain: '—', path: value || '—' };
  }
}

export const useDevToolsStore = create<DevToolsState>((set) => ({
  networkEntries: [],

  recordNetworkEntry: (entry) => {
    const parts = getUrlParts(entry.url);
    const nextEntry: NetworkEntry = {
      ...entry,
      id: `${entry.requestId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...parts,
      durationMs: Math.max(0, Math.round(entry.durationMs)),
      sizeBytes: Math.max(0, entry.sizeBytes || 0),
    };

    set((state) => ({ networkEntries: [nextEntry, ...state.networkEntries].slice(0, 200) }));
  },

  clearNetworkEntries: () => set({ networkEntries: [] }),
}));

