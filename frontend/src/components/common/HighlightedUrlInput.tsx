import { useEffect, useMemo, useRef, useState } from 'react';

export interface UrlVariableState {
  resolved: boolean;
  source?: string;
  value?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  variableStates?: Record<string, UrlVariableState>;
  dynamicSuggestions?: string[];
}

type UrlToken = {
  text: string;
  variableName?: string;
};

const URL_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}|\{\s*([a-zA-Z0-9_.-]+)\s*\}/g;

function tokenizeUrl(value: string): UrlToken[] {
  if (!value) return [];

  const tokens: UrlToken[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(URL_VARIABLE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ text: value.slice(lastIndex, index) });
    }

    const variableName = (match[1] ?? match[2] ?? '').trim();
    tokens.push({
      text: match[0],
      variableName: variableName || undefined,
    });

    lastIndex = index + match[0].length;
  }

  if (lastIndex < value.length) {
    tokens.push({ text: value.slice(lastIndex) });
  }

  return tokens;
}

export function HighlightedUrlInput({
  value,
  onChange,
  onKeyDown,
  placeholder,
  variableStates,
  dynamicSuggestions = [],
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const tokens = useMemo(() => tokenizeUrl(value), [value]);
  const dynamicMatch = value.match(/\{\{\s*\$[a-zA-Z0-9]*$/);
  const filteredDynamicSuggestions = dynamicMatch
    ? dynamicSuggestions.filter((suggestion) => suggestion.toLowerCase().includes(dynamicMatch[0].toLowerCase()))
    : [];

  const syncOverlayScroll = () => {
    if (!inputRef.current || !overlayRef.current) return;
    overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
  };

  useEffect(() => {
    syncOverlayScroll();
  }, [value]);

  const selectDynamicSuggestion = (suggestion: string) => {
    if (!dynamicMatch || dynamicMatch.index === undefined) return;
    onChange(value.slice(0, dynamicMatch.index) + suggestion);
    setOpen(false);
    setHighlightIndex(-1);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const length = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(length, length);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && filteredDynamicSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightIndex((index) => Math.min(index + 1, filteredDynamicSuggestions.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Enter' && highlightIndex >= 0) {
        event.preventDefault();
        selectDynamicSuggestion(filteredDynamicSuggestions[highlightIndex]);
        return;
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    onKeyDown?.(event);
  };

  return (
    <div className="relative flex-1 border border-gray-700 bg-gray-900 focus-within:border-gray-500">
      <div
        ref={overlayRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 overflow-hidden px-3 py-1.5 text-sm font-mono leading-5 whitespace-pre"
      >
        {value.length > 0 && (
          tokens.map((token, index) => {
            if (!token.variableName) {
              return (
                <span key={`${token.text}-${index}`} className="text-transparent">
                  {token.text}
                </span>
              );
            }

            const state = variableStates?.[token.variableName.toLowerCase()];
            const colorClass = state == null
              ? 'bg-sky-900/45 text-transparent'
              : state.resolved
                ? 'bg-emerald-900/45 text-transparent'
                : 'bg-rose-900/45 text-transparent';

            return (
              <span key={`${token.text}-${index}`} className={colorClass}>
                {token.text}
              </span>
            );
          })
        )}
      </div>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setHighlightIndex(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onScroll={syncOverlayScroll}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="relative z-10 block w-full border-0 bg-transparent px-3 py-1.5 text-sm font-mono text-gray-100 outline-none placeholder:text-gray-500 selection:bg-gray-700 selection:text-gray-100"
      />
      {open && filteredDynamicSuggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-0.5 max-h-48 overflow-y-auto rounded-md border border-gray-700 bg-gray-900 shadow-xl">
          {filteredDynamicSuggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              onMouseDown={(event) => { event.preventDefault(); selectDynamicSuggestion(suggestion); }}
              className={`block w-full truncate px-3 py-1.5 text-left text-xs font-mono ${index === highlightIndex ? 'bg-orange-500 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
