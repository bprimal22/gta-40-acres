'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TilesConfig } from '@/lib/campus/photoreal';
import { connectionMessage, readVisitorToken, removeVisitorToken, saveVisitorToken, usesVisitorToken, validateVisitorToken } from '@/lib/campus/visitor-cesium';
import { guestSession, type GuestSession } from '@/lib/campus/guest-session';

type State = 'loading' | 'setup' | 'connected' | 'local';
export function CesiumConnection({ children }: { children: (config?: TilesConfig) => ReactNode }) {
  const [state, setState] = useState<State>('loading');
  const [config, setConfig] = useState<TilesConfig>();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');
  const [saved, setSaved] = useState(false);
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const deadline = useRef(0);
  const request = useRef<AbortController | null>(null);

  function acceptGuest(session: GuestSession) {
    setGuest(session);
    if (session.status === 'active' && session.config) {
      deadline.current = performance.now() + session.expiresAt! - session.serverNow!;
      setConfig(session.config); setState('connected');
    } else {
      setConfig(undefined); setState('setup');
    }
  }
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    void (async () => {
      // Read browser-only storage after hydration, with an abortable lifetime.
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setOrigin(location.origin);
      const query = new URLSearchParams(location.search);
      const offline = query.get('offline') === '1' || ['local', 'procedural'].includes(query.get('visual') ?? '');
      if (offline || !usesVisitorToken()) { setState('local'); return; }
      try {
        const token = readVisitorToken(); setSaved(!!token);
        if (!token) {
          const session = await guestSession(true, controller.signal);
          if (!controller.signal.aborted) acceptGuest(session);
          return;
        }
        const validated = await validateVisitorToken(token, controller.signal);
        if (controller.signal.aborted) return;
        // Rendering only needs the temporary Google endpoint; keep the visitor
        // token out of the long-lived game instance.
        setConfig({ ...validated, token: '' }); setState('connected');
      } catch (e) {
        if (!controller.signal.aborted) { setError(connectionMessage(e)); setState('setup'); }
      }
    })();
    return () => request.current?.abort();
  }, []);

  useEffect(() => {
    if (guest?.status !== 'active') return;
    const controller = new AbortController();
    const expire = () => {
      request.current?.abort(); setBusy(false); setConfig(undefined);
      setGuest({ status: 'expired' }); setState('setup'); setError('');
    };
    const timer = setTimeout(expire, Math.max(0, deadline.current - performance.now()));
    // Suspended/background tabs can miss timers. Recheck against server time on
    // return, without downloading a new root tile or extending the trial.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (performance.now() >= deadline.current) { expire(); return; }
      void guestSession(false, controller.signal).then(session => {
        if (controller.signal.aborted) return;
        if (session.status !== 'active') {
          request.current?.abort(); setBusy(false); setConfig(undefined); setGuest(session); setState('setup');
        }
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); controller.abort(); document.removeEventListener('visibilitychange', onVisible); };
  }, [guest]);

  async function connect(event?: React.SubmitEvent<HTMLFormElement>, retrySaved = false) {
    event?.preventDefault(); if (busy) return;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    setBusy(true); setError('');
    try {
      const validated = await validateVisitorToken(retrySaved ? readVisitorToken() ?? '' : value, controller.signal);
      if (controller.signal.aborted) return;
      saveVisitorToken(validated.token);
      setGuest(null); setSaved(true); setValue(''); setConfig({ ...validated, token: '' }); setState('connected');
    } catch (e) { if (!controller.signal.aborted) setError(connectionMessage(e)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function retryGuest() {
    if (busy) return;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    setBusy(true); setError('');
    const session = await guestSession(true, controller.signal);
    if (!controller.signal.aborted) { acceptGuest(session); setBusy(false); }
  }
  function remove() {
    request.current?.abort();
    try { removeVisitorToken(); setSaved(false); setConfig(undefined); setValue(''); setError(''); setBusy(false); }
    catch (e) { setError(connectionMessage(e)); }
  }
  if (state === 'local') return children();
  if (state === 'connected') return <>
    {children(config)}
    <button className="imagery-settings" onClick={() => { setState('setup'); setError(''); }}>Imagery settings</button>
    {guest?.status === 'active' && <span className="guest-preview-status">Guest preview · ends {new Date(guest.expiresAt!).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
  </>;
  return <main className="connection-shell">
    <section className="connection-card" aria-labelledby="connection-title">
      <span className="eyebrow">UT AUSTIN · CAMPUS EXPLORER</span>
      <h1 id="connection-title">{state === 'loading' ? 'Connecting to campus…' : guest?.status === 'expired' ? 'Your free preview has ended' : 'Connect campus imagery'}</h1>
      {state === 'loading' ? <output>Getting your campus access ready.</output> : <>
        <p>{guest?.status === 'expired' ? 'Your 24-hour guest preview is over. Connect your own Cesium ion token to keep exploring.' : guest?.status === 'active' ? 'Your guest preview is active for 24 hours from your first visit. You can connect your own token at any time.' : guest?.status === 'unavailable' ? 'The guest preview is temporarily unavailable. Try again, or connect your own Cesium ion token.' : 'Use your own Cesium ion token to explore the photographic campus.'}</p>
        <form onSubmit={connect}>
          <label htmlFor="cesium-token">Cesium ion access token</label>
          <input id="cesium-token" type="password" autoComplete="off" spellCheck={false} value={value}
            onChange={e => setValue(e.target.value)} disabled={busy} required maxLength={8192} />
          <p className="connection-note">Automatically saved in this browser. Your browser sends it directly to Cesium to load scenery; our game server never receives it.</p>
          {error && <p className="connection-error" role="alert">{error}</p>}
          <button className="connection-primary" disabled={busy || !value.trim()} type="submit">
            {busy ? 'Checking access…' : 'Connect and explore'}
          </button>
        </form>
        <details className="connection-help">
          <summary>Get a Cesium token</summary>
          <ol>
            <li>Create a <a href="https://ion.cesium.com/" target="_blank" rel="noreferrer">Cesium ion account</a>. The Community plan has a limited monthly allowance.</li>
            <li>In the Asset Depot, add <strong>Google Photorealistic 3D Tiles</strong> to My Assets (asset 2275207).</li>
            <li>In <a href="https://ion.cesium.com/tokens" target="_blank" rel="noreferrer">Access Tokens</a>, create a token with only <code>assets:read</code> and restrict it to that asset.</li>
            <li>Under Allowed URLs, add this site address: <code className="connection-origin">{origin}</code>Copy the token and paste it above.</li>
          </ol>
          <a href="https://cesium.com/learn/ion/cesium-ion-access-tokens/" target="_blank" rel="noreferrer">Cesium token instructions</a>
          {' · '}<a href="https://ion.cesium.com/usage" target="_blank" rel="noreferrer">Check your usage</a>
        </details>
        <div className="connection-secondary">
          {guest?.status === 'unavailable' && <button type="button" onClick={() => void retryGuest()} disabled={busy}>Retry guest preview</button>}
          {saved && !config && <button type="button" onClick={() => void connect(undefined, true)} disabled={busy}>Retry saved token</button>}
          {saved && <button type="button" onClick={remove} disabled={busy}>Remove saved token</button>}
          {config && <button type="button" onClick={() => { setValue(''); setError(''); setState('connected'); }} disabled={busy}>Back to campus</button>}
          <Link href="/character">View your character</Link>
        </div>
      </>}
    </section>
  </main>;
}
