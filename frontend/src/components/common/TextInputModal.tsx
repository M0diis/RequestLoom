import { useEffect, useId, useRef, useState } from 'react';

interface TextInputModalProps {
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void | Promise<void>;
  onClose: () => void;
}

const BTN_PRIMARY = 'border border-cyan-400 bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-gray-950 hover:bg-cyan-400 disabled:cursor-default disabled:opacity-50';
const BTN_SECONDARY = 'border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:cursor-default disabled:opacity-50';

export function TextInputModal({
  title,
  label,
  placeholder,
  initialValue = '',
  confirmLabel = 'Create',
  onConfirm,
  onClose,
}: TextInputModalProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const labelId = `${modalId}-label`;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [busy, onClose]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      setError(`${label} is required.`);
      inputRef.current?.focus();
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await onConfirm(trimmedValue);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <form
        className="w-full max-w-sm rounded-md border border-gray-700 bg-[#24222d] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => { void handleSubmit(event); }}
      >
        <div className="border-b border-gray-700/70 px-4 py-3">
          <h3 id={titleId} className="text-sm font-semibold text-gray-100">{title}</h3>
        </div>

        <div className="px-4 py-4">
          <label id={labelId} htmlFor={`${modalId}-input`} className="mb-1.5 block text-xs text-gray-300">
            {label}
          </label>
          <input
            ref={inputRef}
            id={`${modalId}-input`}
            type="text"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            placeholder={placeholder}
            aria-labelledby={labelId}
            aria-invalid={error !== null}
            disabled={busy}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 disabled:opacity-60"
          />
          {error && <p className="mt-1.5 text-xs text-rose-300">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-700/70 px-4 py-3">
          <button type="button" onClick={onClose} className={BTN_SECONDARY} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={BTN_PRIMARY} disabled={busy}>
            {busy ? 'Creating...' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
