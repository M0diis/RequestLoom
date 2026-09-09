import { useId, useState } from 'react';
import type { HttpMethod } from '../../types';
import { CustomDropdown } from './CustomDropdown';

interface NewRequestModalProps {
  onClose: () => void;
  collections: Array<{ id: string; name: string }>;
  onCreate: (draft: {
    name: string;
    method: HttpMethod;
    url: string;
    collectionId: string | null;
    newCollectionName: string;
  }) => Promise<void>;
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-300',
  PATCH: 'text-violet-300',
  DELETE: 'text-rose-400',
  OPTIONS: 'text-gray-400',
  HEAD: 'text-gray-400',
};
const METHOD_OPTIONS = METHODS.map((item) => ({ value: item, label: item, className: METHOD_COLORS[item] }));
const INPUT = 'w-full border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-[#ff6c37]';
const TEXT_INPUT = `${INPUT} text-gray-100`;
const BUTTON = 'border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-50';

export function NewRequestModal({ onClose, collections, onCreate }: NewRequestModalProps) {
  const modalId = useId();
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [collectionChoice, setCollectionChoice] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Request name is required.');
      return;
    }
    if (collectionChoice === '__new__' && !newCollectionName.trim()) {
      setError('New collection name is required.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        method,
        url: url.trim(),
        collectionId: collectionChoice === '' || collectionChoice === '__new__' ? null : collectionChoice,
        newCollectionName: collectionChoice === '__new__' ? newCollectionName.trim() : '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create request.');
      setBusy(false);
    }
  };

  return (
    <div
      className="titlebar-no-drag fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${modalId}-title`}
        className="w-full max-w-md border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        onSubmit={(event) => { void handleSubmit(event); }}
      >
        <div className="border-b border-gray-800 px-4 py-3">
          <h2 id={`${modalId}-title`} className="text-sm font-semibold text-gray-100">New request</h2>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3">
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Method</span>
              <CustomDropdown
                value={method}
                options={METHOD_OPTIONS}
                onChange={(value) => setMethod(value as HttpMethod)}
                title="Method"
                className="w-full"
                buttonClassName={`py-2 font-mono font-semibold ${METHOD_COLORS[method]}`}
                menuClassName="z-[180] w-full"
                disabled={busy}
              />
            </div>
            <div>
              <label htmlFor={`${modalId}-name`} className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Name</label>
              <input
                id={`${modalId}-name`}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={TEXT_INPUT}
                placeholder="List users"
                disabled={busy}
              />
            </div>
          </div>

          <div>
            <label htmlFor={`${modalId}-url`} className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Route / URL</label>
            <input
              id={`${modalId}-url`}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
                className={`${TEXT_INPUT} font-mono text-xs`}
              placeholder="{{baseUrl}}/users"
              disabled={busy}
            />
          </div>

          <div>
            <label htmlFor={`${modalId}-collection`} className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Collection</label>
            <select
              id={`${modalId}-collection`}
              value={collectionChoice}
              onChange={(event) => setCollectionChoice(event.target.value)}
              className={TEXT_INPUT}
              disabled={busy}
            >
              <option value="">No collection (top level)</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>{collection.name}</option>
              ))}
              <option value="__new__">+ New collection…</option>
            </select>
            {collectionChoice === '__new__' && (
              <input
                autoFocus
                value={newCollectionName}
                onChange={(event) => setNewCollectionName(event.target.value)}
                className={`${TEXT_INPUT} mt-2`}
                placeholder="Collection name"
                disabled={busy}
              />
            )}
          </div>

          {error && <p className="border border-rose-900/60 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-800 bg-[#1a1a1a] px-4 py-3">
          <button type="button" onClick={onClose} disabled={busy} className={BUTTON}>Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="border border-[#ff6c37] bg-[#ff6c37] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#f95e26] disabled:opacity-50">
            {busy ? 'Creating…' : 'Create request'}
          </button>
        </div>
      </form>
    </div>
  );
}
