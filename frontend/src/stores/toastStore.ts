import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  durationMs: number;
  /** Runs once when the toast leaves the screen for any reason. */
  onDismiss?: () => void;
}

interface ToastOptions {
  variant?: ToastVariant;
  action?: ToastAction;
  durationMs?: number;
  onDismiss?: () => void;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const MAX_TOASTS = 4;
const RELOAD_TOAST_KEY = 'requestloom:toast-after-reload';
let nextToastId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, options = {}) => {
    const id = nextToastId++;
    const toast: Toast = {
      id,
      message,
      variant: options.variant ?? 'success',
      action: options.action,
      durationMs: options.durationMs ?? (options.action ? 6000 : options.variant === 'error' ? 5000 : 2500),
      onDismiss: options.onDismiss,
    };
    const next = [...get().toasts, toast];
    const evicted = next.slice(0, Math.max(0, next.length - MAX_TOASTS));
    set({ toasts: next.slice(-MAX_TOASTS) });
    evicted.forEach((item) => item.onDismiss?.());
    return id;
  },
  dismiss: (id) => {
    const target = get().toasts.find((item) => item.id === id);
    if (!target) return;
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
    target.onDismiss?.();
  },
}));

/** Convenience wrapper so callers outside React can raise a toast. */
export function toast(message: string, options?: ToastOptions): number {
  return useToastStore.getState().show(message, options);
}

/** Shows a toast once the page has reloaded (e.g. after a full import). */
export function toastAfterReload(message: string) {
  try { sessionStorage.setItem(RELOAD_TOAST_KEY, message); } catch { /* storage unavailable */ }
}

export function flushReloadToast() {
  try {
    const message = sessionStorage.getItem(RELOAD_TOAST_KEY);
    if (!message) return;
    sessionStorage.removeItem(RELOAD_TOAST_KEY);
    toast(message);
  } catch { /* storage unavailable */ }
}

/** Copies text and reports the outcome as a toast. */
export async function copyWithToast(text: string, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast('Could not copy to clipboard', { variant: 'error' });
  }
}
