import type { ReactNode } from 'react';
import { useUiStore, type DocumentationSection } from '../../stores/uiStore';

interface DocumentationLinkProps {
  section: DocumentationSection;
  children?: ReactNode;
  className?: string;
  title?: string;
  onNavigate?: () => void;
  ariaLabel?: string;
}

export function DocumentationLink({ section, children = 'Open in docs', className = '', title = 'Open related documentation', onNavigate, ariaLabel }: DocumentationLinkProps) {
  const setSidebarTab = useUiStore((state) => state.setSidebarTab);
  const setDocsSection = useUiStore((state) => state.setDocsSection);

  const openDocs = () => {
    onNavigate?.();
    setDocsSection(section);
    setSidebarTab('docs');
  };

  return (
    <button
      type="button"
      onClick={openDocs}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 transition-colors hover:text-[#ffbca3] ${className}`}
    >
      {children}
    </button>
  );
}

export function DocHelpButton({ section, title = 'Open related documentation', onNavigate }: Omit<DocumentationLinkProps, 'children'>) {
  return (
    <DocumentationLink
      section={section}
      title={title}
      onNavigate={onNavigate}
      ariaLabel={title}
      className="h-4 w-4 justify-center rounded-full border border-gray-700 text-[10px] normal-case tracking-normal text-gray-500 hover:border-gray-500 hover:bg-gray-800"
    >
      <span aria-hidden="true">?</span>
    </DocumentationLink>
  );
}
