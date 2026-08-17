import { lazy, Suspense, useEffect, useState } from 'react';
import { useUiStore } from '../../stores/uiStore';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

function EditorLoadingState({ className = '' }: { className?: string }) {
  return (
    <div className={`flex h-full w-full items-center px-3 text-xs text-gray-400 ${className}`}>
      Loading editor...
    </div>
  );
}

interface Props {
  value: string;
  language: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}

export function CodeEditor({
  value,
  language,
  readOnly = false,
  onChange,
  className = '',
}: Props) {
  const { darkMode } = useUiStore();
  const [editorReady, setEditorReady] = useState(false);

  useEffect(() => {
    let disposed = false;

    const setupEditor = async () => {
      const { ensureMonacoConfigured } = await import('../../lib/monaco');
      await ensureMonacoConfigured();

      if (!disposed) {
        setEditorReady(true);
      }
    };

    void setupEditor();

    return () => {
      disposed = true;
    };
  }, []);

  if (!editorReady) {
    return <EditorLoadingState className={className} />;
  }

  return (
    <Suspense fallback={<EditorLoadingState className={className} />}>
      <MonacoEditor
        height="100%"
        language={language}
        value={value}
        onChange={(next) => onChange?.(next ?? '')}
        loading={<EditorLoadingState className={className} />}
        theme={darkMode ? 'vs-dark' : 'light'}
        className={className}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          automaticLayout: true,
        }}
      />
    </Suspense>
  );
}
