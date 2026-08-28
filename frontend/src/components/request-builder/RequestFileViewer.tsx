import { useEffect, useState } from 'react';
import { requestsApi } from '../../services/api';
import { CodeEditor } from '../common/CodeEditor';
import type { StoredRequestFile } from '../../types';

interface Props {
  requestId: string;
}

export function RequestFileViewer({ requestId }: Props) {
  const [file, setFile] = useState<StoredRequestFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);

    requestsApi.getFile(requestId)
      .then((result) => {
        if (!canceled) setFile(result);
      })
      .catch((err: unknown) => {
        if (!canceled) setError(err instanceof Error ? err.message : 'Failed to load stored request');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [requestId]);

  if (loading) return <div className="p-3 text-xs text-gray-500">Loading stored request...</div>;
  if (error) return <div className="border border-rose-900/60 bg-rose-950/20 p-3 text-xs text-rose-300">{error}</div>;
  if (!file) return <div className="p-3 text-xs text-gray-500">Stored request not found.</div>;

  return (
    <div className="flex h-full min-h-0 flex-col border border-gray-800 bg-[#111111]">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 px-3 py-2 text-[11px]">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Stored JSON</span>
        <span className="min-w-0 flex-1 truncate font-mono text-gray-400" title={file.filePath}>
          {file.filePath || 'Logical request record'}
        </span>
        {!file.isJsonStorage && <span className="text-amber-400">JSON storage is not active</span>}
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor value={file.content} language="json" readOnly className="h-full" />
      </div>
    </div>
  );
}
