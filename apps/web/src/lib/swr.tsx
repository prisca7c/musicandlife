'use client';

// ─── Client-side data cache (stale-while-revalidate) ────────────────────────
// Before this, every page fetched from the API in a useEffect on mount and
// showed a spinner while it waited — even when returning to a page you'd just
// visited. There was no memory. This wraps our existing `apiFetch` in SWR so
// that:
//   • Revisiting a page renders the last-known data INSTANTLY (0ms), then
//     revalidates quietly in the background.
//   • Identical requests fired close together are de-duplicated into one.
//   • Hovering a nav link can pre-warm the next page's data (see prefetchRoute).
// The auth/refresh logic in api.ts is untouched — SWR just calls through it.

import useSWR, { SWRConfig, preload, type SWRConfiguration } from 'swr';
import { apiFetch } from './api';

function token(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie.match(/access_token=([^;]+)/)?.[1];
}

// The SWR cache key is simply the API path, so two components asking for the
// same path share one cached result and one in-flight request.
const fetcher = <T,>(path: string) => apiFetch<T>(path, { token: token() });

const CONFIG: SWRConfiguration = {
  // Don't refetch every time the window regains focus — too chatty for a
  // dashboard people tab away from constantly. Revalidation still happens on
  // mount and on explicit mutate().
  revalidateOnFocus: false,
  // While the key changes (pagination, search), keep showing the previous data
  // instead of flashing empty — the swap feels instant.
  keepPreviousData: true,
  // Treat identical requests within this window as the same one.
  dedupingInterval: 30_000,
};

/** Cached GET for an API path. Pass null to skip (conditional fetching). */
export function useApi<T>(path: string | null) {
  return useSWR<T>(path, fetcher, CONFIG);
}

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={CONFIG}>{children}</SWRConfig>;
}

// ─── Hover prefetch ─────────────────────────────────────────────────────────
// Maps a page route → the primary API call that page makes on mount, so we can
// warm the cache when the user hovers the nav link. Next.js already prefetches
// the page JS on hover; this adds the *data* so first visits feel instant too.
// Extend this map as pages are migrated to useApi.
const ROUTE_DATA: Record<string, string> = {
  '/app/students': '/students?limit=50&offset=0',
  '/app/families': '/families',
  '/app/staff': '/staff',
  '/app/billing': '/invoices',
  '/app/news': '/news',
  '/app/messaging': '/threads',
  '/app/resources': '/resources',
  '/app/reschedule-requests': '/reschedule-requests?status=pending',
  '/app/family/dashboard': '/family/dashboard',
  '/app/family/notes': '/family/notes',
};

export function prefetchRoute(href: string) {
  const path = ROUTE_DATA[href];
  if (path) preload(path, fetcher);
}
