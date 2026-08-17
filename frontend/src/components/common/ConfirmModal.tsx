import { useEffect, useRef } from 'react';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const BTN_PRIMARY = 'border border-[#ff6c37] bg-[#ff6c37] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#f95e26] disabled:opacity-50';
const BTN_SECONDARY = 'border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50';
const BTN_DANGER = 'border border-rose-800 bg-rose-950/60 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-900/60 disabled:opacity-50';

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  busy = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [busy, onClose]);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const confirmBtnClass = variant === 'danger' ? BTN_DANGER : BTN_PRIMARY;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target && !busy) onClose();
      }}
    >
      <div className="w-full max-w-sm border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
        <div className="border-b border-gray-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
          <p className="mt-1 text-xs text-gray-500">{message}</p>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <button
            onClick={onClose}
            className={BTN_SECONDARY}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={confirmBtnClass}
            disabled={busy}
          >
            {busy ? 'Please wait...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
