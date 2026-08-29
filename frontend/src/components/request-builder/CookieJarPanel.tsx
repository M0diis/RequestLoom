import { useEffect, useState } from 'react';
import { cookiesApi } from '../../services/api';
import type { CookieJarEntry } from '../../types';

interface CookieJarPanelProps {
  workspaceId: string;
}

export default function CookieJarPanel({ workspaceId }: CookieJarPanelProps) {
  const [cookies, setCookies] = useState<CookieJarEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void cookiesApi
      .list(workspaceId)
      .then((entries) => {
        if (!cancelled) setCookies(entries);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the workspace cookie jar.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const clearCookies = async () => {
    setClearing(true);
    setError('');
    try {
      await cookiesApi.clear(workspaceId);
      setCookies([]);
    } catch {
      setError('Could not clear the workspace cookie jar.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-gray-200">Persistent cookie jar</h3>
          <p className="mt-1 text-[11px] text-gray-500">
            Response cookies can be reused for this workspace and survive backend restarts. Toggle persistence in Settings → Requests.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void clearCookies(); }}
          disabled={clearing || cookies.length === 0}
          className="border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800 disabled:cursor-default disabled:opacity-50"
        >
          {clearing ? 'Clearing…' : 'Clear workspace cookies'}
        </button>
      </div>
      {loading && <p className="mt-3 text-[11px] text-gray-500">Loading cookie jar…</p>}
      {!loading && cookies.length === 0 && (
        <p className="mt-3 text-[11px] text-gray-500">No cookies stored.</p>
      )}
      {!loading && cookies.length > 0 && (
        <div className="mt-3 overflow-x-auto border border-gray-800">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-[#1a1a1a] text-gray-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">Name</th>
                <th className="px-2 py-1.5 font-medium">Domain</th>
                <th className="px-2 py-1.5 font-medium">Path</th>
                <th className="px-2 py-1.5 font-medium">Expiry</th>
              </tr>
            </thead>
            <tbody>
              {cookies.map((cookie) => (
                <tr key={cookie.domain + cookie.path + cookie.name} className="border-t border-gray-800 text-gray-400">
                  <td className="px-2 py-1.5 font-mono text-gray-300">{cookie.name}</td>
                  <td className="px-2 py-1.5">{cookie.domain}</td>
                  <td className="px-2 py-1.5">{cookie.path}</td>
                  <td className="px-2 py-1.5">{cookie.expiresAt ? new Date(cookie.expiresAt).toLocaleString() : 'Session'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
    </section>
  );
}
