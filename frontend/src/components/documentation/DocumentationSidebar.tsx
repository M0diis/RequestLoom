import { useUiStore, type DocumentationSection } from '../../stores/uiStore';

const SECTIONS: Array<{ id: DocumentationSection; label: string; description: string }> = [
  { id: 'overview', label: 'Overview', description: 'Start here' },
  { id: 'http', label: 'HTTP reference', description: 'Methods & status codes' },
  { id: 'requestloom', label: 'How RequestLoom works', description: 'The app in one flow' },
  { id: 'automation', label: 'Automation', description: 'Variables & workflows' },
  { id: 'mock-servers', label: 'Mock servers', description: 'Local endpoints & responses' },
  { id: 'scripting', label: 'Scripts & tests', description: 'Execution and API reference' },
  { id: 'storage', label: 'Storage & backups', description: 'SQLite, JSON & migration' },
  { id: 'imports', label: 'Import & export', description: 'Formats and workflows' },
];

function SectionIcon({ section }: { section: DocumentationSection }) {
  const props = {
    className: 'h-4 w-4 flex-shrink-0 mt-2',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (section) {
    case 'overview':
      return <svg {...props}><path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5v-13z" /><path d="M8 8h8M8 12h5M8 16h8" /></svg>;
    case 'http':
      return <svg {...props}><path d="M4 7h16M4 12h16M4 17h16" /><path d="M7 4v16M17 4v16" /></svg>;
    case 'requestloom':
      return <svg {...props}><circle cx="12" cy="12" r="8.5" /><path d="M8 12h8M12 8v8" /><path d="M16.5 5.5l2-2M18.5 18.5l2 2M5.5 5.5l-2-2M5.5 18.5l-2 2" /></svg>;
    case 'automation':
      return <svg {...props}><path d="M8 4h8M9 2h6v4H9zM6 6h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2z" /><path d="M8 11h8M8 15h5" /></svg>;
    case 'mock-servers':
      return <svg {...props}><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h5M8 17h3" /></svg>;
    case 'scripting':
      return <svg {...props}><path d="M7 5l-4 7 4 7M17 5l4 7-4 7M14 3l-4 18" /></svg>;
    case 'storage':
      return <svg {...props}><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" /></svg>;
    case 'imports':
      return <svg {...props}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>;
  }
}

export function DocumentationSidebar() {
  const { docsSection, setDocsSection } = useUiStore();

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-gray-800/80 px-3 py-3">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
          <span className="h-1.5 w-1.5 bg-[#ff6c37]" />
          Docs
        </div>
        <p className="mt-2 text-[11px] leading-4 text-gray-500">HTTP, workflows, mocks, storage, and interchange in one place.</p>
      </div>

      <nav className="space-y-0.5 p-2" aria-label="Documentation sections">
        {SECTIONS.map((section) => {
          const active = docsSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setDocsSection(section.id)}
              className={`group flex w-full items-start gap-2 border-l-2 px-2 py-2 text-left transition-colors ${active ? 'border-[#ff6c37] bg-gray-900 text-gray-100' : 'border-transparent text-gray-400 hover:bg-gray-900/70 hover:text-gray-200'}`}
            >
              <SectionIcon section={section.id} />
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium">{section.label}</span>
                <span className="mt-0.5 block truncate text-[10px] text-gray-600 group-hover:text-gray-500">{section.description}</span>
              </span>
            </button>
          );
        })}
      </nav>

    </div>
  );
}
