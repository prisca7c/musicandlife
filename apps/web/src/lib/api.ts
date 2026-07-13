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

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...rest } = init;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(rest.headers ?? {}),
  };

  const res = await trackedFetch(`${API_URL}/api/v1${path}`, {
    ...rest,
    headers,
    credentials: 'include',
  });

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
