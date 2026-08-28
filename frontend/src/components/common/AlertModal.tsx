import { useEffect, useId, useRef } from 'react';

interface AlertModalProps {
  title?: string;
  message: string;
  closeLabel?: string;
  onClose: () => void;
}

const BTN_PRIMARY = 'border border-cyan-400 bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-gray-950 hover:bg-cyan-400';

export function AlertModal({
  title = 'Notice',
  message,
  closeLabel = 'OK',
  onClose,
}: AlertModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const messageId = `${modalId}-message`;

  useEffect(() => {
    closeRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        className="w-full max-w-sm border border-gray-700 bg-[#24222d] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <div className="border-b border-gray-700/70 px-4 py-3">
          <h3 id={titleId} className="text-sm font-semibold text-gray-100">{title}</h3>
        </div>
        <div className="px-4 py-4">
          <p id={messageId} className="whitespace-pre-wrap break-words text-xs leading-5 text-gray-200">{message}</p>
        </div>
        <div className="flex justify-end border-t border-gray-700/70 px-4 py-3">
          <button type="button" ref={closeRef} onClick={onClose} className={BTN_PRIMARY}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
