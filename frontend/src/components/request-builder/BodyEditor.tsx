import type { BodyType } from '../../types';
import { CodeEditor } from '../common/CodeEditor';
import { MultipartFormEditor } from './MultipartFormEditor';
import { createEmptyMultipartBody } from './multipartUtils';

interface Props {
  body: string | null;
  bodyType: BodyType;
  requestId: string;
  onChange: (body: string | null, bodyType: BodyType) => void;
  dynamicSuggestions?: string[];
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

export function BodyEditor({ body, bodyType, requestId, onChange, dynamicSuggestions = [] }: Props) {
  const changeBodyType = (nextType: BodyType) => {
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
        <div className="flex gap-2 mb-3">
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
        </div>
        <p className="text-xs text-gray-400">This request does not have a body.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 mb-3">
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
      </div>

      {bodyType === 'multipart' ? (
        <MultipartFormEditor
          body={body}
          requestId={requestId}
          onChange={(value) => onChange(value, bodyType)}
        />
      ) : (
        <div className="flex-1 min-h-[200px] overflow-hidden border border-gray-700 bg-gray-900">
          <CodeEditor
            language={LANGUAGE_MAP[bodyType] || 'plaintext'}
            value={body ?? ''}
            onChange={(value) => onChange(value, bodyType)}
            dynamicSuggestions={dynamicSuggestions}
          />
        </div>
      )}
    </div>
  );
}
