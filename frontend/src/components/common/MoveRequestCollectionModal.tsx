import { useEffect, useId, useState } from 'react';

interface CollectionOption {
  id: string;
  name: string;
}

interface MoveRequestCollectionModalProps {
  requestName: string;
  collections: CollectionOption[];
  currentCollectionId: string | null;
  onConfirm: (collectionId: string) => void | Promise<void>;
  onClose: () => void;
}

export function MoveRequestCollectionModal({
  requestName,
  collections,
  currentCollectionId,
  onConfirm,
  onClose,
}: MoveRequestCollectionModalProps) {
  const modalId = useId();
  const [collectionId, setCollectionId] = useState(currentCollectionId ?? collections[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [busy, onClose]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!collectionId) return;
    setBusy(true);
    try {
      await onConfirm(collectionId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="titlebar-no-drag fixed inset-0 z-[160] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${modalId}-title`}
        className="w-full max-w-sm border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        onSubmit={(event) => { void handleSubmit(event); }}
      >
        <div className="border-b border-gray-800 px-4 py-3">
          <h2 id={`${modalId}-title`} className="text-sm font-semibold text-gray-100">Move request</h2>
          <p className="mt-1 truncate text-xs text-gray-500">{requestName}</p>
        </div>
        <div className="px-4 py-4">
          <label htmlFor={`${modalId}-collection`} className="mb-1.5 block text-xs text-gray-300">Collection</label>
          <select
            id={`${modalId}-collection`}
            value={collectionId}
            onChange={(event) => setCollectionId(event.target.value)}
            disabled={busy}
            className="w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-[#ff6c37] disabled:opacity-60"
          >
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>{collection.name}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-800 bg-[#1a1a1a] px-4 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy || !collectionId} className="border border-[#ff6c37] bg-[#ff6c37] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#f95e26] disabled:opacity-50">
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      </form>
    </div>
  );
}
