const API_URL = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? 'http://localhost:3001';

// ─── Cold-start ("server waking up") signal ─────────────────────────────────
// The API runs on a free tier that sleeps after inactivity, so the first
// request can take 30-90s to cold-start. We surface that to the user via a
// banner instead of leaving them staring at a frozen screen. Any request that
// stays in flight longer than SLOW_MS flips a shared "slow" flag; subscribers
// (the ServerWakingBanner) react to it.
const SLOW_MS = 4000;
type SlowListener = (active: boolean) => void;
const slowListeners = new Set<SlowListener>();
let slowCount = 0;

function emitSlow() {
  const active = slowCount > 0;
  slowListeners.forEach((l) => l(active));
}

/** Subscribe to the "a request is taking unusually long" signal. Returns an unsubscribe fn. */
export function onSlowRequest(listener: SlowListener): () => void {
  slowListeners.add(listener);
  listener(slowCount > 0);
  return () => {
    slowListeners.delete(listener);
  };
}

/** fetch() wrapper that raises the shared slow-request flag if the call exceeds SLOW_MS. */
async function trackedFetch(input: string, init: RequestInit): Promise<Response> {
  let firedSlow = false;
  const timer = setTimeout(() => {
    firedSlow = true;
    slowCount += 1;
    emitSlow();
  }, SLOW_MS);
  try {
    return await fetch(input, init);
  } finally {
    clearTimeout(timer);
    if (firedSlow) {
      slowCount -= 1;
      emitSlow();
    }
  }
}

// ─── Silent session refresh ─────────────────────────────────────────────────
// The access token is short-lived (~15 min) but the refresh_token cookie the
// API sets lasts 30 days. Rather than bounce the user to /login the moment the
// access token expires, any authenticated request that comes back 401 triggers
// a single call to /auth/refresh, rewrites the access_token cookie, and retries
// the original request once. The user stays signed in until they log out.
//
// Refreshes are de-duplicated through one shared in-flight promise: the API
// rotates the refresh token on every use and treats a *reused* token as a theft
// signal (revoking the whole session), so two concurrent refreshes would log
// the user out. Funnelling them through `refreshInFlight` guarantees exactly
// one refresh call even when many requests 401 at once.
const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, matches refresh TTL
let refreshInFlight: Promise<string | null> | null = null;

function isBrowser() {
  return typeof document !== 'undefined';
}

function readAccessToken(): string | undefined {
  if (!isBrowser()) return undefined;
  return document.cookie.match(/access_token=([^;]+)/)?.[1];
}

function writeAccessToken(token: string) {
  if (!isBrowser()) return;
  // SameSite=Lax (not Strict) so following a link into the app from an email
  // still sends the cookie; long max-age so it survives closing the tab.
  document.cookie = `access_token=${token}; path=/; max-age=${ACCESS_COOKIE_MAX_AGE}; SameSite=Lax`;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return null;
        const { accessToken } = (await res.json()) as { accessToken?: string };
        if (!accessToken) return null;
        writeAccessToken(accessToken);
        return accessToken;
      } catch {
        return null;
      } finally {
        // Clear on next tick so callers awaiting this same refresh all read it first.
        setTimeout(() => { refreshInFlight = null; }, 0);
      }
    })();
  }
  return refreshInFlight;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...rest } = init;

  const doFetch = (bearer?: string) => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(rest.headers ?? {}),
    };
    return trackedFetch(`${API_URL}/api/v1${path}`, { ...rest, headers, credentials: 'include' });
  };

  let res = await doFetch(token);

  // On 401 for an authenticated, non-auth request, try one silent refresh + retry.
  if (res.status === 401 && !path.startsWith('/auth/') && isBrowser()) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      res = await doFetch(fresh);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `API error ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// For endpoints that return a raw file body (e.g. ?format=csv) instead of JSON.
export async function apiFetchBlob(path: string, init: RequestInit & { token?: string } = {}): Promise<Blob> {
  const { token, ...rest } = init;
  const headers: HeadersInit = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) };
  const res = await trackedFetch(`${API_URL}/api/v1${path}`, { ...rest, headers, credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `API error ${res.status}`);
  }
  return res.blob();
}
