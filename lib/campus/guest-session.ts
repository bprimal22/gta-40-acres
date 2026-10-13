import type { TilesConfig } from './photoreal';

export type GuestSession = {
  status: 'active' | 'quota' | 'unavailable' | 'new' | 'starting';
  serverNow?: number;
  config?: TilesConfig;
};
export async function guestSession(start: boolean, signal?: AbortSignal): Promise<GuestSession> {
  try {
    // At most two requests: issue the HttpOnly cookie, then prove this browser
    // remembers it before resolving imagery. No visitor token is ever sent here.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch('/api/guest-session', {
        method: start ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      });
      const data = await response.json() as GuestSession;
      if (data.status === 'starting' && start) continue;
      if (data.status === 'quota') return { status: 'quota' };
      if (!start && data.status === 'new' && response.ok) return { status: 'new' };
      if (!response.ok || data.status !== 'active' || !Number.isSafeInteger(data.serverNow)) return { status: 'unavailable' };
      if (start) {
        const endpoint = new URL(data.config?.endpointUrl ?? '');
        if (data.config?.assetId !== 2275207 || endpoint.protocol !== 'https:' ||
          endpoint.hostname !== 'tile.googleapis.com' || endpoint.pathname !== '/v1/3dtiles/root.json' || !endpoint.searchParams.get('key'))
          return { status: 'unavailable' };
        data.config = { token: '', assetId: 2275207, endpointUrl: endpoint.href };
      }
      return data;
    }
  } catch { /* A temporary outage offers retry; only quota exhaustion prompts for a token. */ }
  return { status: 'unavailable' };
}
