'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TilesConfig } from '@/lib/campus/photoreal';
import { connectionMessage, readVisitorToken, removeVisitorToken, saveVisitorToken, usesVisitorToken, validateVisitorToken } from '@/lib/campus/visitor-cesium';
import { guestSession, type GuestSession } from '@/lib/campus/guest-session';
import { campusAccess } from '@/lib/campus/campus-access';

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
  const [manual, setManual] = useState(false);
  const request = useRef<AbortController | null>(null);

  function acceptGuest(session: GuestSession) {
    setGuest(session);
    if (session.status === 'active' && session.config) {
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
      const access = await campusAccess(controller.signal);
      if (controller.signal.aborted) return;
      setSaved(access.saved); setGuest(access.session);
      if (access.config) { setConfig(access.config); setState('connected'); }
      else { setConfig(undefined); setState('setup'); }
    })();
    return () => request.current?.abort();
  }, []);


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
    if (!controller.signal.aborted) { setManual(false); acceptGuest(session); setBusy(false); }
  }
  function remove() {
    request.current?.abort();
    try { removeVisitorToken(); setSaved(false); setConfig(undefined); setValue(''); setError(''); setBusy(false); }
    catch (e) { setError(connectionMessage(e)); }
  }
  if (state === 'local') return children();
  if (state === 'connected') return <>
    {children(config)}
    <button className="imagery-settings" onClick={() => { setManual(true); setState('setup'); setError(''); }}>Imagery settings</button>
  </>;
  return <main className="connection-shell">
    <section className="connection-card" aria-labelledby="connection-title">
      <span className="eyebrow">UT AUSTIN · CAMPUS EXPLORER</span>
      <h1 id="connection-title">{state === 'loading' ? 'Connecting to campus…' : manual ? 'Imagery settings' : guest?.status === 'quota' ? 'Shared imagery limit reached' : 'Campus imagery is temporarily unavailable'}</h1>
      {state === 'loading' ? <output>Getting your campus access ready.</output> : <>
        <p>{manual ? 'Shared imagery is available automatically. You can optionally use your own Cesium ion token.' : guest?.status === 'quota' ? 'The shared imagery provider is limiting requests or its allowance is exhausted. Retry later, or connect your own Cesium ion token to keep exploring.' : 'We could not connect to shared campus imagery. Try again in a moment; you do not need to create a Cesium account.'}</p>
        {(manual || guest?.status === 'quota') && <>
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
        </>}
        <div className="connection-secondary">
          {(guest?.status === 'unavailable' || guest?.status === 'quota') && <button type="button" onClick={() => void retryGuest()} disabled={busy}>Retry campus imagery</button>}
          {saved && !config && <button type="button" onClick={() => void connect(undefined, true)} disabled={busy}>Retry saved token</button>}
          {saved && <button type="button" onClick={remove} disabled={busy}>Remove saved token</button>}
          {config && <button type="button" onClick={() => { setValue(''); setError(''); setState('connected'); }} disabled={busy}>Back to campus</button>}
          <Link href="/character">View your character</Link>
        </div>
      </>}
    </section>
  </main>;
}
