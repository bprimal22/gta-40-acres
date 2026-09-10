import type { TilesConfig } from './photoreal';

export const GOOGLE_CAMPUS_ASSET = 2275207;
export const VISITOR_TOKEN_KEY = 'ut-campus.cesium-token.v1';
declare const __UT_STATIC_DEMO__: boolean | undefined;

export function usesVisitorToken() {
  return (typeof __UT_STATIC_DEMO__ !== 'undefined' && __UT_STATIC_DEMO__) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}

export class CesiumConnectionError extends Error {
  constructor(public readonly reason: 'invalid' | 'forbidden' | 'asset' | 'quota' | 'network' | 'storage') {
    super(reason);
    this.name = 'CesiumConnectionError';
  }
}

export function connectionMessage(error: unknown) {
  const reason = error instanceof CesiumConnectionError ? error.reason : 'network';
  const messages = {
    invalid: 'That token was not accepted. Paste an active Cesium ion access token and try again.',
    forbidden: 'Cesium denied access. Allow this site address on your token, enable assets:read, and include Google Photorealistic 3D Tiles.',
    asset: 'Enable Google Photorealistic 3D Tiles in your Cesium ion account, then allow that asset on your token.',
    quota: 'Cesium is limiting requests or your allowance is exhausted. Check your Cesium usage and try again later.',
    network: 'Could not reach Cesium. Check your connection and try again.',
    storage: 'This browser could not save your token. Allow storage for this site, then try again.',
  };
  return messages[reason];
}

/** Validate directly with Cesium, keeping the browser token out of request URLs.
 * The temporary Google endpoint stays in memory and is reused by the renderer;
 * it is never saved alongside the token or sent to the app host. */
export async function validateVisitorToken(value: string, signal?: AbortSignal): Promise<TilesConfig> {
  const token = value.trim();
  if (token.length < 16 || token.length > 8192 || /\s/.test(token)) throw new CesiumConnectionError('invalid');
  const timeout = AbortSignal.timeout(15000);
  let response: Response;
  try {
    response = await fetch(`https://api.cesium.com/v1/assets/${GOOGLE_CAMPUS_ASSET}/endpoint`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'strict-origin-when-cross-origin',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch { throw new CesiumConnectionError('network'); }
  if (!response.ok) {
    const reason = response.status === 401 ? 'invalid' : response.status === 403 ? 'forbidden' :
      response.status === 404 ? 'asset' : [402, 429].includes(response.status) ? 'quota' : 'network';
    throw new CesiumConnectionError(reason);
  }
  try {
    const data = await response.json() as { type?: unknown; externalType?: unknown; options?: { url?: unknown } };
    if (typeof data.options?.url !== 'string') throw new CesiumConnectionError('asset');
    const endpoint = new URL(data.options.url);
    if (data.type !== '3DTILES' || !data.externalType || endpoint.protocol !== 'https:' ||
      endpoint.hostname !== 'tile.googleapis.com' || endpoint.pathname !== '/v1/3dtiles/root.json' ||
      !endpoint.searchParams.get('key')) throw new CesiumConnectionError('asset');
    return { token, assetId: GOOGLE_CAMPUS_ASSET, endpointUrl: endpoint.href };
  } catch (error) {
    if (error instanceof CesiumConnectionError) throw error;
    throw new CesiumConnectionError('asset');
  }
}

export function readVisitorToken(): string | null {
  try { return localStorage.getItem(VISITOR_TOKEN_KEY); }
  catch { throw new CesiumConnectionError('storage'); }
}
export function saveVisitorToken(token: string) {
  try {
    localStorage.setItem(VISITOR_TOKEN_KEY, token);
    if (localStorage.getItem(VISITOR_TOKEN_KEY) !== token) throw Error();
  } catch { throw new CesiumConnectionError('storage'); }
}
export function removeVisitorToken() {
  try { localStorage.removeItem(VISITOR_TOKEN_KEY); }
  catch { throw new CesiumConnectionError('storage'); }
}

export async function gameTilesConfig(provided?: TilesConfig): Promise<TilesConfig> {
  if (provided) return provided;
  if (usesVisitorToken()) throw new CesiumConnectionError('invalid');
  const response = await fetch('/api/tiles-config', { cache: 'no-store' });
  if (!response.ok) throw Error('Campus imagery access is unavailable. Check the local Cesium configuration.');
  return response.json() as Promise<TilesConfig>;
}
