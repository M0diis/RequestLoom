import { useCallback, useRef, type ReactNode } from 'react';
import { useUiStore } from '../stores/uiStore';
import { TopBar } from '../components/common/TopBar';

interface MainLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export function MainLayout({ sidebar, main }: MainLayoutProps) {
  const { sidebarWidth, setSidebarWidth, darkMode } = useUiStore();
  const isResizing = useRef(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(160, Math.min(500, e.clientX));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [setSidebarWidth]);

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="flex h-screen flex-col bg-[#0d0d0d] text-gray-200">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <div
            className="flex-shrink-0 overflow-y-auto overflow-x-hidden border-r border-gray-800 bg-[#111111] max-md:max-w-[180px]"
            style={{ width: sidebarWidth }}
          >
            {sidebar}
          </div>
          <div className="resize-handle" onMouseDown={startResize} />
          <div className="flex-1 overflow-hidden flex flex-col">
            {main}
          </div>
        </div>
      </div>
    </div>
  );
}
