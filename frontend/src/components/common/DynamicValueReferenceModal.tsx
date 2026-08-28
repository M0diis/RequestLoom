import { useMemo, useState } from 'react';
import type { DynamicValueDefinition } from '../../types';

interface Props {
  definitions: DynamicValueDefinition[];
  onClose: () => void;
}

export function DynamicValueReferenceModal({ definitions, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return definitions;
    return definitions.filter((definition) => [
      definition.name,
      definition.signature,
      definition.category,
      definition.description,
      ...(definition.aliases ?? []),
    ].some((value) => value.toLowerCase().includes(needle)));
  }, [definitions, query]);

  const copy = (value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(value);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
        <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-100">Dynamic request values</h3>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search names, aliases, or categories"
            className="min-w-0 flex-1 border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-gray-500"
            autoFocus
          />
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300" aria-label="Close">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {filtered.map((definition) => (
              <div key={definition.name} className="border border-gray-800 bg-[#1a1a1a] p-3">
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all text-xs text-red-300">{definition.signature}</code>
                  <button
                    onClick={() => copy(definition.signature)}
                    className="flex-shrink-0 border border-gray-700 px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-800"
                  >
                    {copied === definition.signature ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-wide text-gray-500">{definition.category} · {definition.outputType}</div>
                <p className="mt-1 text-[11px] text-gray-300">{definition.description}</p>
                <p className="mt-1 text-[10px] text-gray-500">Example: <code className="text-red-200">{definition.example}</code></p>
                {(definition.aliases ?? []).length > 0 && (
                  <p className="mt-1 break-words text-[10px] text-gray-500">Aliases: {definition.aliases.join(', ')}</p>
                )}
              </div>
            ))}
          </div>
          {filtered.length === 0 && <p className="py-8 text-center text-xs text-gray-500">No dynamic values match.</p>}
        </div>
      </div>
    </div>
  );
}
