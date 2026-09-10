// Cloudflare Pages advanced-mode worker. Only the guest-session route runs here;
// normal game assets keep using Pages. Secrets are runtime bindings, never assets.
const DAY = 24 * 60 * 60 * 1000;
const COOKIE = 'ut-campus-guest-v1';
const encoder = new TextEncoder();
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const bytesFrom = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function signingKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function encodeSession(session, secret) {
  const payload = base64url(encoder.encode(JSON.stringify(session)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}
async function readSession(request, secret, now) {
  const cookie = request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!cookie) return null;
  try {
    const [payload, signature, extra] = cookie.slice(COOKIE.length + 1).split('.');
    if (extra || !payload || !signature || payload.length > 1000) return false;
    if (!await crypto.subtle.verify('HMAC', await signingKey(secret), bytesFrom(signature), encoder.encode(payload))) return false;
    const session = JSON.parse(new TextDecoder().decode(bytesFrom(payload)));
    if (!Number.isSafeInteger(session.startedAt) || session.startedAt > now ||
      session.expiresAt !== session.startedAt + DAY || typeof session.id !== 'string') return false;
    return session;
  } catch { return false; }
}
function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store',
    'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff', ...headers,
  } });
}

// Dependency injection is for deterministic server tests; the deployed entry
// below always uses the actual server clock and fetch implementation.
export function guestHandler({ now = Date.now, upstreamFetch = fetch } = {}) {
  return async function handle(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/guest-session') {
      if (url.pathname.startsWith('/api/')) return json({ status: 'not-found' }, 404);
      return env.ASSETS.fetch(request);
    }
    const origin = env.GUEST_ALLOWED_ORIGIN || 'https://gta40acres.pages.dev';
    if (url.origin !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
      (request.headers.get('Origin') && request.headers.get('Origin') !== origin)) return json({ status: 'forbidden' }, 403);
    if (!['GET', 'POST'].includes(request.method)) return json({ status: 'method-not-allowed' }, 405, { Allow: 'GET, POST' });
    if (request.method === 'POST' && request.headers.get('Origin') !== origin) return json({ status: 'forbidden' }, 403);
    if (!env.GUEST_CESIUM_TOKEN || !env.GUEST_COOKIE_SECRET || env.GUEST_COOKIE_SECRET.length < 32 || env.GUEST_ENABLED !== '1')
      return json({ status: 'unavailable' }, 503);
    const serverNow = now();
    const session = await readSession(request, env.GUEST_COOKIE_SECRET, serverNow);
    if (session === false || (session && serverNow >= session.expiresAt))
      return json({ status: 'expired', serverNow }, request.method === 'POST' ? 410 : 200);
    if (!session) {
      if (request.method === 'GET') return json({ status: 'new', serverNow });
      const created = { id: crypto.randomUUID(), startedAt: serverNow, expiresAt: serverNow + DAY };
      const value = await encodeSession(created, env.GUEST_COOKIE_SECRET);
      // Keep the expired marker for subsequent visits instead of deleting the
      // cookie at 24 hours and accidentally granting a fresh trial.
      const secure = url.protocol === 'https:' ? '; Secure' : '';
      return json({ status: 'starting', serverNow, expiresAt: created.expiresAt }, 200, {
        'Set-Cookie': `${COOKIE}=${value}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax${secure}`,
      });
    }
    const access = { status: 'active', expiresAt: session.expiresAt, serverNow };
    if (request.method === 'GET') return json(access);
    try {
      const response = await upstreamFetch('https://api.cesium.com/v1/assets/2275207/endpoint', {
        headers: { Authorization: `Bearer ${env.GUEST_CESIUM_TOKEN}`, Referer: origin + '/', Origin: origin },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return json({ status: 'unavailable', reason: `provider-${response.status}` }, 503);
      const data = await response.json();
      const endpoint = new URL(data.options?.url);
      if (data.type !== '3DTILES' || !data.externalType || endpoint.protocol !== 'https:' ||
        endpoint.hostname !== 'tile.googleapis.com' || endpoint.pathname !== '/v1/3dtiles/root.json' || !endpoint.searchParams.get('key'))
        return json({ status: 'unavailable', reason: 'provider-endpoint' }, 503);
      // Recheck after the network request, so a request that straddles expiry
      // cannot hand out fresh imagery access after the deadline.
      if (now() >= session.expiresAt) return json({ status: 'expired', serverNow: now() }, 410);
      // The owner's ion token never leaves the worker. Like the existing visitor
      // flow, the Cesium-issued Google endpoint is used only in browser memory.
      return json({ ...access, serverNow: now(), config: { token: '', assetId: 2275207, endpointUrl: endpoint.href } });
    } catch { return json({ status: 'unavailable', reason: 'provider-connection' }, 503); }
  };
}
export default { fetch: guestHandler() };
