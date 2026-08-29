import { useEffect, useState } from 'react';
import { requestsApi } from '../../services/api';
import type { MultipartFormField } from '../../types';

interface Props {
  body: string | null;
  requestId: string;
  onChange: (body: string) => void;
}

type LocalField = MultipartFormField & {
  id: string;
  size?: number;
};

const INPUT_CLASS = 'w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500';
const SELECT_CLASS = INPUT_CLASS.replace('w-full ', '') + ' w-28 shrink-0';

function createField(): LocalField {
  return {
    id: crypto.randomUUID(),
    name: '',
    kind: 'text',
    value: '',
    filePath: '',
    fileName: '',
    contentType: 'application/octet-stream',
    enabled: true,
  };
}

function parseBody(body: string | null): LocalField[] {
  if (!body?.trim()) return [createField()];

  try {
    const parsed = JSON.parse(body) as { fields?: Partial<MultipartFormField>[] } | Partial<MultipartFormField>[];
    const values = Array.isArray(parsed) ? parsed : parsed.fields;
    if (!Array.isArray(values)) return [createField()];

    const fields = values.map((field) => ({
      id: crypto.randomUUID(),
      name: field.name ?? '',
      kind: field.kind === 'file' ? 'file' as const : 'text' as const,
      value: field.value ?? '',
      filePath: field.filePath ?? '',
      fileName: field.fileName ?? '',
      contentType: field.contentType ?? 'application/octet-stream',
      enabled: field.enabled !== false,
    }));
    return fields.length > 0 ? fields : [createField()];
  } catch {
    return [createField()];
  }
}

function serialize(fields: LocalField[]): string {
  return JSON.stringify({
    fields: fields.map(({ id: _id, size: _size, ...field }) => field),
  });
}

export function MultipartFormEditor({ body, requestId, onChange }: Props) {
  const [fields, setFields] = useState<LocalField[]>(() => parseBody(body));
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setFields(parseBody(body));
    setMessage('');
  }, [body]);

  const commit = (nextFields: LocalField[]) => {
    setFields(nextFields);
    onChange(serialize(nextFields));
  };

  const updateField = (id: string, patch: Partial<LocalField>) => {
    commit(fields.map((field) => field.id === id ? { ...field, ...patch } : field));
  };

  const removeField = (id: string) => {
    const nextFields = fields.filter((field) => field.id !== id);
    commit(nextFields.length > 0 ? nextFields : [createField()]);
  };

  const handleFileSelected = async (fieldId: string, file: File | undefined) => {
    if (!file) return;
    setUploadingId(fieldId);
    setMessage('Uploading file…');

    try {
      const uploaded = await requestsApi.upload(requestId, file);
      updateField(fieldId, {
        kind: 'file',
        filePath: uploaded.filePath,
        fileName: uploaded.fileName,
        contentType: uploaded.contentType,
        size: uploaded.size,
      });
      setMessage(uploaded.fileName + ' uploaded.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'File upload failed.');
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-300">Multipart form-data</p>
          <p className="text-[11px] text-gray-500">Text fields support {'{{variable}}'} interpolation. Files are stored in the RequestLoom upload directory.</p>
        </div>
        <button
          type="button"
          onClick={() => commit([...fields, createField()])}
          className="border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
        >
          Add field
        </button>
      </div>

      <div className="space-y-2">
        {fields.map((field) => (
          <div key={field.id} className="border border-gray-800 bg-[#171717] p-2">
            <div className="flex flex-nowrap items-center gap-2">
              <input
                type="checkbox"
                checked={field.enabled}
                onChange={(event) => updateField(field.id, { enabled: event.target.checked })}
                className="h-3.5 w-3.5 shrink-0 accent-[#ff6c37]"
                aria-label="Enable multipart field"
              />
              <input
                className={INPUT_CLASS + ' min-w-0 flex-1'}
                value={field.name}
                onChange={(event) => updateField(field.id, { name: event.target.value })}
                placeholder="Field name"
                aria-label="Multipart field name"
              />
              <select
                className={SELECT_CLASS}
                value={field.kind}
                onChange={(event) => updateField(field.id, { kind: event.target.value as LocalField['kind'] })}
                aria-label="Multipart field type"
              >
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
              <button
                type="button"
                onClick={() => removeField(field.id)}
                className="shrink-0 px-1.5 text-xs text-gray-500 hover:text-rose-400"
                aria-label="Remove multipart field"
              >
                ×
              </button>
            </div>

            {field.kind === 'file' ? (
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <input
                  type="file"
                  disabled={uploadingId === field.id}
                  onChange={(event) => {
                    void handleFileSelected(field.id, event.target.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                  className="w-full text-xs text-gray-400 file:mr-2 file:border-0 file:bg-gray-800 file:px-2 file:py-1.5 file:text-xs file:text-gray-300 hover:file:bg-gray-700"
                />
                <input
                  className={INPUT_CLASS}
                  value={field.fileName}
                  onChange={(event) => updateField(field.id, { fileName: event.target.value })}
                  placeholder="Uploaded filename"
                  disabled={!field.filePath}
                />
                <input
                  className={INPUT_CLASS}
                  value={field.contentType}
                  onChange={(event) => updateField(field.id, { contentType: event.target.value })}
                  placeholder="application/octet-stream"
                  disabled={!field.filePath}
                />
                <span className="self-center text-[11px] text-gray-500">
                  {uploadingId === field.id
                    ? 'Uploading…'
                    : field.filePath
                      ? (field.size ? Math.round(field.size / 1024) + ' KB · ' : '') + field.fileName
                      : 'Choose a file to upload'}
                </span>
              </div>
            ) : (
              <input
                className={INPUT_CLASS + ' mt-2'}
                value={field.value}
                onChange={(event) => updateField(field.id, { value: event.target.value })}
                placeholder="Field value"
                aria-label="Multipart field value"
              />
            )}
          </div>
        ))}
      </div>

      {message && <p className="text-[11px] text-gray-500">{message}</p>}
      <p className="text-[11px] text-gray-500">
        The multipart boundary is generated automatically. Do not add a manual Content-Type boundary header.
      </p>
    </div>
  );
}
