import { useMemo, useState, type ReactNode } from 'react';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface Props {
  data: JsonValue;
  search: string;
}

const DEFAULT_EXPAND_DEPTH = 2;

function isContainer(value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null;
}

function entriesOf(value: JsonValue[] | { [key: string]: JsonValue }): [string, JsonValue][] {
  return Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value);
}

/** Paths (joined with \u0000) whose subtree contains a key or primitive value matching the search. */
function collectMatchPaths(data: JsonValue, needle: string): Set<string> {
  const matches = new Set<string>();
  const walk = (value: JsonValue, path: string[], key: string | null): boolean => {
    let found = key !== null && key.toLowerCase().includes(needle);
    if (isContainer(value)) {
      for (const [childKey, child] of entriesOf(value)) {
        if (walk(child, [...path, childKey], Array.isArray(value) ? null : childKey)) found = true;
      }
    } else if (String(value).toLowerCase().includes(needle)) {
      found = true;
    }
    if (found) matches.add(path.join('\u0000'));
    return found;
  };
  walk(data, [], null);
  return matches;
}

function Highlight({ text, needle }: { text: string; needle: string }): ReactNode {
  if (!needle) return text;
  const index = text.toLowerCase().indexOf(needle);
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-amber-400/30 text-inherit">{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
}

function Primitive({ value, needle }: { value: Exclude<JsonValue, object> | null; needle: string }) {
  if (value === null) return <span className="text-gray-500">null</span>;
  if (typeof value === 'string') return <span className="text-emerald-300">"<Highlight text={value} needle={needle} />"</span>;
  if (typeof value === 'number') return <span className="text-sky-300"><Highlight text={String(value)} needle={needle} /></span>;
  return <span className="text-violet-300"><Highlight text={String(value)} needle={needle} /></span>;
}

interface NodeProps {
  name: string | null;
  value: JsonValue;
  path: string[];
  depth: number;
  needle: string;
  matches: Set<string> | null;
  overrides: Map<string, boolean>;
  toggle: (pathKey: string, open: boolean) => void;
}

function JsonNode({ name, value, path, depth, needle, matches, overrides, toggle }: NodeProps) {
  const pathKey = path.join('\u0000');
  if (matches && !matches.has(pathKey)) return null;

  const label = name !== null && (
    <span className="text-rose-200"><Highlight text={name} needle={needle} /><span className="text-gray-500">: </span></span>
  );

  if (!isContainer(value)) {
    return (
      <div className="whitespace-pre-wrap break-all" style={{ paddingLeft: depth * 14 + 14 }}>
        {label}<Primitive value={value} needle={needle} />
      </div>
    );
  }

  const entries = entriesOf(value);
  const isArray = Array.isArray(value);
  const defaultOpen = matches ? true : depth < DEFAULT_EXPAND_DEPTH;
  const open = overrides.get(pathKey) ?? defaultOpen;
  const [openBracket, closeBracket] = isArray ? ['[', ']'] : ['{', '}'];

  return (
    <div>
      <button
        type="button"
        onClick={() => toggle(pathKey, !open)}
        className="flex w-full items-start text-left hover:bg-gray-800/50"
        style={{ paddingLeft: depth * 14 }}
        aria-expanded={open}
      >
        <span className="inline-block w-3.5 flex-shrink-0 text-gray-500">{open ? '▾' : '▸'}</span>
        <span>
          {label}
          <span className="text-gray-400">{openBracket}</span>
          {!open && (
            <span className="text-gray-500"> {entries.length} {isArray ? (entries.length === 1 ? 'item' : 'items') : (entries.length === 1 ? 'key' : 'keys')} {closeBracket}</span>
          )}
        </span>
      </button>
      {open && entries.map(([key, child]) => (
        <JsonNode
          key={key}
          name={isArray ? null : key}
          value={child}
          path={[...path, key]}
          depth={depth + 1}
          needle={needle}
          matches={matches}
          overrides={overrides}
          toggle={toggle}
        />
      ))}
      {open && <div className="text-gray-400" style={{ paddingLeft: depth * 14 + 14 }}>{closeBracket}</div>}
    </div>
  );
}

export function JsonTreeView({ data, search }: Props) {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [expandAll, setExpandAll] = useState<boolean | null>(null);
  const needle = search.trim().toLowerCase();
  const matches = useMemo(() => (needle ? collectMatchPaths(data, needle) : null), [data, needle]);

  const toggle = (pathKey: string, open: boolean) => {
    setOverrides((previous) => new Map(previous).set(pathKey, open));
  };

  // "Expand/collapse all" is applied by seeding overrides for every container path.
  const setAll = (open: boolean) => {
    const next = new Map<string, boolean>();
    const walk = (value: JsonValue, path: string[]) => {
      if (!isContainer(value)) return;
      next.set(path.join('\u0000'), open || path.length === 0);
      for (const [key, child] of entriesOf(value)) walk(child, [...path, key]);
    };
    walk(data, []);
    setOverrides(next);
    setExpandAll(open);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-1 text-[10px] text-gray-500">
        <button type="button" onClick={() => setAll(true)} className={`hover:text-gray-200 ${expandAll === true ? 'text-gray-300' : ''}`}>Expand all</button>
        <button type="button" onClick={() => setAll(false)} className={`hover:text-gray-200 ${expandAll === false ? 'text-gray-300' : ''}`}>Collapse all</button>
        {matches && <span className="ml-auto">{matches.size === 0 ? 'No matches' : 'Showing matching paths'}</span>}
      </div>
      <div className="flex-1 overflow-auto px-2 py-2 font-mono text-[12px] leading-5 text-gray-200">
        {matches && matches.size === 0 ? (
          <div className="px-2 text-gray-500">Nothing matches “{search.trim()}”.</div>
        ) : (
          <JsonNode name={null} value={data} path={[]} depth={0} needle={needle} matches={matches} overrides={overrides} toggle={toggle} />
        )}
      </div>
    </div>
  );
}

export type { JsonValue };
