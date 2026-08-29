import type { HistoryEntry } from '../../types';

type DiffKind = 'same' | 'added' | 'removed';

interface DiffLine {
  kind: DiffKind;
  text: string;
  leftNumber?: number;
  rightNumber?: number;
}

interface HeaderValue {
  name: string;
  value: string;
}

interface HeaderDiff {
  name: string;
  kind: DiffKind | 'changed';
  left?: string;
  right?: string;
}

interface Props {
  left: HistoryEntry;
  right: HistoryEntry;
  onClose?: () => void;
}

const MAX_DIFF_LINES = 1500;
const MAX_DIFF_CELLS = 1_000_000;
const MAX_LARGE_BODY_PREVIEW = 50_000;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (!Number.isFinite(bytes) || bytes < 0) return '—';

  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${parseFloat((bytes / Math.pow(1024, unitIndex)).toFixed(1))} ${units[unitIndex]}`;
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'border-emerald-900 bg-emerald-950/30 text-emerald-300';
  if (status >= 300 && status < 400) return 'border-sky-900 bg-sky-950/30 text-sky-300';
  if (status >= 400 && status < 500) return 'border-amber-900 bg-amber-950/30 text-amber-300';
  if (status >= 500) return 'border-rose-900 bg-rose-950/30 text-rose-300';
  return 'border-gray-700 bg-gray-900 text-gray-300';
}

function parseHeaders(raw?: string): Map<string, HeaderValue> {
  if (!raw) return new Map();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();

    const headers = new Map<string, HeaderValue>();
    Object.entries(parsed as Record<string, unknown>).forEach(([name, value]) => {
      const rendered = Array.isArray(value)
        ? value.map((item) => String(item)).join(', ')
        : String(value ?? '');
      headers.set(name.toLowerCase(), { name, value: rendered });
    });
    return headers;
  } catch {
    return new Map();
  }
}

function contentType(headers: Map<string, HeaderValue>): string {
  return headers.get('content-type')?.value.toLowerCase() ?? '';
}

function normalizeBody(entry: HistoryEntry): { value: string; json: boolean } {
  const body = entry.responseBody ?? '';
  const headers = parseHeaders(entry.responseHeadersJson);
  const looksLikeJson = contentType(headers).includes('json') || /^[\s]*(?:\{|\[)/.test(body);

  if (!looksLikeJson) return { value: body, json: false };

  try {
    const parsed: unknown = JSON.parse(body);
    return { value: JSON.stringify(parsed, null, 2) ?? body, json: true };
  } catch {
    return { value: body, json: false };
  }
}

function splitLines(value: string): string[] {
  return value.length === 0 ? [] : value.split(/\r?\n/);
}

function buildLineDiff(left: string[], right: string[]): { lines: DiffLine[]; tooLarge: boolean } {
  if (left.length * right.length > MAX_DIFF_CELLS || Math.max(left.length, right.length) > MAX_DIFF_LINES) {
    return { lines: [], tooLarge: true };
  }

  const table = Array.from(
    { length: left.length + 1 },
    () => new Uint32Array(right.length + 1),
  );

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
        ? table[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      lines.push({
        kind: 'same',
        text: left[leftIndex],
        leftNumber: leftIndex + 1,
        rightNumber: rightIndex + 1,
      });
      leftIndex += 1;
      rightIndex += 1;
    } else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
      lines.push({ kind: 'removed', text: left[leftIndex], leftNumber: leftIndex + 1 });
      leftIndex += 1;
    } else {
      lines.push({ kind: 'added', text: right[rightIndex], rightNumber: rightIndex + 1 });
      rightIndex += 1;
    }
  }

  while (leftIndex < left.length) {
    lines.push({ kind: 'removed', text: left[leftIndex], leftNumber: leftIndex + 1 });
    leftIndex += 1;
  }

  while (rightIndex < right.length) {
    lines.push({ kind: 'added', text: right[rightIndex], rightNumber: rightIndex + 1 });
    rightIndex += 1;
  }

  return { lines, tooLarge: false };
}

function buildHeaderDiff(left: HistoryEntry, right: HistoryEntry): HeaderDiff[] {
  const leftHeaders = parseHeaders(left.responseHeadersJson);
  const rightHeaders = parseHeaders(right.responseHeadersJson);
  const names = new Set([...leftHeaders.keys(), ...rightHeaders.keys()]);

  return [...names]
    .sort()
    .map((name) => {
      const leftHeader = leftHeaders.get(name);
      const rightHeader = rightHeaders.get(name);

      if (!leftHeader) {
        return { name: rightHeader?.name ?? name, kind: 'added' as const, right: rightHeader?.value };
      }
      if (!rightHeader) {
        return { name: leftHeader.name, kind: 'removed' as const, left: leftHeader.value };
      }
      return {
        name: leftHeader.name,
        kind: leftHeader.value === rightHeader.value ? 'same' as const : 'changed' as const,
        left: leftHeader.value,
        right: rightHeader.value,
      };
    })
    .filter((header) => header.kind !== 'same');
}

function previewBody(value: string): string {
  if (value.length <= MAX_LARGE_BODY_PREVIEW) return value;
  return `${value.slice(0, MAX_LARGE_BODY_PREVIEW)}\n… response preview truncated …`;
}

function DiffSnapshot({ label, entry }: { label: string; entry: HistoryEntry }) {
  return (
    <div className="border border-gray-800 bg-gray-950/60 px-3 py-2">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Snapshot {label}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`border px-1.5 py-0.5 font-mono ${statusClass(entry.responseStatus)}`}>
          {entry.responseStatus || 'Error'}
        </span>
        <span className="text-gray-400">{entry.responseTimeMs} ms</span>
        <span className="text-gray-500">{formatBytes(entry.responseSizeBytes)}</span>
      </div>
      <div className="mt-2 truncate font-mono text-[10px] text-gray-500" title={entry.url}>
        {entry.url}
      </div>
    </div>
  );
}

export function ResponseDiffPanel({ left, right, onClose }: Props) {
  const leftBody = normalizeBody(left);
  const rightBody = normalizeBody(right);
  const bodiesEqual = leftBody.value === rightBody.value;
  const bodyDiff = bodiesEqual
    ? { lines: [] as DiffLine[], tooLarge: false }
    : buildLineDiff(splitLines(leftBody.value), splitLines(rightBody.value));
  const headerDiff = buildHeaderDiff(left, right);
  const additions = bodyDiff.lines.filter((line) => line.kind === 'added').length;
  const removals = bodyDiff.lines.filter((line) => line.kind === 'removed').length;
  const statusChanged = left.responseStatus !== right.responseStatus;
  const hasChanges = bodyDiff.tooLarge || additions > 0 || removals > 0 || headerDiff.length > 0 || statusChanged;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 pb-2">
        <div className="text-sm font-semibold text-gray-200">Response diff</div>
        <span className={`border px-1.5 py-0.5 text-[10px] ${hasChanges ? 'border-amber-900 bg-amber-950/30 text-amber-300' : 'border-emerald-900 bg-emerald-950/30 text-emerald-300'}`}>
          {hasChanges ? 'Changed' : 'Identical'}
        </span>
        {!bodyDiff.tooLarge && (additions > 0 || removals > 0) && (
          <span className="text-[11px] text-gray-500">+{additions} / -{removals} body lines</span>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800"
          >
            Close diff
          </button>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <DiffSnapshot label="A" entry={left} />
        <DiffSnapshot label="B" entry={right} />
      </div>

      {statusChanged && (
        <div className="border border-amber-900/70 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          Status changed from <span className="font-mono">{left.responseStatus || 'Error'}</span> to <span className="font-mono">{right.responseStatus || 'Error'}</span>.
        </div>
      )}

      <section className="min-h-0 border border-gray-800 bg-[#101010]">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 bg-[#1a1a1a] px-3 py-2">
          <div className="text-xs font-semibold text-gray-300">Body</div>
          {(leftBody.json || rightBody.json) && (
            <span className="text-[10px] text-gray-500">JSON whitespace normalized</span>
          )}
        </div>

        {bodyDiff.tooLarge ? (
          <>
            <div className="border-b border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
              This response is too large for an inline line diff. Showing side-by-side previews instead.
            </div>
            <div className="grid min-h-0 gap-px bg-gray-800 md:grid-cols-2">
              <pre className="max-h-[560px] overflow-auto bg-rose-950/10 p-3 font-mono text-[11px] leading-5 text-gray-300 whitespace-pre-wrap break-words">
                {previewBody(leftBody.value) || '(empty body)'}
              </pre>
              <pre className="max-h-[560px] overflow-auto bg-emerald-950/10 p-3 font-mono text-[11px] leading-5 text-gray-300 whitespace-pre-wrap break-words">
                {previewBody(rightBody.value) || '(empty body)'}
              </pre>
            </div>
          </>
        ) : bodyDiff.lines.length === 0 ? (
          <div className="p-4 text-xs text-gray-500">
            {leftBody.value.length === 0 && rightBody.value.length === 0 ? 'Both responses have an empty body.' : 'Response bodies are identical.'}
          </div>
        ) : (
          <div className="max-h-[560px] overflow-auto font-mono text-[11px] leading-5">
            {bodyDiff.lines.map((line, index) => {
              const tone = line.kind === 'added'
                ? 'bg-emerald-950/40 text-emerald-100'
                : line.kind === 'removed'
                  ? 'bg-rose-950/40 text-rose-100'
                  : 'text-gray-400';
              const marker = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';

              return (
                <div key={`${line.kind}-${index}`} className={`grid grid-cols-[42px_42px_20px_minmax(0,1fr)] px-2 ${tone}`}>
                  <span className="select-none border-r border-gray-800/70 pr-2 text-right text-gray-600">{line.leftNumber ?? ''}</span>
                  <span className="select-none border-r border-gray-800/70 pr-2 text-right text-gray-600">{line.rightNumber ?? ''}</span>
                  <span className="select-none px-2 text-center font-bold">{marker}</span>
                  <span className="min-w-0 whitespace-pre-wrap break-words">{line.text || ' '}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="border border-gray-800 bg-[#101010]">
        <div className="border-b border-gray-800 bg-[#1a1a1a] px-3 py-2 text-xs font-semibold text-gray-300">
          Changed headers {headerDiff.length > 0 && <span className="text-gray-500">({headerDiff.length})</span>}
        </div>
        {headerDiff.length === 0 ? (
          <div className="p-3 text-xs text-gray-500">No response header changes.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[11px]">
              <thead>
                <tr className="border-b border-gray-800 text-left text-gray-500">
                  <th className="px-3 py-2 font-medium">Header</th>
                  <th className="px-3 py-2 font-medium">A</th>
                  <th className="px-3 py-2 font-medium">B</th>
                </tr>
              </thead>
              <tbody>
                {headerDiff.map((header) => (
                  <tr key={header.name} className="border-b border-gray-900/80 last:border-b-0">
                    <td className="px-3 py-2 font-mono font-semibold text-gray-300">{header.name}</td>
                    <td className={`max-w-[320px] px-3 py-2 font-mono break-all ${header.kind === 'removed' || header.kind === 'changed' ? 'bg-rose-950/30 text-rose-200' : 'text-gray-600'}`}>
                      {header.left ?? '—'}
                    </td>
                    <td className={`max-w-[320px] px-3 py-2 font-mono break-all ${header.kind === 'added' || header.kind === 'changed' ? 'bg-emerald-950/30 text-emerald-200' : 'text-gray-600'}`}>
                      {header.right ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
