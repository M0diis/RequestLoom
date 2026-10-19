import { useEffect, useId, useMemo, useState } from 'react';
import type { FolderContentsAction, RequestFolder } from '../../types';

interface DeleteRequestFolderModalProps {
  folder: RequestFolder;
  folders: RequestFolder[];
  requestFolderIds: (string | null)[];
  onConfirm: (contents: FolderContentsAction, targetFolderId?: string | null) => void | Promise<void>;
  onClose: () => void;
}

export function DeleteRequestFolderModal({
  folder,
  folders,
  requestFolderIds,
  onConfirm,
  onClose,
}: DeleteRequestFolderModalProps) {
  const modalId = useId();
  const [busy, setBusy] = useState(false);
  const [contents, setContents] = useState<FolderContentsAction>('parent');

  const folderPath = (target: RequestFolder): string => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let current: RequestFolder | undefined = target; current && !seen.has(current.id);
      current = folders.find((item) => item.id === current!.parentFolderId)) {
      seen.add(current.id);
      names.unshift(current.name);
    }
    return names.join(' / ');
  };

  // The folder itself, its subfolders and everything below them.
  const subtreeIds = useMemo(() => {
    const ids = new Set<string>([folder.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of folders) {
        if (item.parentFolderId && ids.has(item.parentFolderId) && !ids.has(item.id)) {
          ids.add(item.id);
          grew = true;
        }
      }
    }
    return ids;
  }, [folder.id, folders]);

  const targets = folders.filter((item) => !subtreeIds.has(item.id));
  const [targetFolderId, setTargetFolderId] = useState(targets[0]?.id ?? '');

  const directRequests = requestFolderIds.filter((id) => id === folder.id).length;
  const directSubfolders = folders.filter((item) => item.parentFolderId === folder.id).length;
  const totalRequests = requestFolderIds.filter((id) => id !== null && subtreeIds.has(id)).length;
  const totalSubfolders = subtreeIds.size - 1;
  const isEmpty = directRequests === 0 && directSubfolders === 0;
  const parent = folders.find((item) => item.id === folder.parentFolderId);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [busy, onClose]);

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const canSubmit = isEmpty || contents !== 'folder' || targetFolderId !== '';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onConfirm(isEmpty ? 'parent' : contents, contents === 'folder' ? targetFolderId : null);
    } finally {
      setBusy(false);
    }
  };

  const options: { value: FolderContentsAction; label: string; hidden?: boolean }[] = [
    { value: 'parent', label: parent ? `Move to parent folder (${folderPath(parent)})` : 'Move to collection root' },
    { value: 'root', label: 'Move to collection root', hidden: !parent },
    { value: 'folder', label: 'Move to another folder', hidden: targets.length === 0 },
    { value: 'delete', label: `Delete everything inside (${plural(totalRequests, 'request')}, ${plural(totalSubfolders, 'subfolder')})` },
  ];

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <form
        className="w-full max-w-md border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${modalId}-title`}
        onSubmit={(event) => { void handleSubmit(event); }}
      >
        <div className="border-b border-gray-800 px-4 py-3">
          <h3 id={`${modalId}-title`} className="text-sm font-semibold text-gray-100">Delete request folder</h3>
          <p className="mt-1 truncate text-xs text-gray-500">{folderPath(folder)}</p>
        </div>

        <div className="px-4 py-4">
          {isEmpty ? (
            <p className="text-xs text-gray-300">Delete {folder.name}? It is empty.</p>
          ) : (
            <fieldset disabled={busy} className="space-y-2">
              <legend className="mb-2 text-xs text-gray-300">
                {folder.name} contains {plural(directRequests, 'request')} and {plural(directSubfolders, 'subfolder')}. What should happen to them?
              </legend>
              {options.filter((option) => !option.hidden).map((option) => (
                <label key={option.value} className={`flex cursor-pointer items-start gap-2 text-xs ${option.value === 'delete' ? 'text-rose-300' : 'text-gray-200'}`}>
                  <input
                    type="radio"
                    name={`${modalId}-contents`}
                    value={option.value}
                    checked={contents === option.value}
                    onChange={() => setContents(option.value)}
                    className="mt-0.5"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
              {contents === 'folder' && (
                <select
                  aria-label="Destination folder"
                  value={targetFolderId}
                  onChange={(event) => setTargetFolderId(event.target.value)}
                  className="ml-5 w-[calc(100%-1.25rem)] border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400"
                >
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>{folderPath(target)}</option>
                  ))}
                </select>
              )}
            </fieldset>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-800 px-4 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="border border-rose-600 bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : contents === 'delete' && !isEmpty ? 'Delete all' : 'Delete folder'}
          </button>
        </div>
      </form>
    </div>
  );
}
