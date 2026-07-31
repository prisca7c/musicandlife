'use client';

import { useEffect, useState } from 'react';

function decodeRole(token?: string): string {
  try {
    if (!token) return '';
    const payload = JSON.parse(atob(token.split('.')[1]!));
    return payload.role ?? '';
  } catch {
    return '';
  }
}

/**
 * The signed-in user's role, decoded from the `access_token` cookie on the
 * client.
 *
 * These pages are client components, but Next.js still server-renders them on a
 * hard load (refresh, bookmark, deep link, new tab). Reading `document.cookie`
 * at render time threw `ReferenceError: document is not defined` during SSR and
 * turned those loads into HTTP 500s. Reading the cookie in an effect keeps the
 * role out of the render pass: this returns '' during SSR and the first client
 * render (so the hydrated markup matches), then fills in the real role after
 * mount. Role only gates optional UI affordances, so a one-frame '' is fine.
 */
export function useRole(): string {
  const [role, setRole] = useState('');
  useEffect(() => {
    setRole(decodeRole(document.cookie.match(/access_token=([^;]+)/)?.[1]));
  }, []);
  return role;
}
