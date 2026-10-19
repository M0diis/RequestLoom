import { useRequestStore } from '../stores/requestStore';
import { useScriptFileStore } from '../stores/scriptFileStore';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { toast } from '../stores/toastStore';

/** Actions shared by keyboard shortcuts, the command palette and buttons. */

export async function saveActiveTab() {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  const { activeFileKey, save } = useScriptFileStore.getState();
  if (activeFileKey) {
    try {
      await save(workspaceId, activeFileKey);
      toast('File saved');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save file', { variant: 'error' });
    }
    return;
  }

  const { activeRequestId, saveRequest } = useRequestStore.getState();
  if (!activeRequestId) return;
  await saveRequest(activeRequestId);
  const state = useRequestStore.getState();
  if (state.isRequestDirty(activeRequestId)) {
    toast(state.error ?? 'Could not save request. Your draft is retained.', { variant: 'error' });
  } else {
    toast('Request saved');
  }
}

export function sendActiveTab() {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  const { activeFileKey, run } = useScriptFileStore.getState();
  if (activeFileKey) void run(workspaceId, activeFileKey).catch(() => {});
  else void useRequestStore.getState().sendRequest(workspaceId);
}

export function closeActiveTab() {
  const { activeFileKey, closeFile } = useScriptFileStore.getState();
  if (activeFileKey) {
    closeFile(activeFileKey);
    return;
  }
  const { activeRequestId, closeRequest } = useRequestStore.getState();
  if (activeRequestId) closeRequest(activeRequestId);
}

type TabRef = { kind: 'request' | 'script'; id: string };

/** Moves to the next/previous tab in tab-bar order (requests first, then scripts). */
export function cycleTabs(direction: 1 | -1) {
  const { openRequestIds, activeRequestId, selectRequest } = useRequestStore.getState();
  const { openFileKeys, activeFileKey, setActiveFile } = useScriptFileStore.getState();
  const tabs: TabRef[] = [
    ...openRequestIds.map((id) => ({ kind: 'request' as const, id })),
    ...openFileKeys.map((id) => ({ kind: 'script' as const, id })),
  ];
  if (tabs.length < 2) return;

  const current = activeFileKey
    ? tabs.findIndex((tab) => tab.kind === 'script' && tab.id === activeFileKey)
    : tabs.findIndex((tab) => tab.kind === 'request' && tab.id === activeRequestId);
  const next = tabs[(Math.max(current, 0) + direction + tabs.length) % tabs.length];
  if (next.kind === 'script') {
    setActiveFile(next.id);
  } else {
    setActiveFile(null);
    void selectRequest(next.id);
  }
}

export function focusUrlBar() {
  const ui = useUiStore.getState();
  if (ui.sidebarTab !== 'services' || ui.serviceSettingsServiceId) {
    ui.setServiceSettingsServiceId(null);
    ui.setSidebarTab('services');
  }
  useScriptFileStore.getState().setActiveFile(null);
  // Let the request workspace render before focusing.
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('[data-request-url-input]');
    input?.focus();
    input?.select();
  });
}

export function openRequestInWorkspace(id: string) {
  const ui = useUiStore.getState();
  ui.setServiceSettingsServiceId(null);
  ui.setSidebarTab('services');
  useScriptFileStore.getState().setActiveFile(null);
  void useRequestStore.getState().selectRequest(id);
}
