import { useState, useRef, useMemo } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useRequestStore } from '../../stores/requestStore';
import { exportImportApi } from '../../services/api';
import type { WorkspaceExport } from '../../types';
import { DocumentationLink, DocHelpButton } from '../documentation/DocumentationLink';

interface Props {
  onClose: () => void;
  workspaceId: string;
}

type Tab = 'export' | 'import';
type ExportScope = 'workspace' | 'service' | 'request';

const INPUT_CLASS = 'w-full border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 outline-none focus:border-gray-500';
const LABEL_CLASS = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const BTN_PRIMARY = 'border border-[#ff6c37] bg-[#ff6c37] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#f95e26] disabled:opacity-50';
const BTN_SECONDARY = 'border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50';
const TAB_CLASS = (active: boolean) =>
  `px-4 py-2 text-xs font-medium transition-colors ${
    active
      ? 'border-b-2 border-[#ff6c37] text-[#ffbca3]'
      : 'text-gray-500 hover:text-gray-300'
  }`;

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportImportModal({ onClose, workspaceId }: Props) {
  const { workspaces } = useWorkspaceStore();
  const { services } = useRequestStore();

  const [tab, setTab] = useState<Tab>('export');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Export state
  const [exportScope, setExportScope] = useState<ExportScope>('workspace');
  const [exportServiceId, setExportServiceId] = useState('');
  const [exportRequestId, setExportRequestId] = useState('');

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<WorkspaceExport | null>(null);
  const [importTarget, setImportTarget] = useState<'new' | 'current'>('current');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const workspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId),
    [workspaces, workspaceId]
  );

  const selectedService = useMemo(
    () => services.find((s) => s.id === exportServiceId),
    [services, exportServiceId]
  );

  const selectedRequest = useMemo(() => {
    if (!exportRequestId) return null;
    for (const svc of services) {
      const found = svc.requests.find((r) => r.id === exportRequestId);
      if (found) return found;
    }
    return null;
  }, [services, exportRequestId]);

  // When scope changes, reset sub-selections
  const changeScope = (scope: ExportScope) => {
    setExportScope(scope);
    setExportServiceId('');
    setExportRequestId('');
  };

  const requestsForService = useMemo(() => {
    if (!exportServiceId) return [];
    return services.find((s) => s.id === exportServiceId)?.requests ?? [];
  }, [services, exportServiceId]);

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      if (exportScope === 'workspace') {
        const data = await exportImportApi.export(workspaceId);
        const safeName = (workspace?.name ?? 'workspace').replace(/[^a-zA-Z0-9_-]/g, '_');
        downloadJson(data, `RequestLoom-${safeName}-${new Date().toISOString().slice(0, 10)}.json`);
      } else if (exportScope === 'service') {
        if (!exportServiceId) {
          setError('Please select a service to export');
          return;
        }
        const data = await exportImportApi.exportService(exportServiceId);
        const safeName = (selectedService?.name ?? 'service').replace(/[^a-zA-Z0-9_-]/g, '_');
        downloadJson(data, `RequestLoom-service-${safeName}-${new Date().toISOString().slice(0, 10)}.json`);
      } else if (exportScope === 'request') {
        if (!exportRequestId) {
          setError('Please select a request to export');
          return;
        }
        const data = await exportImportApi.exportRequest(exportRequestId);
        const safeName = (selectedRequest?.name ?? 'request').replace(/[^a-zA-Z0-9_-]/g, '_');
        downloadJson(data, `RequestLoom-request-${safeName}-${new Date().toISOString().slice(0, 10)}.json`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

    const handleFilePick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    setError(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text) as WorkspaceExport;

      if (!data.services && !data.environments) {
        setError('Invalid file: missing services or environments data');
        setImportPreview(null);
        return;
      }

      // If it looks like a single ServiceExport (has requests but no environments/workspaceVariables)
      // wrap it as a workspace export
      if (!data.environments && !data.workspaceVariables && data.services) {
        setImportPreview(data);
      } else {
        setImportPreview(data);
      }
    } catch {
      setError('Invalid JSON file');
      setImportPreview(null);
    }
  };

  const handleImport = async () => {
    if (!importPreview) return;

    setBusy(true);
    setError(null);
    try {
      if (importTarget === 'new') {
        await exportImportApi.import(importPreview);
        window.location.reload();
      } else {
        await exportImportApi.importInto(workspaceId, importPreview);
        onClose();
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  // Compute preview summary
  const previewSummary = useMemo(() => {
    if (!importPreview) return null;
    const svcCount = importPreview.services?.length ?? 0;
    const envCount = importPreview.environments?.length ?? 0;
    const varCount = importPreview.workspaceVariables?.length ?? 0;
    let reqCount = 0;
    for (const svc of importPreview.services ?? []) {
      reqCount += svc.requests?.length ?? 0;
    }
    return { svcCount, envCount, varCount, reqCount };
  }, [importPreview]);

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <div className="w-full max-w-lg border border-gray-700 bg-[#141414] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
        {/* Header with tabs */}
        <div className="flex items-center border-b border-gray-800">
          <button
            className={TAB_CLASS(tab === 'export')}
            onClick={() => { setTab('export'); setError(null); }}
          >
            Export
          </button>
          <button
            className={TAB_CLASS(tab === 'import')}
            onClick={() => { setTab('import'); setError(null); }}
          >
            Import
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
            <DocumentationLink section="imports" onNavigate={onClose} />
            <DocHelpButton section="imports" onNavigate={onClose} />
          </div>
          <button
            onClick={onClose}
            className="px-3 py-2 text-gray-500 hover:text-gray-300"
            title="Close"
            disabled={busy}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-4">
          {tab === 'export' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">Choose what to export as a JSON file.</p>

              {/* Scope selector */}
              <div>
                <label className={LABEL_CLASS}>Scope</label>
                <div className="flex gap-1">
                  {([
                    ['workspace', 'Entire Workspace'],
                    ['service', 'Service'],
                    ['request', 'Request'],
                  ] as [ExportScope, string][]).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => changeScope(value)}
                      className={`border px-3 py-1.5 text-xs transition-colors ${
                        exportScope === value
                          ? 'border-[#ff6c37]/60 bg-[#ff6c37]/10 text-[#ffbca3]'
                          : 'border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Service selector */}
              {exportScope === 'service' && (
                <div>
                  <label className={LABEL_CLASS}>Service</label>
                  <select
                    value={exportServiceId}
                    onChange={(e) => setExportServiceId(e.target.value)}
                    className={INPUT_CLASS}
                  >
                    <option value="">Select a service...</option>
                    {services.map((svc) => (
                      <option key={svc.id} value={svc.id}>{svc.name}</option>
                    ))}
                  </select>
                  {exportServiceId && selectedService && (
                    <p className="mt-1 text-[11px] text-gray-500">
                      {selectedService.requests.length} request(s) will be exported
                    </p>
                  )}
                </div>
              )}

              {/* Request selector */}
              {exportScope === 'request' && (
                <div>
                  <label className={LABEL_CLASS}>Service</label>
                  <select
                    value={exportServiceId}
                    onChange={(e) => {
                      setExportServiceId(e.target.value);
                      setExportRequestId('');
                    }}
                    className={INPUT_CLASS}
                  >
                    <option value="">Select a service first...</option>
                    {services.map((svc) => (
                      <option key={svc.id} value={svc.id}>{svc.name}</option>
                    ))}
                  </select>
                  {exportServiceId && (
                    <>
                      <label className={`${LABEL_CLASS} mt-3`}>Request</label>
                      <select
                        value={exportRequestId}
                        onChange={(e) => setExportRequestId(e.target.value)}
                        className={INPUT_CLASS}
                      >
                        <option value="">Select a request...</option>
                        {requestsForService.map((req) => (
                          <option key={req.id} value={req.id}>
                            {req.method} {req.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              )}

              {/* Summary for workspace */}
              {exportScope === 'workspace' && (
                <p className="text-[11px] text-gray-500">
                  {services.length} service(s), all environments, variables, and history will be exported.
                </p>
              )}
            </div>
          )}

          {tab === 'import' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Import a previously exported JSON file.
              </p>

              {/* File picker */}
              <div>
                <label className={LABEL_CLASS}>File</label>
                <button
                  onClick={handleFilePick}
                  className={`${BTN_SECONDARY} w-full text-left`}
                  disabled={busy}
                >
                  {importFile ? importFile.name : 'Choose JSON file...'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => { void handleFileChange(e); }}
                />
              </div>

              {/* Preview */}
              {importPreview && previewSummary && (
                <div className="rounded border border-gray-700 bg-gray-900/50 p-3">
                  <h4 className="mb-2 text-xs font-semibold text-gray-300">Preview</h4>
                  <div className="space-y-1 text-[11px] text-gray-400">
                    {importPreview.name && (
                      <div>Name: <span className="text-gray-200">{importPreview.name}</span></div>
                    )}
                    <div>{previewSummary.svcCount} service(s)</div>
                    <div>{previewSummary.reqCount} request(s)</div>
                    <div>{previewSummary.envCount} environment(s)</div>
                    <div>{previewSummary.varCount} global variable(s)</div>
                  </div>

                  {/* Target selector */}
                  <div className="mt-3">
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      Import as
                    </label>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setImportTarget('current')}
                        className={`border px-3 py-1.5 text-xs transition-colors ${
                          importTarget === 'current'
                            ? 'border-[#ff6c37]/60 bg-[#ff6c37]/10 text-[#ffbca3]'
                            : 'border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800'
                        }`}
                      >
                        Merge into current
                      </button>
                      <button
                        onClick={() => setImportTarget('new')}
                        className={`border px-3 py-1.5 text-xs transition-colors ${
                          importTarget === 'new'
                            ? 'border-[#ff6c37]/60 bg-[#ff6c37]/10 text-[#ffbca3]'
                            : 'border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800'
                        }`}
                      >
                        New workspace
                      </button>
                    </div>
                    {importTarget === 'current' && (
                      <p className="mt-1 text-[11px] text-gray-500">
                        Services will be added to "{workspace?.name ?? 'current'}" workspace
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 rounded border border-rose-900/60 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-800 bg-[#1a1a1a] px-4 py-3">
          <button
            onClick={onClose}
            className={BTN_SECONDARY}
            disabled={busy}
          >
            Cancel
          </button>
          {tab === 'export' && (
            <button
              onClick={() => { void handleExport(); }}
              className={BTN_PRIMARY}
              disabled={busy}
            >
              {busy ? 'Exporting...' : 'Export'}
            </button>
          )}
          {tab === 'import' && (
            <button
              onClick={() => { void handleImport(); }}
              className={BTN_PRIMARY}
              disabled={busy || !importPreview}
            >
              {busy ? 'Importing...' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
