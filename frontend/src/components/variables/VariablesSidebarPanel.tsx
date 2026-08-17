import { useEffect } from 'react';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useRequestStore } from '../../stores/requestStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

export function VariablesSidebarPanel() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { environments, activate: activateEnvironment, load: loadEnvironments } = useEnvironmentStore();
  const { services } = useRequestStore();
  const {
    variableServiceFilterId,
    variableSearchQuery,
    setVariableServiceFilterId,
    setVariableSearchQuery,
  } = useUiStore();

  useEffect(() => {
    if (!variableServiceFilterId) return;
    const stillExists = services.some((s) => s.id === variableServiceFilterId);
    if (!stillExists) setVariableServiceFilterId('');
  }, [services, variableServiceFilterId, setVariableServiceFilterId]);

  const handleActivate = async (envId: string) => {
    if (!activeWorkspaceId) return;
    await activateEnvironment(activeWorkspaceId, envId);
    await loadEnvironments(activeWorkspaceId);
  };

  return (
    <div className="flex h-full flex-col bg-[#111111] text-gray-200">
      <div className="border-b border-gray-800 bg-[#1a1a1a] px-3 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Variables</h3>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">

        <section>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Search</label>
          <input
            type="text"
            value={variableSearchQuery}
            onChange={(e) => setVariableSearchQuery(e.target.value)}
            placeholder="key or value"
            className="w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-gray-500"
          />
        </section>

        <section>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Environments</div>
          <div className="space-y-1">
            {environments.map((env) => (
              <button
                key={env.id}
                type="button"
                onClick={() => { if (!env.isActive) void handleActivate(env.id); }}
                disabled={env.isActive}
                title={env.isActive ? 'Currently active' : 'Click to activate'}
                className={`flex w-full items-center justify-between gap-2 border px-2 py-1.5 text-left text-xs transition-colors ${
                  env.isActive
                    ? 'border-emerald-900/40 bg-emerald-950/10 text-emerald-400 cursor-default'
                    : 'border-gray-800 bg-gray-900/50 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                <span className="truncate">{env.name}</span>
                {env.isActive && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-gray-600">Click to set active. Manage in the Variables page.</p>
        </section>

        <section>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Service Focus</div>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setVariableServiceFilterId('')}
              className={`flex w-full items-center border px-2 py-1.5 text-left text-xs transition-colors ${
                !variableServiceFilterId
                  ? 'border-gray-600 bg-gray-800 text-gray-100'
                  : 'border-gray-800 bg-gray-900/50 text-gray-400 hover:border-gray-600 hover:text-gray-200'
              }`}
            >
              All services
            </button>
            {services.map((service) => (
              <button
                key={service.id}
                type="button"
                onClick={() => setVariableServiceFilterId(service.id)}
                className={`flex w-full items-center border px-2 py-1.5 text-left text-xs transition-colors ${
                  variableServiceFilterId === service.id
                    ? 'border-gray-600 bg-gray-800 text-gray-100'
                    : 'border-gray-800 bg-gray-900/50 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                <span className="truncate">{service.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="border border-gray-800 bg-gray-900/40 px-2.5 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">Resolution Order</div>
          <p className="mt-1 text-[11px] text-gray-600">
            Request → Service → Workspace. Env-scoped overrides unscoped.
          </p>
        </section>

      </div>
    </div>
  );
}
