import { useState } from 'react';
import type { BodyType } from '../../types';
import { CodeEditor } from '../common/CodeEditor';
import { MultipartFormEditor } from './MultipartFormEditor';
import { createEmptyMultipartBody } from './multipartUtils';
import { DocHelpButton } from '../documentation/DocumentationLink';
import { VariablePreview } from '../common/VariablePreview';
import type { ResolvedVariableLookup } from '../common/variablePreviewUtils';
import { formatJson, formatXml } from './formatBody';

interface Props {
  body: string | null;
  bodyType: BodyType;
  requestId: string;
  onChange: (body: string | null, bodyType: BodyType) => void;
  dynamicSuggestions?: string[];
  resolvedVariables?: ResolvedVariableLookup;
  variableResolutionReady?: boolean;
}

const BODY_TYPES: { value: BodyType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'text', label: 'Text' },
  { value: 'form', label: 'Form URL Encoded' },
  { value: 'multipart', label: 'Multipart' },
];

const LANGUAGE_MAP: Record<string, string> = {
  json: 'json',
  xml: 'xml',
  text: 'plaintext',
  form: 'plaintext',
};

export function BodyEditor({ body, bodyType, requestId, onChange, dynamicSuggestions = [], resolvedVariables, variableResolutionReady = true }: Props) {
  const [formatError, setFormatError] = useState<string | null>(null);
  const canFormat = bodyType === 'json' || bodyType === 'xml';

  const formatBody = () => {
    try {
      const formatted = bodyType === 'json' ? formatJson(body ?? '') : formatXml(body ?? '');
      setFormatError(null);
      onChange(formatted, bodyType);
    } catch (error) {
      setFormatError(error instanceof Error ? error.message : 'Unable to format body');
    }
  };

  const changeBodyType = (nextType: BodyType) => {
    setFormatError(null);
    if (nextType === 'none') {
      onChange(null, nextType);
      return;
    }

    const nextBody = nextType === 'multipart' && bodyType !== 'multipart'
      ? createEmptyMultipartBody()
      : body ?? '';
    onChange(nextBody, nextType);
  };

  if (bodyType === 'none') {
    return (
      <div>
        <div className="flex justify-between">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {BODY_TYPES.map((bt) => (
              <button
                key={bt.value}
                onClick={() => changeBodyType(bt.value)}
                className={`border px-3 py-1 text-xs font-medium ${bodyType === bt.value
                    ? 'border-gray-600 bg-gray-700 text-gray-100'
                    : 'border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800'
                  }`}
              >
                {bt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Body type</span>
            <DocHelpButton section="http" title="Open request body documentation" />
          </div>
        </div>
        <p className="text-xs text-gray-400">This request does not have a body.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Body type</span>
          <DocHelpButton section="http" title="Open request body documentation" />
          {BODY_TYPES.map((bt) => (
            <button
              key={bt.value}
              onClick={() => changeBodyType(bt.value)}
            className={`border px-3 py-1 text-xs font-medium ${
              bodyType === bt.value
                ? 'border-gray-600 bg-gray-700 text-gray-100'
                : 'border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800'
            }`}
          >
            {bt.label}
          </button>
        ))}
        {canFormat && (
          <button
            onClick={formatBody}
            disabled={!body?.trim()}
            title={`Format ${bodyType.toUpperCase()}`}
            className="ml-auto border border-gray-700 bg-gray-900 px-3 py-1 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Format {bodyType.toUpperCase()}
          </button>
        )}
      </div>
      {formatError && canFormat && <p className="mb-2 text-xs text-red-400">{formatError}</p>}

      {bodyType === 'multipart' ? (
        <MultipartFormEditor
          body={body}
          requestId={requestId}
          onChange={(value) => onChange(value, bodyType)}
        />
      ) : (
        <div className="flex min-h-[200px] flex-1 flex-col gap-1">
          <div className="min-h-0 flex-1 overflow-hidden border border-gray-700 bg-gray-900">
            <CodeEditor
              language={LANGUAGE_MAP[bodyType] || 'plaintext'}
              value={body ?? ''}
              onChange={(value) => onChange(value, bodyType)}
              dynamicSuggestions={dynamicSuggestions}
            />
          </div>
          <VariablePreview
            value={body ?? ''}
            variables={resolvedVariables}
            ready={variableResolutionReady}
          />
        </div>
      )}
    </div>
  );
}
