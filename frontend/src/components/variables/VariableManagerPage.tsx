import { useEffect, useMemo, useState } from 'react';
import { serviceVariablesApi, workspaceVariablesApi } from '../../services/api';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useRequestStore } from '../../stores/requestStore';
import { useUiStore } from '../../stores/uiStore';
import type { ServiceVariable, WorkspaceVariable } from '../../types';
import { CustomDropdown } from '../common/CustomDropdown';
import { AutocompleteInput } from '../common/AutocompleteInput';
import { DEFAULT_DYNAMIC_VALUE_SUGGESTIONS } from '../../lib/dynamicValues';

interface VariableDraft {
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
  reveal: boolean;
  environmentId: string | null;
}

function toDraftMap<T extends { id: string; key: string; value: string; isSecret: boolean; enabled: boolean; environmentId?: string | null }>(
  variables: T[]
): Record<string, VariableDraft> {
  return Object.fromEntries(
    variables.map((v) => [v.id, { key: v.key, value: v.value, isSecret: v.isSecret, enabled: v.enabled, reveal: false, environmentId: v.environmentId ?? null }])
  );
}

function matchesSearch(draft: VariableDraft, q: string): boolean {
  if (!q) return true;
  return draft.key.toLowerCase().includes(q) || draft.value.toLowerCase().includes(q);
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 4h6l1 3H8l1-3zM8 7l1 12h6l1-12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

const BTN_ICON = 'inline-flex h-7 w-7 items-center justify-center border transition-colors disabled:cursor-not-allowed disabled:opacity-40';
const BTN_SAVE = `${BTN_ICON} border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500 hover:text-gray-100`;
const BTN_DEL  = `${BTN_ICON} border-rose-900/60 bg-rose-950/10 text-rose-400 hover:bg-rose-950/30`;
const BTN_SM   = 'border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
const BTN_GHOST = 'border border-transparent px-2.5 py-1 text-xs text-gray-400 hover:border-gray-700 hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
const INPUT = 'border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500 w-full';

export function VariableManagerPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { environments, load: loadEnvironments, create: createEnvironment, update: updateEnvironment, activate: activateEnvironment, remove: removeEnvironment } = useEnvironmentStore();
  const { services } = useRequestStore();
  const { variableServiceFilterId, variableSearchQuery, setVariableServiceFilterId, setVariableSearchQuery } = useUiStore();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [globalVariables, setGlobalVariables] = useState<WorkspaceVariable[]>([]);
  const [globalDrafts, setGlobalDrafts] = useState<Record<string, VariableDraft>>({});
  const [newGlobalKey, setNewGlobalKey] = useState('');
  const [newGlobalValue, setNewGlobalValue] = useState('');
  const [newGlobalSecret, setNewGlobalSecret] = useState(false);
  const [newGlobalEnvId, setNewGlobalEnvId] = useState('');

  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [serviceVariables, setServiceVariables] = useState<ServiceVariable[]>([]);
  const [serviceDrafts, setServiceDrafts] = useState<Record<string, VariableDraft>>({});
  const [newServiceKey, setNewServiceKey] = useState('');
  const [newServiceValue, setNewServiceValue] = useState('');
  const [newServiceSecret, setNewServiceSecret] = useState(false);
  const [newServiceEnvId, setNewServiceEnvId] = useState('');

  const [selectedEnvId, setSelectedEnvId] = useState('');
  const [editingEnvName, setEditingEnvName] = useState('');
  const [newEnvName, setNewEnvName] = useState('');
  const [showNewEnvInput, setShowNewEnvInput] = useState(false);

  const envOptions = useMemo(
    () => [{ value: '', label: 'All' }, ...environments.map((e) => ({ value: e.id, label: e.name }))],
    [environments]
  );

  const serviceOptions = useMemo(
    () => services.map((s) => ({ value: s.id, label: s.name })),
    [services]
  );

  const searchQuery = useMemo(() => variableSearchQuery.trim().toLowerCase(), [variableSearchQuery]);

  const filteredGlobal = useMemo(
    () => globalVariables.filter((v) => matchesSearch(globalDrafts[v.id] ?? { key: v.key, value: v.value } as VariableDraft, searchQuery)),
    [globalVariables, globalDrafts, searchQuery]
  );

  const filteredService = useMemo(
    () => serviceVariables.filter((v) => matchesSearch(serviceDrafts[v.id] ?? { key: v.key, value: v.value } as VariableDraft, searchQuery)),
    [serviceVariables, serviceDrafts, searchQuery]
  );

  const selectedEnv = useMemo(() => environments.find((e) => e.id === selectedEnvId), [environments, selectedEnvId]);
  const canDeleteEnv = Boolean(selectedEnv) && environments.length > 1 && !selectedEnv?.isActive;

  // Dirty tracking
  const globalDirty = useMemo(() => {
    for (const v of globalVariables) {
      const d = globalDrafts[v.id];
      if (!d) continue;
      if (d.key !== v.key || d.value !== v.value || d.isSecret !== v.isSecret || d.enabled !== v.enabled) return true;
      if ((d.environmentId ?? null) !== (v.environmentId ?? null)) return true;
    }
    return false;
  }, [globalVariables, globalDrafts]);

  const serviceDirty = useMemo(() => {
    for (const v of serviceVariables) {
      const d = serviceDrafts[v.id];
      if (!d) continue;
      if (d.key !== v.key || d.value !== v.value || d.isSecret !== v.isSecret || d.enabled !== v.enabled) return true;
      if ((d.environmentId ?? null) !== (v.environmentId ?? null)) return true;
    }
    return false;
  }, [serviceVariables, serviceDrafts]);

  useEffect(() => {
    if (variableServiceFilterId && services.some((s) => s.id === variableServiceFilterId)) {
      setSelectedServiceId(variableServiceFilterId);
      return;
    }
    setSelectedServiceId((prev) => {
      if (prev && services.some((s) => s.id === prev)) return prev;
      return services[0]?.id ?? '';
    });
  }, [services, variableServiceFilterId]);

  useEffect(() => {
    const loadGlobal = async () => {
      setLoading(true);
      setError(null);
      try {
        const vars = await workspaceVariablesApi.getAll(activeWorkspaceId);
        setGlobalVariables(vars);
        setGlobalDrafts(toDraftMap(vars));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load variables');
      } finally {
        setLoading(false);
      }
    };
    void loadGlobal();
  }, [activeWorkspaceId]);

  useEffect(() => {
    const loadService = async () => {
      if (!selectedServiceId) { setServiceVariables([]); setServiceDrafts({}); return; }
      setLoading(true);
      setError(null);
      try {
        const vars = await serviceVariablesApi.getAll(selectedServiceId);
        setServiceVariables(vars);
        setServiceDrafts(toDraftMap(vars));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load service variables');
      } finally {
        setLoading(false);
      }
    };
    void loadService();
  }, [selectedServiceId]);

  useEffect(() => {
    setEditingEnvName(selectedEnv?.name ?? '');
  }, [selectedEnv]);

  const refreshGlobal = async () => {
    const vars = await workspaceVariablesApi.getAll(activeWorkspaceId);
    setGlobalVariables(vars);
    setGlobalDrafts(toDraftMap(vars));
  };

  const refreshService = async () => {
    if (!selectedServiceId) return;
    const vars = await serviceVariablesApi.getAll(selectedServiceId);
    setServiceVariables(vars);
    setServiceDrafts(toDraftMap(vars));
  };

  const handleCreateEnv = async () => {
    const name = newEnvName.trim();
    if (!name) { setError('Environment name is required'); return; }
    if (environments.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" already exists`); return;
    }
    setSaving(true); setError(null);
    try {
      const created = await createEnvironment(activeWorkspaceId, name);
      setNewEnvName(''); setShowNewEnvInput(false);
      await loadEnvironments(activeWorkspaceId);
      setSelectedEnvId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create environment');
    } finally { setSaving(false); }
  };

  const handleRenameEnv = async () => {
    if (!selectedEnv) return;
    const name = editingEnvName.trim();
    if (!name) { setError('Name is required'); return; }
    setSaving(true); setError(null);
    try {
      await updateEnvironment(activeWorkspaceId, selectedEnv.id, name);
      await loadEnvironments(activeWorkspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename environment');
    } finally { setSaving(false); }
  };

  const handleActivateEnv = async (envId: string) => {
    setSaving(true); setError(null);
    try {
      await activateEnvironment(activeWorkspaceId, envId);
      await loadEnvironments(activeWorkspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate environment');
    } finally { setSaving(false); }
  };

  const handleDeleteEnv = async () => {
    if (!selectedEnv) return;
    if (!window.confirm(`Delete environment "${selectedEnv.name}"?`)) return;
    setSaving(true); setError(null);
    try {
      await removeEnvironment(activeWorkspaceId, selectedEnv.id);
      setSelectedEnvId('');
      await loadEnvironments(activeWorkspaceId);
      await refreshGlobal();
      await refreshService();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete environment');
    } finally { setSaving(false); }
  };

  const addGlobalVar = async () => {
    const key = newGlobalKey.trim();
    if (!key) { setError('Key is required'); return; }
    setSaving(true); setError(null);
    try {
      await workspaceVariablesApi.upsert(activeWorkspaceId, { key, value: newGlobalValue, isSecret: newGlobalSecret, enabled: true, environmentId: newGlobalEnvId || null });
      setNewGlobalKey(''); setNewGlobalValue(''); setNewGlobalSecret(false); setNewGlobalEnvId('');
      await refreshGlobal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add variable');
    } finally { setSaving(false); }
  };

  const saveGlobalVar = async (variable: WorkspaceVariable) => {
    const draft = globalDrafts[variable.id];
    if (!draft) return;
    const key = draft.key.trim();
    if (!key) { setError('Key is required'); return; }
    setSaving(true); setError(null);
    try {
      await workspaceVariablesApi.upsert(activeWorkspaceId, { id: variable.id, key, value: draft.value, isSecret: draft.isSecret, enabled: draft.enabled, environmentId: draft.environmentId });
      await refreshGlobal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save variable');
    } finally { setSaving(false); }
  };

  const deleteGlobalVar = async (id: string) => {
    setSaving(true); setError(null);
    try {
      await workspaceVariablesApi.delete(activeWorkspaceId, id);
      await refreshGlobal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete variable');
    } finally { setSaving(false); }
  };

  const patchGlobal = (id: string, patch: Partial<VariableDraft>) =>
    setGlobalDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const addServiceVar = async () => {
    const key = newServiceKey.trim();
    if (!key || !selectedServiceId) { setError('Key is required'); return; }
    setSaving(true); setError(null);
    try {
      await serviceVariablesApi.upsert(selectedServiceId, { key, value: newServiceValue, isSecret: newServiceSecret, enabled: true, environmentId: newServiceEnvId || null });
      setNewServiceKey(''); setNewServiceValue(''); setNewServiceSecret(false); setNewServiceEnvId('');
      await refreshService();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add variable');
    } finally { setSaving(false); }
  };

  const saveServiceVar = async (variable: ServiceVariable) => {
    const draft = serviceDrafts[variable.id];
    if (!draft || !selectedServiceId) return;
    const key = draft.key.trim();
    if (!key) { setError('Key is required'); return; }
    setSaving(true); setError(null);
    try {
      await serviceVariablesApi.upsert(selectedServiceId, { id: variable.id, environmentId: draft.environmentId, key, value: draft.value, isSecret: draft.isSecret, enabled: draft.enabled });
      await refreshService();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save variable');
    } finally { setSaving(false); }
  };

  const deleteServiceVar = async (id: string) => {
    if (!selectedServiceId) return;
    setSaving(true); setError(null);
    try {
      await serviceVariablesApi.delete(selectedServiceId, id);
      await refreshService();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete variable');
    } finally { setSaving(false); }
  };

  const patchService = (id: string, patch: Partial<VariableDraft>) =>
    setServiceDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleServiceSelect = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setVariableServiceFilterId(serviceId);
  };

  const renderVarRow = (
    id: string,
    draft: VariableDraft,
    patch: (id: string, p: Partial<VariableDraft>) => void,
    onSave: () => void,
    onDelete: () => void
  ) => (
    <div key={id} className="flex flex-wrap items-center gap-1.5 border-b border-gray-800/50 px-3 py-2 last:border-b-0 hover:bg-gray-900/25 transition-colors">
      <button
        type="button"
        aria-label={draft.enabled ? 'Disable' : 'Enable'}
        title={draft.enabled ? 'Enabled' : 'Disabled'}
        onClick={() => patch(id, { enabled: !draft.enabled })}
        className={`h-4 w-4 flex-shrink-0 border transition-colors ${draft.enabled ? 'border-emerald-700 bg-emerald-900/50' : 'border-gray-700 bg-transparent'}`}
      />

      <input
        type="text"
        value={draft.key}
        onChange={(e) => patch(id, { key: e.target.value })}
        className={INPUT}
        placeholder="key"
        style={{ flex: '1 1 110px', minWidth: '80px' }}
      />

      <div className="relative flex items-center" style={{ flex: '2 1 150px', minWidth: '100px' }}>
        <AutocompleteInput
          value={draft.value}
          onChange={(value) => patch(id, { value })}
          suggestions={[]}
          dynamicSuggestions={DEFAULT_DYNAMIC_VALUE_SUGGESTIONS}
          type={draft.isSecret && !draft.reveal ? 'password' : 'text'}
          className={`${INPUT} ${draft.isSecret ? 'pr-7' : ''}`}
          placeholder="value"
        />
        {draft.isSecret && (
          <button
            type="button"
            onClick={() => patch(id, { reveal: !draft.reveal })}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-gray-500 hover:text-gray-300"
            aria-label={draft.reveal ? 'Hide' : 'Reveal'}
          >
            <EyeIcon open={draft.reveal} />
          </button>
        )}
      </div>

      <div className="flex-shrink-0 w-[112px]">
        <CustomDropdown
          value={draft.environmentId ?? ''}
          onChange={(v) => patch(id, { environmentId: v || null })}
          options={envOptions}
          buttonClassName="px-2 py-1.5 text-[11px] w-full"
          menuClassName="w-[180px]"
        />
      </div>

      <button
        type="button"
        title={draft.isSecret ? 'Secret' : 'Plain'}
        onClick={() => patch(id, { isSecret: !draft.isSecret, reveal: false })}
        className={`flex-shrink-0 border px-2 py-1 text-[10px] transition-colors ${
          draft.isSecret
            ? 'border-amber-800/60 bg-amber-950/20 text-amber-400'
            : 'border-gray-800 bg-transparent text-gray-600 hover:text-gray-400'
        }`}
      >
        {draft.isSecret ? 'SECRET' : 'plain'}
      </button>

      <button type="button" onClick={onSave} disabled={saving} className={BTN_SAVE} title="Save" aria-label="Save variable">
        <SaveIcon />
      </button>

      <button type="button" onClick={onDelete} disabled={saving} className={BTN_DEL} title="Delete" aria-label="Delete variable">
        <TrashIcon />
      </button>
    </div>
  );

  const renderNewRow = (
    keyVal: string, setKey: (v: string) => void,
    valueVal: string, setValue: (v: string) => void,
    isSecret: boolean, setIsSecret: (v: boolean) => void,
    envId: string, setEnvId: (v: string) => void,
    onAdd: () => void
  ) => (
    <div className="flex flex-wrap items-center gap-1.5 bg-[#151515] px-3 py-2.5 border-t border-gray-800/50">
      <div className="h-4 w-4 flex-shrink-0 border border-dashed border-gray-700 opacity-30" />

      <input
        type="text"
        value={keyVal}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void onAdd(); }}
        placeholder="new key"
        className={INPUT}
        style={{ flex: '1 1 110px', minWidth: '80px' }}
      />

      <AutocompleteInput
        value={valueVal}
        onChange={setValue}
        onKeyDown={(e) => { if (e.key === 'Enter') void onAdd(); }}
        suggestions={[]}
        dynamicSuggestions={DEFAULT_DYNAMIC_VALUE_SUGGESTIONS}
        type={isSecret ? 'password' : 'text'}
        placeholder="value"
        className={INPUT}
      />

      <div className="flex-shrink-0 w-[112px]">
        <CustomDropdown
          value={envId}
          onChange={setEnvId}
          options={envOptions}
          buttonClassName="px-2 py-1.5 text-[11px] w-full"
          menuClassName="w-[180px]"
        />
      </div>

      <button
        type="button"
        onClick={() => setIsSecret(!isSecret)}
        className={`flex-shrink-0 border px-2 py-1 text-[10px] transition-colors ${
          isSecret
            ? 'border-amber-800/60 bg-amber-950/20 text-amber-400'
            : 'border-gray-800 bg-transparent text-gray-600 hover:text-gray-400'
        }`}
      >
        {isSecret ? 'SECRET' : 'plain'}
      </button>

      <button
        type="button"
        onClick={onAdd}
        disabled={saving || !keyVal.trim()}
        className={`${BTN_SM} flex items-center gap-1 flex-shrink-0`}
      >
        <PlusIcon />
        Add
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-[#111111] px-4 py-4 text-gray-200 sm:px-5">

      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-100">Variables</h2>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="h-2.5 w-2.5 animate-spin border border-gray-600 border-t-gray-300 flex-shrink-0" />
          )}
          <input
            type="text"
            value={variableSearchQuery}
            onChange={(e) => setVariableSearchQuery(e.target.value)}
            placeholder="Search…"
            className="border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-100 outline-none focus:border-gray-500 w-40"
          />
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-center justify-between border border-rose-900 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-3 text-rose-500 hover:text-rose-300 leading-none">x</button>
        </div>
      )}

      {/* Environments */}
      <section className="mb-5 border border-gray-800 bg-[#1a1a1a]">
        <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Environments</span>
          <button type="button" onClick={() => setShowNewEnvInput((v) => !v)} className={BTN_GHOST} disabled={saving}>
            + New
          </button>
        </div>

        {showNewEnvInput && (
          <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-900/30 px-3 py-2">
            <input
              type="text"
              autoFocus
              value={newEnvName}
              onChange={(e) => setNewEnvName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateEnv();
                if (e.key === 'Escape') { setShowNewEnvInput(false); setNewEnvName(''); }
              }}
              placeholder="e.g. staging-eu"
              className="flex-1 border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs text-gray-100 outline-none focus:border-gray-500"
            />
            <button type="button" onClick={handleCreateEnv} disabled={saving || !newEnvName.trim()} className={BTN_SM}>Create</button>
            <button type="button" onClick={() => { setShowNewEnvInput(false); setNewEnvName(''); }} className={BTN_GHOST}>Cancel</button>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
          {environments.map((env) => {
            const isSelected = env.id === selectedEnvId;
            return (
              <button
                key={env.id}
                type="button"
                onClick={() => setSelectedEnvId(isSelected ? '' : env.id)}
                title={env.isActive ? 'Active environment' : 'Click to manage'}
                className={`flex items-center gap-1.5 border px-2.5 py-1 text-xs transition-colors ${
                  isSelected
                    ? 'border-gray-500 bg-gray-700 text-gray-100'
                    : 'border-gray-800 bg-[#141414] text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                {env.name}
                {env.isActive && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="Active" />}
              </button>
            );
          })}
        </div>

        {selectedEnv && (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 bg-[#151515] px-3 py-2">
            <input
              type="text"
              value={editingEnvName}
              onChange={(e) => setEditingEnvName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameEnv(); }}
              className="border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100 outline-none focus:border-gray-500 min-w-[130px] max-w-xs"
            />
            <button type="button" onClick={handleRenameEnv} disabled={saving} className={BTN_SM}>Rename</button>
            {!selectedEnv.isActive && (
              <button
                type="button"
                onClick={() => void handleActivateEnv(selectedEnv.id)}
                disabled={saving}
                className="border border-emerald-900 bg-emerald-950/20 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-40 transition-colors"
              >
                Set Active
              </button>
            )}
            {selectedEnv.isActive && (
              <span className="border border-emerald-900/40 px-2.5 py-1 text-xs text-emerald-600">Active</span>
            )}
            <button
              type="button"
              onClick={() => void handleDeleteEnv()}
              disabled={saving || !canDeleteEnv}
              title={!canDeleteEnv ? 'Cannot delete the active or last environment' : 'Delete environment'}
              className="border border-rose-900/60 bg-rose-950/10 px-2.5 py-1 text-xs text-rose-400 hover:bg-rose-950/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Delete
            </button>
          </div>
        )}
      </section>

      {/* Workspace Variables */}
      <section className="mb-5 border border-gray-800 bg-[#1a1a1a]">
        <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Workspace Variables</span>
            {globalDirty && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">Unsaved</span>
            )}
          </div>
          <span className="text-[11px] text-gray-600">
            {searchQuery ? `${filteredGlobal.length} / ${globalVariables.length}` : globalVariables.length}
          </span>
        </div>

        {filteredGlobal.length === 0 && !loading && (
          <div className="px-3 py-6 text-xs text-gray-600">
            {globalVariables.length === 0 ? 'No workspace variables yet. Add one below.' : 'No variables match your search.'}
          </div>
        )}

        {filteredGlobal.map((variable) => {
          const draft = globalDrafts[variable.id];
          if (!draft) return null;
          return renderVarRow(variable.id, draft, patchGlobal, () => void saveGlobalVar(variable), () => void deleteGlobalVar(variable.id));
        })}

        {renderNewRow(
          newGlobalKey, setNewGlobalKey,
          newGlobalValue, setNewGlobalValue,
          newGlobalSecret, setNewGlobalSecret,
          newGlobalEnvId, setNewGlobalEnvId,
          addGlobalVar
        )}
      </section>

      {/* Service Variables */}
      <section className="border border-gray-800 bg-[#1a1a1a]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Service Variables</span>
            {serviceDirty && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">Unsaved</span>
            )}
          </div>
          <CustomDropdown
            value={selectedServiceId}
            onChange={handleServiceSelect}
            options={serviceOptions}
            placeholder="Select service…"
            disabled={serviceOptions.length === 0}
            className="min-w-[180px]"
            buttonClassName="px-2 py-1.5 text-xs"
            menuClassName="w-[240px]"
          />
        </div>

        {!selectedServiceId ? (
          <div className="px-3 py-6 text-xs text-gray-600">Select a service above to manage its variables.</div>
        ) : (
          <>
            {filteredService.length === 0 && !loading && (
              <div className="px-3 py-6 text-xs text-gray-600">
                {serviceVariables.length === 0 ? 'No service variables yet. Add one below.' : 'No variables match your search.'}
              </div>
            )}

            {filteredService.map((variable) => {
              const draft = serviceDrafts[variable.id];
              if (!draft) return null;
              return renderVarRow(variable.id, draft, patchService, () => void saveServiceVar(variable), () => void deleteServiceVar(variable.id));
            })}

            {renderNewRow(
              newServiceKey, setNewServiceKey,
              newServiceValue, setNewServiceValue,
              newServiceSecret, setNewServiceSecret,
              newServiceEnvId, setNewServiceEnvId,
              addServiceVar
            )}
          </>
        )}
      </section>

      <p className="mt-4 text-[11px] text-gray-700">
        Resolution: request vars → service vars → workspace vars. Env-scoped values override unscoped for the active environment.
      </p>
    </div>
  );
}
