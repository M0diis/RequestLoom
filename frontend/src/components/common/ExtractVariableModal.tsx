import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiRequest } from '../../types';
import { useRequestStore } from '../../stores/requestStore';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { serviceVariablesApi, workspaceVariablesApi } from '../../services/api';
import { findUrlOccurrences, replaceUrlOccurrences } from '../../lib/variableExtraction';
import { toast } from '../../stores/toastStore';

const INPUT = 'w-full border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-[#ff6c37]';

export function ExtractVariableModal({ request, selection, onClose, onExtracted }: {
  request: ApiRequest;
  selection: { value: string; start: number; end: number };
  onClose: () => void;
  onExtracted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { services, topLevelRequests, draftsById } = useRequestStore();
  const { environments } = useEnvironmentStore();
  const [name, setName] = useState('baseUrl');
  const [destination, setDestination] = useState(request.serviceId ?? 'global');
  const [environmentId, setEnvironmentId] = useState('');
  const [scope, setScope] = useState('current');
  const [selected, setSelected] = useState(new Set([`${request.id}:${selection.start}`]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const placeholder = `{{${name.trim()}}}`;
  const occurrences = useMemo(() => findUrlOccurrences(services,
    [...topLevelRequests, ...Object.values(draftsById).filter(item => item.ephemeral)], selection.value),
  [services, topLevelRequests, draftsById, selection.value]);
  const visible = occurrences.filter(item =>
    (destination === 'global' || (destination === 'request' ? item.requestId === request.id : item.serviceId === destination)) &&
    (scope === 'all' || (scope === 'current' ? item.requestId === request.id : item.serviceId === scope)));
  const chosen = visible.filter(item => selected.has(item.id));

  useEffect(() => { dialog.current?.showModal(); }, []);
  const submit = async () => {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name.trim())) { setError('Use letters, numbers, dots, underscores or hyphens for the variable name.'); return; }
    setBusy(true); setError('');
    try {
      const state = useRequestStore.getState();
      if (state.workspaceId !== request.workspaceId) throw new Error('The workspace changed. Close this dialog and try again.');
      // Validate every URL before storing the variable or changing any requests.
      const patches = [...new Set(chosen.map(item => item.requestId))].map(id => {
        const current = state.draftsById[id] ?? state.topLevelRequests.find(item => item.id === id)
          ?? state.services.flatMap(service => service.requests).find(item => item.id === id);
        if (!current) throw new Error('A matching request was removed. Review the occurrences.');
        return { id, url: replaceUrlOccurrences(current.url, selection.value, placeholder, chosen.filter(item => item.requestId === id)) };
      });
      const key = name.trim();
      const variable = { key, value: selection.value, environmentId: environmentId || null, enabled: true, isSecret: false };
      if (destination === 'request') {
        const current = state.draftsById[request.id] ?? state.activeRequest;
        if (!current || current.id !== request.id) throw new Error('The active request changed.');
        if (current.variables.some(item => item.key.toLowerCase() === key.toLowerCase())) throw new Error('That variable already exists. Choose another name.');
        await state.updateRequest(request.id, { variables: [...current.variables,
          { id: crypto.randomUUID(), requestId: request.id, key, value: selection.value, enabled: true }] });
      } else {
        const existing = destination === 'global' ? await workspaceVariablesApi.getAll(request.workspaceId)
          : await serviceVariablesApi.getAll(destination);
        if (existing.some(item => item.key.toLowerCase() === key.toLowerCase() && (item.environmentId || '') === environmentId)) {
          throw new Error('That variable already exists in this scope. Choose another name or environment.');
        }
        if (destination === 'global') await workspaceVariablesApi.upsert(request.workspaceId, variable);
        else await serviceVariablesApi.upsert(destination, variable);
      }
      for (const patch of patches) {
        await state.updateRequest(patch.id, { url: patch.url });
        await state.saveRequest(patch.id);
        if (!useRequestStore.getState().draftsById[patch.id]?.ephemeral && useRequestStore.getState().isRequestDirty(patch.id)) {
          throw new Error(useRequestStore.getState().error ?? 'Could not save a changed URL. The variable was created; unsaved changes remain in the request.');
        }
      }
      if (destination === 'request' && !patches.some(item => item.id === request.id)) {
        await state.saveRequest(request.id);
        const current = useRequestStore.getState();
        if (!request.ephemeral && current.isRequestDirty(request.id)) throw new Error(current.error ?? 'Could not save the request variable. The draft is retained.');
      }
      onExtracted();
      toast(`Created ${placeholder}; replaced ${chosen.length} URL occurrence${chosen.length === 1 ? '' : 's'}.`);
      onClose();
    } catch (err) { onExtracted(); setError(err instanceof Error ? err.message : 'Extraction failed.'); }
    finally { setBusy(false); }
  };

  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
    aria-labelledby="extract-variable-title" className="titlebar-no-drag m-auto w-[min(760px,calc(100vw-32px))] max-h-[90vh] overflow-y-auto border border-gray-700 bg-[#141414] p-0 text-gray-200 shadow-xl backdrop:bg-black/60">
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h2 id="extract-variable-title" className="border-b border-gray-800 px-4 py-3 text-sm font-semibold">Extract URL selection to variable</h2>
      <div className="space-y-4 p-4">
        <p className="break-all bg-gray-900 p-3 font-mono text-xs">{selection.value}</p>
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">Variable name<input autoFocus value={name} onChange={event => setName(event.target.value)} className={`${INPUT} mt-1`} /></label>
          <label className="text-xs">Store in<select value={destination} onChange={event => { setDestination(event.target.value); setScope('current'); }} className={`${INPUT} mt-1`}>
            <option value="global">Global (workspace)</option><option value="request">This request</option>
            {services.map(service => <option key={service.id} value={service.id}>Service: {service.name}</option>)}
          </select></label>
          {destination !== 'request' && <label className="text-xs">Environment<select value={environmentId} onChange={event => setEnvironmentId(event.target.value)} className={`${INPUT} mt-1`}>
            <option value="">All environments</option>{environments.map(env => <option key={env.id} value={env.id}>{env.name}</option>)}
          </select></label>}
          <label className="text-xs">Find URL occurrences in<select value={scope} onChange={event => setScope(event.target.value)} className={`${INPUT} mt-1`}>
            <option value="current">This request</option><option value="all">All services and top-level requests</option>
            {services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
          </select></label>
        </fieldset>
        <p className="text-xs text-gray-300">Replacements use <code>{placeholder}</code>. Only requests that can access the destination scope are listed.</p>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span>{visible.length} URL occurrences found · {chosen.length} selected</span>
          <button type="button" disabled={busy} className="text-orange-300 hover:underline" onClick={() => setSelected(new Set(chosen.length === visible.length ? [] : visible.map(item => item.id)))}>
            {chosen.length === visible.length ? 'Deselect all' : 'Select all occurrences'}
          </button>
        </div>
        <div className="max-h-60 space-y-2 overflow-y-auto">
          {visible.map(item => <label key={item.id} className="flex gap-3 border border-gray-800 p-3 text-xs">
            <input type="checkbox" disabled={busy} checked={selected.has(item.id)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />
            <span className="min-w-0"><span className="block text-gray-300">{item.location}</span>
              <code className="mt-1 block break-all">{item.url.slice(0, item.start)}<mark className="bg-orange-950 text-orange-200">{placeholder}</mark>{item.url.slice(item.end)}</code>
            </span>
          </label>)}
          {visible.length === 0 && <p className="py-3 text-xs text-gray-400">No URL matches in this scope.</p>}
        </div>
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-800 px-4 py-3">
        <button type="button" disabled={busy} onClick={onClose} className="border border-gray-700 px-3 py-2 text-xs hover:bg-gray-800">Cancel</button>
        <button type="submit" disabled={busy || !name.trim()} className="bg-[#ff6c37] px-3 py-2 text-xs font-semibold text-white hover:bg-[#f95e26] disabled:opacity-50">{busy ? 'Extracting…' : `Extract variable${chosen.length ? ' and replace' : ''}`}</button>
      </div>
    </form>
  </dialog>;
}
