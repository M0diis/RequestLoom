import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useUiStore } from '../../stores/uiStore';
import { CustomDropdown } from './CustomDropdown';
import { ConfirmModal } from './ConfirmModal';
import { ExportImportModal } from './ExportImportModal';
import { SettingsModal } from './SettingsModal';

export function TopBar() {
  const {
    workspaces,
    activeWorkspaceId,
    setActive,
    create: createWorkspace,
    remove: removeWorkspace,
  } = useWorkspaceStore();
  const {
    environments,
    activate: activateEnvironment,
  } = useEnvironmentStore();
  const {
    darkMode,
    toggleDarkMode,
    responseLayout,
    setResponseLayout,
    setDevToolsOpen,
    setActiveDevToolTab,
  } = useUiStore();
  const desktopShell = window.desktopShell;
  const [busy, setBusy] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);
  const workspaceNameInputRef = useRef<HTMLInputElement>(null);

  const handleTitlebarPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !desktopShell) return;
    if ((event.target as HTMLElement).closest('.titlebar-no-drag')) return;

    event.preventDefault();

    const titlebar = event.currentTarget;
    const pointerId = event.pointerId;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      void desktopShell.stopDrag();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      if (titlebar.hasPointerCapture(pointerId)) {
        titlebar.releasePointerCapture(pointerId);
      }
    };
    const move = () => {
      if (!stopped) {
        desktopShell.moveDrag();
      }
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is not available in every Electron/Windows combination.
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    void desktopShell.startDrag().then((started) => {
      if (!started) stop();
    }, stop);
  }, [desktopShell]);

  useEffect(() => {
    if (!desktopShell) {
      return;
    }

    let disposed = false;

    const initializeWindowState = async () => {
      try {
        const maximized = await desktopShell.isMaximized();
        if (!disposed) {
          setIsMaximized(maximized);
        }
      } catch {
        if (!disposed) {
          setIsMaximized(false);
        }
      }
    };

    void initializeWindowState();

    const unsubscribe = desktopShell.onMaximizeChanged((nextState) => {
      setIsMaximized(nextState);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [desktopShell]);

  useEffect(() => {
    if (!workspaceModalOpen) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      workspaceNameInputRef.current?.focus();
    }, 0);

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) {
        return;
      }

      event.preventDefault();
      setWorkspaceModalOpen(false);
      setCreateWorkspaceError(null);
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [busy, workspaceModalOpen]);

  const activeEnvironmentId = environments.find((environment) => environment.isActive)?.id ?? '';
  const canDeleteWorkspace = activeWorkspaceId !== 'default' && workspaces.some((workspace) => workspace.id === activeWorkspaceId);
  const workspaceOptions = workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }));
  const environmentOptions = environments.map((environment) => ({ value: environment.id, label: environment.name }));

  const openWorkspaceModal = () => {
    setNewWorkspaceName('');
    setCreateWorkspaceError(null);
    setWorkspaceModalOpen(true);
  };

  const closeWorkspaceModal = () => {
    if (busy) {
      return;
    }

    setWorkspaceModalOpen(false);
    setCreateWorkspaceError(null);
  };

  const handleCreateWorkspace = async () => {
    const trimmedName = newWorkspaceName.trim();
    if (!trimmedName) {
      setCreateWorkspaceError('Workspace name is required');
      return;
    }

    const duplicateWorkspace = workspaces.some(
      (workspace) => workspace.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicateWorkspace) {
      setCreateWorkspaceError(`Workspace "${trimmedName}" already exists`);
      return;
    }

    setBusy(true);
    setCreateWorkspaceError(null);
    try {
      await createWorkspace(trimmedName);
      setWorkspaceModalOpen(false);
      setNewWorkspaceName('');
    } catch (error) {
      setCreateWorkspaceError(error instanceof Error ? error.message : 'Failed to create workspace');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteWorkspace = () => {
    const workspace = workspaces.find((entry) => entry.id === activeWorkspaceId);
    if (!workspace || workspace.id === 'default') return;
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteWorkspace = async () => {
    const workspace = workspaces.find((entry) => entry.id === activeWorkspaceId);
    if (!workspace || workspace.id === 'default') return;

    setBusy(true);
    try {
      await removeWorkspace(workspace.id);
      setDeleteConfirmOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to delete workspace');
    } finally {
      setBusy(false);
    }
  };

  const [importExportModalOpen, setImportExportModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const handleEnvironmentChange = async (environmentId: string) => {
    if (!environmentId || environmentId === activeEnvironmentId) return;

    setBusy(true);
    try {
      await activateEnvironment(activeWorkspaceId, environmentId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to activate environment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className={`relative z-30 flex h-11 flex-shrink-0 items-center gap-3 overflow-x-auto overflow-y-hidden border-b border-gray-800 bg-[#1a1a1a] px-3 max-lg:gap-2 max-lg:px-2 scrollbar-slim-x ${desktopShell ? 'select-none' : ''}`}
        onPointerDown={desktopShell ? handleTitlebarPointerDown : undefined}
      >
      <div className="relative z-20 flex items-center gap-2 max-lg:gap-1.5">
        <CustomDropdown
          value={activeWorkspaceId}
          options={workspaceOptions}
          onChange={setActive}
          disabled={busy || workspaceOptions.length === 0}
          placeholder="Select workspace"
          title="Workspace"
          className="titlebar-no-drag min-w-[190px] max-lg:min-w-[140px] max-md:min-w-[120px] max-sm:min-w-[100px]"
        />
        <button
          onClick={openWorkspaceModal}
          className="titlebar-no-drag flex items-center gap-1.5 border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-[11px] text-gray-200 hover:bg-gray-800 disabled:opacity-50 max-lg:px-2"
          disabled={busy}
          title="Create workspace"
        >
          <span className="max-lg:hidden">New WS</span>
          <svg className="h-3.5 w-3.5 lg:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button
          onClick={handleDeleteWorkspace}
          className="titlebar-no-drag flex items-center gap-1.5 border border-rose-900 bg-rose-950/20 px-2.5 py-1.5 text-[11px] text-rose-300 hover:bg-rose-950/40 disabled:opacity-50 max-lg:px-2"
          disabled={busy || !canDeleteWorkspace}
          title="Delete active workspace"
        >
          <span className="max-lg:hidden">Delete</span>
          <svg className="h-3.5 w-3.5 lg:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
        <span className="mx-0.5 h-5 w-px bg-gray-700" />
        <button
          onClick={() => setImportExportModalOpen(true)}
          className="titlebar-no-drag flex items-center gap-1.5 border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-[11px] text-gray-200 hover:bg-gray-800 disabled:opacity-50 max-lg:px-2"
          disabled={busy || !activeWorkspaceId}
          title="Export / Import data"
        >
          <span className="max-lg:hidden">Export / Import</span>
          <svg className="h-3.5 w-3.5 lg:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </div>

      <div className="relative z-20 flex items-center gap-1.5">
        <CustomDropdown
          value={activeEnvironmentId}
          options={environmentOptions}
          onChange={(environmentId) => {
            void handleEnvironmentChange(environmentId);
          }}
          disabled={busy || environmentOptions.length === 0}
          placeholder="Select environment"
          title="Environment"
          className="titlebar-no-drag min-w-[170px] max-lg:min-w-[130px] max-md:min-w-[110px] max-sm:min-w-[90px]"
        />
      </div>

      <div className={desktopShell ? 'relative z-10 flex-1 px-3 text-center text-[11px] uppercase tracking-[0.16em] text-gray-500' : 'flex-1'}>
        {desktopShell ? <span className="max-lg:hidden">RequestLoom Desktop</span> : null}
      </div>

      <div className="titlebar-no-drag relative z-20 flex items-center gap-1 max-lg:gap-0.5">
        {/* Response layout toggle */}
        <div className="hidden items-center gap-0.5 border border-gray-700 bg-gray-900 p-0.5 md:flex">
          <button
            onClick={() => setResponseLayout('right')}
            className={`p-1 transition-colors ${responseLayout === 'right' ? 'bg-gray-700 text-[#ffbca3]' : 'text-gray-500 hover:text-gray-300'}`}
            title="Response on right"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="2" width="6" height="12" rx="1" opacity="0.9" />
              <rect x="9" y="2" width="6" height="12" rx="1" opacity="0.4" />
            </svg>
          </button>
          <button
            onClick={() => setResponseLayout('bottom')}
            className={`p-1 transition-colors ${responseLayout === 'bottom' ? 'bg-gray-700 text-[#ffbca3]' : 'text-gray-500 hover:text-gray-300'}`}
            title="Response on bottom"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="1" width="12" height="6" rx="1" opacity="0.9" />
              <rect x="2" y="9" width="12" height="6" rx="1" opacity="0.4" />
            </svg>
          </button>
        </div>

        {/* Dev Tools */}
        <button
          onClick={() => {
            setActiveDevToolTab('terminal');
            setDevToolsOpen(true);
          }}
          className="flex h-7 w-8 items-center justify-center border border-gray-700 bg-gray-900 px-2 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800"
          title="Open Dev Tools"
        >
          <svg className="h-4 w-4" fill="none" viewBox="4 4 16 16" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14v10H5zM8 10l2 2-2 2m4 0h3" />
          </svg>
        </button>

        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
          title="Toggle dark mode"
        >
          {darkMode ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>

        {/* Settings */}
        <button
          onClick={() => setSettingsModalOpen(true)}
          className="p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
          title="Settings"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {desktopShell ? (
        <div className="titlebar-no-drag relative z-20 -my-px ml-1 flex h-11 items-stretch border-l border-gray-800">
          <button
            onClick={() => {
              void desktopShell.minimize();
            }}
            className="flex w-10 items-center justify-center text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-100 max-lg:w-9"
            title="Minimize"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M3 8.5h10" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={() => {
              void desktopShell.maximizeToggle();
            }}
            className="flex w-10 items-center justify-center text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-100 max-lg:w-9"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}>
                <rect x="4" y="5" width="7" height="7" />
                <path d="M6 5V4h6v6h-1" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}>
                <rect x="3.5" y="3.5" width="9" height="9" />
              </svg>
            )}
          </button>
          <button
            onClick={() => {
              void desktopShell.close();
            }}
            className="flex w-10 items-center justify-center text-gray-400 transition-colors hover:bg-rose-600 hover:text-white max-lg:w-9"
            title="Close"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : null}
      </div>

      {workspaceModalOpen ? (
        <div
          className={`fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 ${desktopShell ? 'titlebar-no-drag' : ''}`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeWorkspaceModal();
            }
          }}
        >
          <div className="w-full max-w-md border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
            <div className="border-b border-gray-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-100">Create Workspace</h3>
              <p className="mt-1 text-xs text-gray-500">Create an isolated workspace for services, history, and variables.</p>
            </div>

            <div className="px-4 py-3">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="new-workspace-name">
                Workspace Name
              </label>
              <input
                id="new-workspace-name"
                ref={workspaceNameInputRef}
                type="text"
                value={newWorkspaceName}
                onChange={(event) => {
                  setNewWorkspaceName(event.target.value);
                  if (createWorkspaceError) {
                    setCreateWorkspaceError(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleCreateWorkspace();
                  }
                }}
                placeholder="e.g. QA Sandbox"
                className="w-full border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-gray-100 outline-none focus:border-[#ff6c37]"
                disabled={busy}
              />
              {createWorkspaceError ? (
                <div className="mt-2 border border-rose-900 bg-rose-950/25 px-2.5 py-1.5 text-xs text-rose-300">
                  {createWorkspaceError}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-800 bg-[#1a1a1a] px-4 py-3">
              <button
                type="button"
                onClick={closeWorkspaceModal}
                className="border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleCreateWorkspace();
                }}
                className="border border-[#ff6c37] bg-[#ff6c37] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#f95e26] disabled:opacity-50"
                disabled={busy}
              >
                {busy ? 'Creating...' : 'Create Workspace'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {importExportModalOpen && (
        <ExportImportModal
          onClose={() => setImportExportModalOpen(false)}
          workspaceId={activeWorkspaceId}
        />
      )}

      {settingsModalOpen && (
        <SettingsModal
          onClose={() => setSettingsModalOpen(false)}
        />
      )}

      {deleteConfirmOpen && (() => {
        const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
        return (
          <ConfirmModal
            title="Delete Workspace"
            message={`Delete "${workspace?.name ?? ''}" and all its services, requests, history, variables, environments, and mock servers? This cannot be undone.`}
            confirmLabel="Delete Workspace"
            variant="danger"
            busy={busy}
            onConfirm={() => { void confirmDeleteWorkspace(); }}
            onClose={() => setDeleteConfirmOpen(false)}
          />
        );
      })()}
    </>
  );
}
