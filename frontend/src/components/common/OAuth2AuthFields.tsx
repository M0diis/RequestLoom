import { useEffect, useRef, useState } from 'react';
import { oauthApi } from '../../services/api';
import type { OAuth2Configuration, OAuthTokenStatus } from '../../types';
import { DocHelpButton } from '../documentation/DocumentationLink';

interface Props {
  config: Record<string, string>;
  onChange: (config: Record<string, string>) => void;
  ownerKey: string;
}

interface PendingAuthorization {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  configuration: OAuth2Configuration;
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

const DEFAULT_SCOPE = 'openid profile email';

function randomUrlSafeString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getRedirectUri(config: Record<string, string>): string {
  return config.redirectUri?.trim() || (window.location.origin + '/oauth/callback');
}

function toConfiguration(config: Record<string, string>): OAuth2Configuration {
  return {
    authorizationUrl: config.authorizationUrl?.trim() ?? '',
    tokenUrl: config.tokenUrl?.trim() ?? '',
    issuer: config.issuer?.trim() ?? '',
    clientId: config.clientId?.trim() ?? '',
    clientSecret: config.clientSecret ?? '',
    scope: config.scope?.trim() || DEFAULT_SCOPE,
    redirectUri: getRedirectUri(config),
    audience: config.audience?.trim() ?? '',
    clientAuthenticationMethod: config.clientAuthenticationMethod === 'client_secret_basic'
      ? 'client_secret_basic'
      : 'client_secret_post',
  };
}

function formatExpiry(status: OAuthTokenStatus | null): string {
  if (!status?.expiresAt) return '';
  const date = new Date(status.expiresAt);
  if (Number.isNaN(date.getTime())) return '';
  return 'expires ' + date.toLocaleTimeString();
}

export function OAuth2AuthFields({ config, onChange, ownerKey }: Props) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [status, setStatus] = useState<OAuthTokenStatus | null>(null);
  const [message, setMessage] = useState('');
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const pendingRef = useRef<PendingAuthorization | null>(null);

  useEffect(() => {
    let cancelled = false;
    void oauthApi.status(ownerKey)
      .then((nextStatus) => {
        if (cancelled) return;
        setStatus(nextStatus);
        setConnectionState(nextStatus.connected ? 'connected' : 'idle');
      })
      .catch(() => {
        if (!cancelled) setConnectionState('idle');
      });
    return () => {
      cancelled = true;
    };
  }, [ownerKey]);

  useEffect(() => {
    setConnectionState('idle');
    setStatus(null);
    setMessage('');
  }, [ownerKey, config.authorizationUrl, config.tokenUrl, config.issuer, config.clientId, config.clientSecret, config.scope, config.audience]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        state?: string;
        code?: string;
        error?: string;
        errorDescription?: string;
      } | null;
      const pending = pendingRef.current;

      if (!pending || data?.type !== 'requestloom-oauth-callback' || data.state !== pending.state) return;
      pendingRef.current = null;

      if (data.error || !data.code) {
        setConnectionState('error');
        setMessage(data.errorDescription || data.error || 'OAuth authorization was cancelled.');
        return;
      }

      setConnectionState('connecting');
      setMessage('Exchanging authorization code…');
      void oauthApi.exchangeCode({
        ownerKey,
        code: data.code,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUri,
        configuration: pending.configuration,
      }).then((nextStatus) => {
        setStatus({
          connected: nextStatus.connected,
          expiresAt: nextStatus.expiresAt,
          hasRefreshToken: nextStatus.hasRefreshToken,
        });
        setConnectionState('connected');
        setMessage(nextStatus.hasRefreshToken
          ? 'Connected; refresh token saved in memory. ' + formatExpiry(nextStatus)
          : 'Connected; provider did not return a refresh token. ' + formatExpiry(nextStatus));
      }).catch((error: unknown) => {
        setConnectionState('error');
        setMessage(error instanceof Error ? error.message : 'OAuth token exchange failed.');
      });
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [ownerKey]);

  const update = (field: string, value: string) => {
    onChange({ ...config, [field]: value });
  };

  const discover = async () => {
    if (!config.issuer?.trim()) {
      setMessage('Enter an OIDC issuer URL first.');
      return;
    }

    setDiscoveryBusy(true);
    setMessage('');
    try {
      const discovery = await oauthApi.discover(config.issuer.trim());
      onChange({
        ...config,
        issuer: discovery.issuer,
        authorizationUrl: discovery.authorizationEndpoint,
        tokenUrl: discovery.tokenEndpoint,
        scope: config.scope?.trim() || discovery.scopesSupported.slice(0, 3).join(' ') || DEFAULT_SCOPE,
      });
      setMessage('OIDC endpoints discovered.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'OIDC discovery failed.');
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const connect = async () => {
    const configuration = toConfiguration(config);
    if (!configuration.authorizationUrl) {
      setMessage('Authorization URL is required.');
      return;
    }
    if (!configuration.tokenUrl) {
      setMessage('Token URL is required. Use OIDC discovery or enter it manually.');
      return;
    }
    if (!configuration.clientId) {
      setMessage('Client ID is required.');
      return;
    }

    const state = randomUrlSafeString(32);
    const codeVerifier = randomUrlSafeString(64);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const redirectUri = getRedirectUri(config);
    pendingRef.current = { state, codeVerifier, redirectUri, configuration };
    setConnectionState('connecting');
    setMessage('Waiting for provider authorization…');

    const authorizationUrl = new URL(configuration.authorizationUrl);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', configuration.clientId);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('scope', configuration.scope);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    if (configuration.audience) authorizationUrl.searchParams.set('audience', configuration.audience);
    if (configuration.issuer && configuration.scope.split(/\s+/).includes('openid')) {
      authorizationUrl.searchParams.set('nonce', randomUrlSafeString(32));
    }

    const popup = window.open(
      authorizationUrl.toString(),
      'requestloom-oauth',
      'popup,width=620,height=760,resizable=yes,scrollbars=yes',
    );
    if (!popup) {
      pendingRef.current = null;
      setConnectionState('error');
      setMessage('The authorization popup was blocked. Allow popups and try again.');
    }
  };

  const disconnect = async () => {
    try {
      await oauthApi.disconnect(ownerKey);
      setStatus(null);
      setConnectionState('idle');
      setMessage('Disconnected.');
    } catch (error: unknown) {
      setConnectionState('error');
      setMessage(error instanceof Error ? error.message : 'Could not disconnect OAuth.');
    }
  };

  const inputClass = 'w-full border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-gray-100 outline-none focus:border-gray-500';
  const labelClass = 'mb-1 block text-[11px] text-gray-500';
  const messageClass = connectionState === 'error' ? 'text-[11px] text-rose-400' : 'text-[11px] text-gray-500';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <input
            className={inputClass}
            placeholder="OIDC issuer (optional)"
            value={config.issuer ?? ''}
            onChange={(event) => update('issuer', event.target.value)}
            aria-label="OIDC issuer"
          />
          <DocHelpButton section="http" title="Open OAuth2 and authentication documentation" />
        </div>
        <button
          type="button"
          onClick={() => { void discover(); }}
          disabled={discoveryBusy}
          className="shrink-0 border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          {discoveryBusy ? 'Discovering…' : 'Discover OIDC'}
        </button>
      </div>

      <div>
        <label className={labelClass}>Authorization URL</label>
        <input className={inputClass} value={config.authorizationUrl ?? ''} onChange={(event) => update('authorizationUrl', event.target.value)} placeholder="https://idp.example.com/authorize" />
      </div>
      <div>
        <label className={labelClass}>Token URL</label>
        <input className={inputClass} value={config.tokenUrl ?? ''} onChange={(event) => update('tokenUrl', event.target.value)} placeholder="https://idp.example.com/oauth/token" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Client ID</label>
          <input className={inputClass} value={config.clientId ?? ''} onChange={(event) => update('clientId', event.target.value)} placeholder="public-client-id" />
        </div>
        <div>
          <label className={labelClass}>Client secret (optional)</label>
          <input className={inputClass} type="password" autoComplete="new-password" value={config.clientSecret ?? ''} onChange={(event) => update('clientSecret', event.target.value)} placeholder="Leave blank for public clients" />
        </div>
      </div>
      <div>
        <label className={labelClass}>Scopes</label>
        <input className={inputClass} value={config.scope ?? DEFAULT_SCOPE} onChange={(event) => update('scope', event.target.value)} placeholder="openid profile email" />
      </div>
      <div>
        <label className={labelClass}>Redirect URI</label>
        <input className={inputClass} value={config.redirectUri ?? ''} onChange={(event) => update('redirectUri', event.target.value)} placeholder={window.location.origin + '/oauth/callback'} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Audience (optional)</label>
          <input className={inputClass} value={config.audience ?? ''} onChange={(event) => update('audience', event.target.value)} placeholder="https://api.example.com" />
        </div>
        <div>
          <label className={labelClass}>Token client authentication</label>
          <select className={inputClass} value={config.clientAuthenticationMethod ?? 'client_secret_post'} onChange={(event) => update('clientAuthenticationMethod', event.target.value)}>
            <option value="client_secret_post">Client secret in body</option>
            <option value="client_secret_basic">Client secret as Basic auth</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { void connect(); }}
          disabled={connectionState === 'connecting'}
          className="border border-[#ff6c37] bg-[#ff6c37] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#f95e26] disabled:opacity-50"
        >
          {connectionState === 'connecting' ? 'Connecting…' : 'Connect with OAuth2'}
        </button>
        {connectionState === 'connected' && (
          <button type="button" onClick={() => { void disconnect(); }} className="border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">
            Disconnect
          </button>
        )}
        {connectionState === 'connected' && (
          <span className="text-[11px] text-emerald-400">
            Connected {formatExpiry(status)}
          </span>
        )}
      </div>
      {message && <p className={messageClass}>{message}</p>}
      <p className="text-[11px] text-gray-500">
        PKCE S256 is used for every authorization. Access and refresh tokens stay in the backend memory cache and refresh automatically before requests.
      </p>
    </div>
  );
}
