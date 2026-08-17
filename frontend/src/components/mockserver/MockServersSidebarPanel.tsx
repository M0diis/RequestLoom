import { useState } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useMockServerStore } from '../../stores/mockServerStore';
import type { MockServer } from '../../types';

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-400',
  PATCH: 'text-violet-400',
  DELETE: 'text-rose-400',
  OPTIONS: 'text-gray-400',
  HEAD: 'text-gray-400',
};

export function MockServersSidebarPanel() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const {
    mockServers, selectedServerId, selectedEndpointId,
    create, update, remove, start, stop,
    setSelectedServer, setSelectedEndpoint,
  } = useMockServerStore();

  const [newServerName, setNewServerName] = useState('');
  const [addingServer, setAddingServer] = useState(false);
  const [collapsedServers, setCollapsedServers] = useState<Set<string>>(new Set());
  const [showServerModal, setShowServerModal] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [serverFormName, setServerFormName] = useState('');
  const [serverFormDesc, setServerFormDesc] = useState('');
  const [serverFormSlug, setServerFormSlug] = useState('');
  const [saving, setSaving] = useState(false);

  const servers = Array.isArray(mockServers) ? mockServers : [];

  const toggleCollapse = (serverId: string) => {
    setCollapsedServers((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) next.delete(serverId);
      else next.add(serverId);
      return next;
    });
  };

  const handleAddServer = async () => {
    if (!newServerName.trim()) return;
    await create(activeWorkspaceId, {
      name: newServerName.trim(),
      description: '',
      slug: '',
      port: 0,
    });
    setNewServerName('');
    setAddingServer(false);
  };

  const openNewServerModal = () => {
    setEditingServerId(null);
    setServerFormName('');
    setServerFormDesc('');
    setServerFormSlug('');
    setShowServerModal(true);
  };

  const openEditServerModal = (s: MockServer) => {
    setEditingServerId(s.id);
    setServerFormName(s.name);
    setServerFormDesc(s.description);
    setServerFormSlug(s.slug === s.id ? '' : s.slug);
    setShowServerModal(true);
  };

  const handleSaveServer = async () => {
    if (!serverFormName.trim()) return;
    setSaving(true);
    try {
      if (editingServerId) {
        await update(activeWorkspaceId, editingServerId, {
          name: serverFormName.trim(),
          description: serverFormDesc,
          slug: serverFormSlug.trim(),
          port: 0,
        });
      } else {
        const s = await create(activeWorkspaceId, {
          name: serverFormName.trim(),
          description: serverFormDesc,
          slug: serverFormSlug.trim(),
          port: 0,
        });
        setSelectedServer(s.id);
      }
      setShowServerModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteServer = async (id: string) => {
    if (!confirm('Delete this mock server and all its endpoints?')) return;
    await remove(activeWorkspaceId, id);
  };

  const handleToggleRunning = async (s: MockServer) => {
    if (s.isRunning) {
      await stop(activeWorkspaceId, s.id);
    } else {
      await start(activeWorkspaceId, s.id);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Server tree */}
      <div className="flex-1 overflow-y-auto">
        {servers.map((server) => (
          <div key={server.id} className="border-b border-gray-900/70">
            {/* Server header */}
            <div
              className={`group flex cursor-pointer items-center px-3 py-2 text-xs font-semibold hover:bg-gray-900/60 ${
                selectedServerId === server.id ? 'bg-gray-800/50 text-gray-100 border-l-2 border-l-purple-500' : 'text-gray-200 border-l-2 border-l-transparent'
              }`}
              onClick={() => toggleCollapse(server.id)}
            >
              <svg
                className={`mr-1.5 h-3 w-3 text-gray-500 transition-transform ${collapsedServers.has(server.id) ? '' : 'rotate-90'}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 flex-shrink-0 ${server.isRunning ? 'bg-emerald-400 shadow-[0_0_4px_rgba(74,222,128,0.4)]' : 'bg-zinc-600'}`}
              />
              <span className="truncate flex-1">{server.name}</span>
              <span className="mr-1 text-[10px] text-gray-500">{server.endpoints.length}</span>
              {/* Play/Stop */}
              <button
                onClick={(e) => { e.stopPropagation(); handleToggleRunning(server); }}
                className={`p-0.5 ${server.isRunning ? 'text-emerald-400 hover:bg-emerald-400/10' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'}`}
                title={server.isRunning ? 'Stop' : 'Start'}
              >
                {server.isRunning ? (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                ) : (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                )}
              </button>
              {/* Edit */}
              <button
                onClick={(e) => { e.stopPropagation(); openEditServerModal(server); }}
                className="p-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                title="Edit server"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              {/* Delete */}
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteServer(server.id); }}
                className="p-0.5 text-gray-600 hover:text-rose-400 hover:bg-rose-400/10"
                title="Delete server"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Slug info when expanded */}
            {!collapsedServers.has(server.id) && (
              <div className="pl-10 pr-3 py-1.5 space-y-1">
                <div className="text-[10px] text-gray-500 truncate font-mono select-all">
                  /mock/{server.slug || server.id}
                </div>
              </div>
            )}

            {/* Endpoints */}
            {!collapsedServers.has(server.id) && server.endpoints.map((ep) => (
              <button
                key={ep.id}
                onClick={() => {
                  setSelectedServer(server.id);
                  setSelectedEndpoint(ep.id);
                }}
                className={`w-full text-left pl-10 pr-3 py-1.5 text-xs flex items-center gap-2 ${
                  selectedEndpointId === ep.id
                    ? 'bg-gray-800/70 text-gray-100'
                    : 'text-gray-400 hover:bg-gray-900/50'
                }`}
              >
                <span className={`font-mono text-[10px] font-bold w-10 ${METHOD_COLORS[ep.method]}`}>
                  {ep.method}
                </span>
                <span className="truncate flex-1">{ep.path}</span>
                <span className="text-[10px] text-gray-600">{ep.statusCode}</span>
                {ep.scriptEnabled && (
                  <span className="text-[10px] text-amber-400">JS</span>
                )}
              </button>
            ))}

            {/* Add endpoint hint */}
            {!collapsedServers.has(server.id) && (
              <button
                onClick={() => {
                  setSelectedServer(server.id);
                  setSelectedEndpoint(null);
                }}
                className="w-full text-left pl-10 pr-3 py-1 text-[10px] text-gray-600 hover:text-purple-400 transition-colors"
              >
                + Add endpoint
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add server */}
      <div className="px-3 py-2 border-t border-gray-800">
        {addingServer ? (
          <input
            autoFocus
            className="w-full border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100 outline-none focus:border-gray-400"
            placeholder="Mock server name"
            value={newServerName}
            onChange={(e) => setNewServerName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddServer();
              if (e.key === 'Escape') setAddingServer(false);
            }}
            onBlur={() => setTimeout(() => setAddingServer(false), 150)}
          />
        ) : (
          <button
            onClick={openNewServerModal}
            className="flex w-full items-center gap-1 py-1 text-xs text-gray-500 hover:text-purple-400 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Mock Server
          </button>
        )}
      </div>

      {/* Server Form Modal */}
      {showServerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowServerModal(false)}>
          <div className="bg-zinc-800 border border-zinc-600/60 rounded-xl w-full max-w-md p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-zinc-100 mb-4">
              {editingServerId ? 'Edit Mock Server' : 'New Mock Server'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Name</label>
                <input
                  type="text"
                  value={serverFormName}
                  onChange={(e) => setServerFormName(e.target.value)}
                  placeholder="My Mock API"
                  className="w-full bg-zinc-700/50 border border-zinc-600 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Slug (URL path, e.g. "my-api")
                </label>
                <div className="flex items-center bg-zinc-700/50 border border-zinc-600 rounded-md overflow-hidden">
                  <span className="pl-3 text-xs text-zinc-500 font-mono">/mock/</span>
                  <input
                    type="text"
                    value={serverFormSlug}
                    onChange={(e) => setServerFormSlug(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase())}
                    placeholder="my-api"
                    className="flex-1 bg-transparent px-2 py-2 text-sm text-purple-300 font-mono placeholder-zinc-500 focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-zinc-600 mt-1">Leave blank to use auto-generated ID. Only letters, numbers, hyphens, underscores.</p>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Description</label>
                <input
                  type="text"
                  value={serverFormDesc}
                  onChange={(e) => setServerFormDesc(e.target.value)}
                  placeholder="Optional description"
                  className="w-full bg-zinc-700/50 border border-zinc-600 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowServerModal(false)}
                className="px-4 py-1.5 text-xs rounded-md border border-zinc-600 text-zinc-400 hover:bg-zinc-700/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveServer}
                disabled={saving || !serverFormName.trim()}
                className="px-4 py-1.5 text-xs rounded-md bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
