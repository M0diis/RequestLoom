import { useEffect, useRef, useState } from 'react';

function readCallbackParams() {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const get = (key: string) => search.get(key) ?? hash.get(key) ?? undefined;
  return {
    code: get('code'),
    state: get('state'),
    error: get('error'),
    errorDescription: get('error_description'),
  };
}

export function OAuthCallbackPage() {
  const [message, setMessage] = useState('Completing authorization…');
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;

    const callback = readCallbackParams();
    if (!window.opener || window.opener === window) {
      setMessage('OAuth callback received. Return to the RequestLoom window.');
      return;
    }

    window.opener.postMessage(
      { type: 'requestloom-oauth-callback', ...callback },
      window.location.origin,
    );
    setMessage(callback.error ? 'Authorization was cancelled. You can close this window.' : 'Authorization received. You can close this window.');
    window.setTimeout(() => window.close(), 500);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0d0d0d] px-4 text-sm text-gray-300">
      <div className="border border-gray-700 bg-[#141414] px-5 py-4 text-center shadow-xl">
        <div>{message}</div>
        <button type="button" onClick={() => window.close()} className="mt-3 border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:bg-gray-800">
          Close
        </button>
      </div>
    </div>
  );
}
