'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { CampusGame } from '@/lib/campus/game';
import { CesiumConnection } from '@/components/cesium-connection';
import type { TilesConfig } from '@/lib/campus/photoreal';
import type { GameStatus } from '@/lib/campus/types';
export default function Home() {
  return <CesiumConnection>{config => <CampusView tilesConfig={config} />}</CesiumConnection>;
}
function CampusView({ tilesConfig }: { tilesConfig?: TilesConfig }) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<HTMLCanvasElement>(null),
    game = useRef<CampusGame | null>(null);
  const [status, setStatus] = useState<GameStatus>({
      ready: false,
      location: 'Speedway',
      speed: 0,
      fps: 0,
      mode: 'Loading campus',
    }),
    [playing, setPlaying] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let instance: CampusGame | undefined;
    void import('@/lib/campus/game')
      .then(async ({ CampusGame }) => {
        if (cancelled || !host.current || !map.current) return;
        setPlaying(false);
        setStatus({
          ready: false,
          location: 'Speedway',
          speed: 0,
          fps: 0,
          mode: 'Loading campus',
        });
        try {
          instance = new CampusGame(host.current, map.current, setStatus, { tilesConfig });
          game.current = instance;
          await instance.init();
        } catch (e) {
          if (cancelled) return;
          instance?.dispose();
          console.error(e);
          setStatus((s) => ({ ...s, error: String(e) }));
        }
      })
      .catch(() => {
        if (!cancelled)
          setStatus((s) => ({
            ...s,
            error:
              'The game engine could not load. Reload the page to try again.',
          }));
      });
    return () => {
      cancelled = true;
      instance?.dispose();
      if (game.current === instance) game.current = null;
    };
  }, [tilesConfig]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch((error) => {
      // Offline play still works from the local server without a service
      // worker; this only means a later reload cannot use the browser cache.
      console.warn('Offline cache could not be enabled.', error);
    });
  }, []);
  const streamedImagery = status.imagery?.provider.includes('Google') ?? false;
  return (
    <main className="game-shell">
      <div className="game-viewport" ref={host} />
      <header className="location">
        <span className="eyebrow">AUSTIN, TEXAS</span>
        <h1>{status.location}</h1>
        <span className="build-tag">
          {streamedImagery
            ? 'Real campus imagery · Playable development build'
            : status.offline
              ? 'Simplified local campus · Photographic scenery is off'
              : 'Campus study · Work in progress'}
        </span>
        {playing && status.offline && (
          <button
            className="restore-imagery"
            type="button"
            // Rebuild the engine: a client-side route change keeps the offline scene alive.
            onClick={() => window.location.assign('/')}
          >
            Restore photographic scenery
          </button>
        )}
      </header>
      <div className="compass" aria-label="Compass">
        {status.heading ?? '—'}
      </div>
      {!playing && (
        <div className="entry">
          <p className="eyebrow">THE UNIVERSITY OF TEXAS</p>
          <h2>Take a walk.</h2>
          <p>
            {status.offline
              ? 'Explore the local campus on foot or by scooter.'
              : 'Explore campus on foot or by scooter.'}
          </p>
          <a href={status.offline ? '/' : '/?offline=1'} style={{color:'inherit',fontSize:14}}>
            {status.offline ? 'Use photographic campus' : 'Use local-only campus'}
          </a>
          {status.offline && (
            <output className="offline-notice">
              This mode uses simplified buildings. Choose the photographic
              campus above to restore the real scenery with an internet connection.
            </output>
          )}
          <Link href="/character" style={{ color: 'inherit', fontSize: 14 }}>
            View your character
          </Link>
          <Button
            className="enter-button"
            disabled={!status.ready || !!status.error}
            onClick={() => {
              game.current?.play();
              setPlaying(true);
            }}
          >
            {status.error
              ? 'Unable to load campus'
              : status.ready
                ? 'Enter campus'
                : 'Preparing campus…'}
            <span aria-hidden="true">↗</span>
          </Button>
          {status.error && <p className="load-error">{status.error}</p>}
          {!status.ready && status.imagery && !status.error && (
            <p className="load-progress">
              Loading the streets around you · {status.imagery.loaded} tiles
            </p>
          )}
        </div>
      )}
      <aside className={`map-panel${status.mapExpanded ? ' map-expanded' : ''}`} aria-label="Campus travel map">
        <div className="map-toolbar">
          <span>{status.mapExpanded ? 'Choose where to explore' : 'Click to travel'}</span>
          <Button className="map-toggle" variant="ghost" size="sm"
            disabled={!playing || !status.ready || status.traveling}
            aria-expanded={!!status.mapExpanded}
            onClick={() => game.current?.setMapExpanded(!status.mapExpanded)}>
            {status.mapExpanded ? 'Close map' : 'Expand map'}
          </Button>
        </div>
        <div className="minimap">
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Spatial canvas picker supports arrow keys and Enter as well as point clicks. */}
          <canvas role="button"
            width="220"
            height="220"
            ref={map}
            tabIndex={playing ? 0 : -1}
            aria-label="Campus map. Click a spot to travel. Use arrow keys to choose a point and Enter to travel."
          />
          <span className="north">N ↑</span>
        </div>
        <div className="map-caption">
          <span>UT AUSTIN</span>
          <span>{status.traveling ? 'Loading…' : `${Math.round(status.fps)} FPS`}</span>
        </div>
        {status.mapExpanded && <p className="map-help">Click anywhere to start nearby · Arrow keys + Enter also work · Esc to close</p>}
      </aside>
      <footer className={`controls${status.locomotion && status.locomotion !== 'foot' ? ' riding-controls' : ''}`}>
        {status.locomotion && status.locomotion !== 'foot' ? <>
          <span><kbd>W</kbd> Ride</span>
          <span><kbd>A / D</kbd> Steer</span>
          <span><kbd>S / SPACE</kbd> Brake</span>
          <span><kbd>F</kbd> Get off</span>
          <span>Scooter · {Math.round((status.scooterSpeed ?? 0)*2.23694)} mph</span>
        </> : <>
          <span><kbd>W A S D</kbd> Walk</span>
          <span><kbd>SHIFT</kbd> Run</span>
          <span><kbd>SPACE</kbd> Jump</span>
          <span><kbd>F</kbd> Scooter</span>
        </>}
        <span>
          <kbd>MOUSE DRAG</kbd> Look
        </span>
        <span>
          <kbd>V</kbd> {status.overview ? 'Return to character' : 'Campus view'}
        </span>
        <span><kbd>M</kbd> Travel map</span>
        <span className="secondary-control">
          Scroll to zoom · Double-click to lock camera · Esc to release
        </span>
      </footer>
      {status.rideMessage && !status.travelMessage && <output className="travel-notice" aria-live="polite">{status.rideMessage}</output>}
      {status.travelMessage && <output className="travel-notice" aria-live="polite">
        <span>{status.travelMessage}</span>
        {status.traveling && <Button variant="ghost" size="sm" onClick={() => game.current?.cancelTravel()}>Cancel</Button>}
      </output>}
      {status.imagery?.downloadRecovery && status.imagery.downloadRecovery.state !== 'ready' && (
        <output className="scenery-notice">
          {status.imagery.downloadRecovery.state === 'cooldown'
            ? `Scenery downloads are limited. Resuming in ${status.imagery.downloadRecovery.retryInSeconds}s.`
            : 'Scenery downloads are still limited. Some areas are unavailable; try again later.'}
        </output>
      )}
      {status.imagery && (
        <div
          className={`imagery-credits${status.offline ? ' offline-credits' : ''}`}
          aria-label="Campus imagery attribution"
        >
          {!status.offline && <span className="google-maps-attribution">Google Maps</span>}
          <span>{status.imagery.credits}</span>
          {!status.offline && (
            <a
              href="https://cesium.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              via Cesium ion
            </a>
          )}
        </div>
      )}
      <a
        className="credits"
        href="/credits.txt"
        target="_blank"
        rel="noreferrer"
      >
        Map & asset credits
      </a>
    </main>
  );
}
