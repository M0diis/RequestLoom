import { useEffect, useRef } from 'react';
import type { RequestVariable } from '../../types';
import { AutocompleteInput } from './AutocompleteInput';
import { DocHelpButton } from '../documentation/DocumentationLink';

interface Props {
  entries: RequestVariable[];
  onChange: (entries: RequestVariable[]) => void;
  dynamicSuggestions?: string[];
}

const GRID_COLS = 'grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)] gap-2 items-center';

const iconButtonClass = 'flex h-[26px] w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-700 hover:text-gray-200 disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-gray-500';
const deleteButtonClass = 'flex h-[26px] w-7 items-center justify-center rounded text-gray-500 hover:bg-rose-500/20 hover:text-rose-300';

export function RequestVariableEditor({ entries, onChange, dynamicSuggestions = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nextPlaceholderId = useRef(1);
  const lastFocus = useRef<{ id: string; field: string } | null>(null);
  const previousActive = useRef<Element | null>(null);

  useEffect(() => {
    const prev = previousActive.current;
    previousActive.current = document.activeElement;
    if (prev instanceof HTMLInputElement && !prev.isConnected && lastFocus.current) {
      const { id, field } = lastFocus.current;
      const target = containerRef.current?.querySelector<HTMLInputElement>(
        `[data-cell-id="${id}"][data-cell-field="${field}"]`,
      );
      if (target && target !== document.activeElement) {
        target.focus();
        const len = target.value.length;
        try {
          target.setSelectionRange(len, len);
        } catch {
          // ignore
        }
      }
    }
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onKeyDown = () => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement) {
        previousActive.current = active;
      }
    };
    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, []);

  const isEmptyRow = (e: RequestVariable) => !e.key && !e.value;

  const showPlaceholder = entries.length === 0 || !isEmptyRow(entries[entries.length - 1]);
  const placeholderId = `new-${nextPlaceholderId.current}`;

  const handleUpdate = (index: number, field: 'key' | 'value' | 'enabled', value: string | boolean) => {
    if (index < entries.length) {
      onChange(entries.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)));
      return;
    }
    nextPlaceholderId.current += 1;
    onChange([
      ...entries,
      { id: placeholderId, requestId: '', key: '', value: '', enabled: true, [field]: value },
    ]);
  };

  const handleRemove = (index: number) => {
    if (index < entries.length) {
      onChange(entries.filter((_, i) => i !== index));
    }
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    if (index < 0 || index >= entries.length) return;
    const target = index + direction;
    if (target < 0 || target >= entries.length) return;
    const updated = [...entries];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    onChange(updated);
  };

  const inputClass = 'min-w-0 w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500';
  const valueInputClass = `${inputClass} pr-[96px]`;

  return (
    <div>
      <div className="border border-gray-700 bg-gray-900/40">
        <div className={`${GRID_COLS} border-b border-gray-800 bg-gray-900/70 px-2 py-1.5`}>
          <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-gray-500"></span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Name</span>
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Value <DocHelpButton section="automation" title="Open variables documentation" /></span>
        </div>
        <div ref={containerRef} className="divide-y divide-gray-800">
          {entries.map((entry, i) => (
            <div key={entry.id} className={`${GRID_COLS} px-2 py-1.5`}>
              <input
                type="checkbox"
                checked={entry.enabled}
                onChange={(e) => handleUpdate(i, 'enabled', e.target.checked)}
                title={entry.enabled ? 'Disable variable' : 'Enable variable'}
                className="h-3.5 w-3.5 justify-self-center border-gray-600 accent-emerald-500"
              />
              <input
                type="text"
                value={entry.key}
                onChange={(e) => handleUpdate(i, 'key', e.target.value)}
                onFocusCapture={() => { lastFocus.current = { id: entry.id, field: 'key' }; }}
                data-cell-id={entry.id}
                data-cell-field="key"
                placeholder="Variable name"
                className={inputClass}
              />
              <div className="relative min-w-0">
                {dynamicSuggestions.length > 0 ? (
                  <AutocompleteInput
                    value={entry.value}
                    onChange={(value) => handleUpdate(i, 'value', value)}
                    onFocusCapture={() => { lastFocus.current = { id: entry.id, field: 'value' }; }}
                    dataCellId={entry.id}
                    dataCellField="value"
                    suggestions={[]}
                    dynamicSuggestions={dynamicSuggestions}
                    placeholder="Value"
                    className={valueInputClass}
                  />
                ) : (
                  <input
                    type="text"
                    value={entry.value}
                    onChange={(e) => handleUpdate(i, 'value', e.target.value)}
                    onFocusCapture={() => { lastFocus.current = { id: entry.id, field: 'value' }; }}
                    data-cell-id={entry.id}
                    data-cell-field="value"
                    placeholder="Value"
                    className={valueInputClass}
                  />
                )}
                <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-1">
                  <button
                    onClick={() => handleMove(i, -1)}
                    disabled={i === 0}
                    title="Move up"
                    className={iconButtonClass}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleMove(i, 1)}
                    disabled={i === entries.length - 1}
                    title="Move down"
                    className={iconButtonClass}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleRemove(i)}
                    title="Remove variable"
                    className={deleteButtonClass}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
          {showPlaceholder && (
            <div key={placeholderId} className={`${GRID_COLS} px-2 py-1.5`}>
              <span className="justify-self-center h-3.5 w-3.5" />
              <input
                type="text"
                value=""
                onChange={(e) => handleUpdate(entries.length, 'key', e.target.value)}
                onFocusCapture={() => { lastFocus.current = { id: placeholderId, field: 'key' }; }}
                data-cell-id={placeholderId}
                data-cell-field="key"
                placeholder="Variable name"
                className={inputClass}
              />
              {dynamicSuggestions.length > 0 ? (
                <AutocompleteInput
                  value=""
                  onChange={(value) => handleUpdate(entries.length, 'value', value)}
                  onFocusCapture={() => { lastFocus.current = { id: placeholderId, field: 'value' }; }}
                  dataCellId={placeholderId}
                  dataCellField="value"
                  suggestions={[]}
                  dynamicSuggestions={dynamicSuggestions}
                  placeholder="Value"
                  className={valueInputClass}
                />
              ) : (
                <input
                  type="text"
                  value=""
                  onChange={(e) => handleUpdate(entries.length, 'value', e.target.value)}
                  onFocusCapture={() => { lastFocus.current = { id: placeholderId, field: 'value' }; }}
                  data-cell-id={placeholderId}
                  data-cell-field="value"
                  placeholder="Value"
                  className={valueInputClass}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-gray-500">
        Request variables have highest priority when resolving {'{{variable}}'} placeholders. Disabled variables are ignored.
      </p>
    </div>
  );
}
