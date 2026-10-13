import { guestSession } from './guest-session';
import { readVisitorToken, validateVisitorToken } from './visitor-cesium';

/** Shared access wins even if a browser has an old or rejected personal token. */
export async function campusAccess(signal?: AbortSignal) {
  let token: string | null = null;
  try { token = readVisitorToken(); } catch { /* Shared access needs no local storage. */ }
  const session = await guestSession(true, signal);
  if (signal?.aborted) return { session, saved: !!token };
  if (session.status === 'active' && session.config) return { session, saved: !!token, config: session.config };
  if (token) {
    try {
      const config = await validateVisitorToken(token, signal);
      return { session: null, saved: true, config: { ...config, token: '' } };
    } catch { /* A stale token must not replace the shared-access error or retry. */ }
  }
  return { session, saved: !!token };
}
