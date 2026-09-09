import { useEffect, useMemo, useState } from 'react';
import { resolveValueForPreview, type ResolvedVariableLookup } from './variablePreviewUtils';

interface Props {
  value: string;
  variables?: ResolvedVariableLookup;
  ready?: boolean;
  sensitive?: boolean;
  compact?: boolean;
  className?: string;
}

export function VariablePreview({
  value,
  variables = new Map(),
  ready = true,
  sensitive = false,
  compact = false,
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const preview = useMemo(
    () => resolveValueForPreview(value, variables, sensitive),
    [sensitive, value, variables],
  );

  useEffect(() => {
    setRevealed(false);
  }, [sensitive, value, variables]);

  if (!preview.hasVariables && (!sensitive || !value)) return null;

  const toggleOpen = () => {
    setOpen((current) => !current);
    if (open) setRevealed(false);
  };

  return (
    <div className={`${compact ? 'relative' : 'mt-1'} ${className}`}>
      <button
        type="button"
        onClick={toggleOpen}
        className={compact
          ? `flex h-[26px] w-7 items-center justify-center rounded ${preview.hasSecrets ? 'text-amber-300' : 'text-sky-400'} hover:bg-gray-700 hover:text-gray-100`
          : 'text-[10px] text-sky-400 hover:text-sky-300'}
        aria-expanded={open}
        aria-label="Preview resolved value"
        title="Preview resolved value"
      >
        {compact ? (
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12s3.5-6 9.75-6 9.75 6 9.75 6-3.5 6-9.75 6-9.75-6-9.75-6z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        ) : open ? 'Hide preview' : 'Preview resolved value'}
      </button>

      {open && (
        <div className={`${compact ? 'absolute right-0 top-full z-50 mt-1 w-72 shadow-xl' : 'mt-1'} border border-gray-800 bg-gray-950/95 px-2 py-1.5 text-[11px]`}>
          {!ready ? (
            <span className="text-gray-500">Loading variables…</span>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all whitespace-pre-wrap text-gray-300">
                  {revealed ? preview.resolvedValue || '(empty)' : preview.displayValue || '(empty)'}
                </code>
                {preview.hasSecrets && (
                  <button
                    type="button"
                    onClick={() => setRevealed((current) => !current)}
                    className="flex-shrink-0 text-amber-300 hover:text-amber-200"
                  >
                    {revealed ? 'Hide secrets' : 'Reveal secrets'}
                  </button>
                )}
              </div>
              {preview.sources.length > 0 && (
                <div className="mt-1 text-gray-600">Source: {preview.sources.join(', ')}</div>
              )}
              {preview.missingVariables.length > 0 && (
                <div className="mt-1 text-rose-400">
                  Missing: {preview.missingVariables.map((name) => `{{${name}}}`).join(', ')}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
