import { useEffect, useRef, useState } from 'react';
import { useToastStore, type Toast } from '../../stores/toastStore';

const VARIANT_CLASS: Record<Toast['variant'], string> = {
  success: 'border-emerald-800/80 text-emerald-200',
  error: 'border-rose-800/80 text-rose-200',
  info: 'border-gray-700 text-gray-200',
};

const VARIANT_DOT: Record<Toast['variant'], string> = {
  success: 'bg-emerald-400',
  error: 'bg-rose-400',
  info: 'bg-cyan-400',
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.durationMs);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, dismiss, toast.id]);

  return (
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`pointer-events-auto flex min-w-[240px] max-w-[380px] items-center gap-2.5 border bg-[#1b1b1b] px-3 py-2 text-xs shadow-[0_12px_30px_rgba(0,0,0,0.5)] ${VARIANT_CLASS[toast.variant]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 flex-shrink-0 ${VARIANT_DOT[toast.variant]}`} />
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            dismiss(toast.id);
          }}
          className="border border-[#ff6c37]/70 px-2 py-0.5 text-[11px] font-semibold text-[#ffb59a] hover:bg-[#ff6c37]/20"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="p-0.5 text-gray-500 hover:text-gray-200"
        aria-label="Dismiss notification"
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex flex-col items-end gap-2" aria-live="polite">
      {toasts.map((item) => <ToastItem key={item.id} toast={item} />)}
    </div>
  );
}
