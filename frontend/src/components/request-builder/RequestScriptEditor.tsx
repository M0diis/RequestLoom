import { useEffect, useMemo, useState } from 'react';
import { CodeEditor } from '../common/CodeEditor';
import { ScriptHelpModal } from '../common/ScriptHelpModal';
import type { ApiRequest } from '../../types';

interface Props {
  request: ApiRequest;
  onUpdate: (id: string, data: Partial<ApiRequest>) => Promise<void>;
  stage: 'pre' | 'post' | 'test';
}

const PRE_REQUEST_HELP = [
  'Pre-request script runs before variable resolution and sending.',
  'Use setVar("key", "value") to create request-scoped runtime variables.',
  'Resolved variables are available through vars; setBody(object) serializes JSON and changes the body type to JSON.',
  'Use setHeader / removeHeader / setParam / removeParam to shape the outgoing call.',
  'You can also use setUrl, setMethod, setBody, getVar and log.',
].join(' ');

const POST_REQUEST_HELP = [
  'Post-request script runs after response is received.',
  'Use getResponseStatus(), getResponseBody(), getResponseHeader(name).',
  'Use setVar("key", "value") to store runtime variables for the next execution of this request.',
].join(' ');

const TEST_HELP = [
  'Test script runs after post-request script with assertions.',
].join('\n');

export function RequestScriptEditor({ request, onUpdate, stage }: Props) {
  const field = stage === 'pre' ? 'preRequestScript' : stage === 'post' ? 'postRequestScript' : 'testScript';
  const scriptValue = stage === 'pre' ? request.preRequestScript : stage === 'post' ? request.postRequestScript : request.testScript;
  const editorScopeKey = useMemo(() => `${request.id}:${stage}`, [request.id, stage]);
  const [draft, setDraft] = useState(scriptValue ?? '');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setDraft(scriptValue ?? '');
  }, [editorScopeKey]);

  const handleChange = (value: string) => {
    setDraft(value);
    void onUpdate(request.id, {
      [field]: value,
    } as Partial<ApiRequest>);
  };

  return (
    <div className="flex h-full min-h-[260px] flex-col gap-2">
      <div className={`border px-2.5 py-2 text-[11px] flex items-start gap-2 ${stage === 'pre'
        ? 'border-sky-900/60 bg-sky-950/20 text-sky-200'
        : stage === 'post'
        ? 'border-violet-900/60 bg-violet-950/20 text-violet-200'
        : 'border-emerald-900/60 bg-emerald-950/20 text-emerald-200'}`}>
        <span className="flex-1">{stage === 'pre' ? PRE_REQUEST_HELP : stage === 'post' ? POST_REQUEST_HELP : TEST_HELP}</span>
        <button
          onClick={() => setShowHelp(true)}
          className="flex-shrink-0 rounded-full border border-gray-600 px-1.5 text-[11px] text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          title="Script help"
        >
          ?
        </button>
      </div>

      <div className="min-h-[220px] flex-1 overflow-hidden border border-gray-800 bg-gray-950/70">
        <CodeEditor
          language="javascript"
          value={draft}
          onChange={handleChange}
        />
      </div>

      {showHelp && (
        <ScriptHelpModal
          onClose={() => setShowHelp(false)}
          initialTab={stage === 'test' ? 'test' : stage}
        />
      )}
    </div>
  );
}
