const API_URL = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? 'http://localhost:3001';

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

  const res = await fetch(`${API_URL}/api/v1${path}`, {
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
  const res = await fetch(`${API_URL}/api/v1${path}`, { ...rest, headers, credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `API error ${res.status}`);
  }
  return res.blob();
}
