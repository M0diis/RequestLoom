import { useEffect, useId, useState } from 'react';
import type { RequestFolder } from '../../types';

interface MoveRequestFolderModalProps {
  requestName: string;
  folders: RequestFolder[];
  currentFolderId: string | null;
  onConfirm: (folderId: string | null) => void | Promise<void>;
  onClose: () => void;
}

export function MoveRequestFolderModal({
  requestName,
  folders,
  currentFolderId,
  onConfirm,
  onClose,
}: MoveRequestFolderModalProps) {
  const [folderId, setFolderId] = useState(currentFolderId ?? '');
  const [busy, setBusy] = useState(false);
  const modalId = useId();

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [busy, onClose]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onConfirm(folderId || null);
    } finally {
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
        className="w-full max-w-sm border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${modalId}-title`}
        onSubmit={(event) => { void handleSubmit(event); }}
      >
        <div className="border-b border-gray-800 px-4 py-3">
          <h3 id={`${modalId}-title`} className="text-sm font-semibold text-gray-100">Move request</h3>
          <p className="mt-1 truncate text-xs text-gray-500">{requestName}</p>
        </div>
        <div className="px-4 py-4">
          <label htmlFor={`${modalId}-folder`} className="mb-1.5 block text-xs text-gray-300">Destination</label>
          <select
            id={`${modalId}-folder`}
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            disabled={busy}
            className="w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400 disabled:opacity-60"
          >
            <option value="">Service root (no folder)</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-800 px-4 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="border border-[#ff6c37] bg-[#ff6c37] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#f95e26] disabled:opacity-50">
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      </form>
    </div>
  );
}
