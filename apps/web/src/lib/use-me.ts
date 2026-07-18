'use client';

import { useApi } from './swr';

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
  const name = data?.user?.name ?? '';
  // "Alex Ng" → "Alex"; falls back to the whole name / empty string.
  const firstName = name.trim().split(/\s+/)[0] ?? '';
  return { me: data ?? null, name, firstName };
}
