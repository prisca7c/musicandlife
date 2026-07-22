'use client';

import { useEffect } from 'react';
import { useApi, clearApiCache } from './swr';

// Who the cached responses belong to. Module-level so it survives navigation
// but not a full reload — which is exactly the lifetime of the SWR cache.
let cachedForUserId: string | null = null;

export interface MeData {
  user: { id: string; email: string; emailVerified: boolean; name: string };
  membership: { id: string; role: string } | null;
  organization: { id: string; name: string; slug: string } | null;
}

/**
 * The signed-in user (name/email/role/org), cached via SWR so every consumer
 * shares one request. Powers the dashboard welcome greeting and anywhere else
 * that needs the current user's display name.
 */
export function useMe() {
  const { data } = useApi<MeData>('/auth/me');

  // Backstop for the sign-in/sign-out cache clears: a session can also change
  // without going through our login page — a second tab signs in as someone
  // else, or a cookie is replaced. The moment /auth/me reports a different
  // person than the cache was built for, drop everything rather than render one
  // user's data under another user's name.
  const userId = data?.user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    if (cachedForUserId !== null && cachedForUserId !== userId) {
      cachedForUserId = userId;
      void clearApiCache();
      return;
    }
    cachedForUserId = userId;
  }, [userId]);

  const name = data?.user?.name ?? '';
  // "Alex Ng" → "Alex"; falls back to the whole name / empty string.
  const firstName = name.trim().split(/\s+/)[0] ?? '';
  return { me: data ?? null, name, firstName };
}
