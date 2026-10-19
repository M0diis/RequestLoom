import { toast } from '../stores/toastStore';

/**
 * Deletes are applied to the UI immediately and committed to the backend once
 * the Undo toast goes away. Undo restores the hidden items without a round trip.
 */
interface PendingDelete {
  commit: () => Promise<void>;
  /** Backend URLs to DELETE with keepalive if the page unloads first. */
  unloadUrls: string[];
}

interface UndoableDeleteOptions {
  message: string;
  hide: () => void;
  restore: () => void;
  commit: () => Promise<void>;
  unloadUrls: string[];
}

const pendingDeletes = new Map<number, PendingDelete>();
let nextPendingId = 1;

export function scheduleUndoableDelete({ message, hide, restore, commit, unloadUrls }: UndoableDeleteOptions) {
  const id = nextPendingId++;
  hide();

  const run = async () => {
    if (!pendingDeletes.delete(id)) return;
    try {
      await commit();
    } catch (error) {
      restore();
      toast(error instanceof Error ? `Delete failed: ${error.message}` : 'Delete failed', { variant: 'error' });
    }
  };

  pendingDeletes.set(id, { commit: run, unloadUrls });
  toast(message, {
    variant: 'info',
    durationMs: 6000,
    action: {
      label: 'Undo',
      onClick: () => {
        if (!pendingDeletes.delete(id)) return;
        restore();
      },
    },
    onDismiss: () => { void run(); },
  });
}

/** Commits every pending delete now, e.g. before reloading data from the backend. */
export async function flushPendingDeletes() {
  await Promise.all([...pendingDeletes.values()].map((pending) => pending.commit()));
}

export function hasPendingDeletes() {
  return pendingDeletes.size > 0;
}

/** Best-effort commit while the page is unloading; keepalive lets the requests outlive the page. */
export function flushPendingDeletesOnUnload() {
  for (const pending of pendingDeletes.values()) {
    for (const url of pending.unloadUrls) {
      void fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
    }
  }
  pendingDeletes.clear();
}
