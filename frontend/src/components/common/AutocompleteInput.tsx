import { useState, useRef, useEffect, useCallback } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  dynamicSuggestions?: string[];
  placeholder?: string;
  className?: string;
  type?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocusCapture?: () => void;
  dataCellId?: string;
  dataCellField?: string;
}

export function AutocompleteInput({ value, onChange, suggestions, dynamicSuggestions = [], placeholder, className, type = 'text', onKeyDown: onKeyDownProp, onFocusCapture, dataCellId, dataCellField }: Props) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dynamicMatch = value.match(/\{\{\s*\$[a-zA-Z0-9]*$/);
  const filtered = suggestions.filter(
    (s) => s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase()
  );
  const activeSuggestions = dynamicMatch
    ? dynamicSuggestions.filter((suggestion) => suggestion.toLowerCase().includes(dynamicMatch[0].toLowerCase()))
    : filtered;

  const handleSelect = useCallback((suggestion: string) => {
    if (dynamicMatch && dynamicMatch.index !== undefined) {
      onChange(value.slice(0, dynamicMatch.index) + suggestion);
    } else {
      onChange(suggestion);
    }
    setOpen(false);
    setHighlightIndex(-1);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }, [dynamicMatch, onChange, value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || activeSuggestions.length === 0) {
      onKeyDownProp?.(e);
      return;
    }
    let handled = false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, activeSuggestions.length - 1));
      handled = true;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
      handled = true;
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      handleSelect(activeSuggestions[highlightIndex]);
      handled = true;
    } else if (e.key === 'Escape') {
      setOpen(false);
      handled = true;
    }
    if (!handled) onKeyDownProp?.(e);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={wrapperRef} className="relative flex-1">
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlightIndex(-1); }}
        onFocus={() => setOpen(true)}
        onFocusCapture={onFocusCapture}
        data-cell-id={dataCellId}
        data-cell-field={dataCellField}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
      />
      {open && activeSuggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-0.5 max-h-48 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl">
          {activeSuggestions.map((s, i) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
              className={`w-full text-left px-2.5 py-1.5 text-xs font-mono truncate transition-colors ${
                i === highlightIndex
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
