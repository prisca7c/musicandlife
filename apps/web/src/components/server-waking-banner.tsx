'use client';

import { useEffect, useState } from 'react';
import { onSlowRequest } from '@/lib/api';

/**
 * Fixed banner shown when an API request is taking unusually long — almost
 * always the free-tier backend cold-starting after a period of inactivity.
 * Without this the user just sees a frozen screen for up to a minute.
 */
export function ServerWakingBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => onSlowRequest(setActive), []);

  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        padding: '10px 16px',
        background: '#3D7A55',
        color: '#fff',
        fontSize: '13px',
        fontWeight: 600,
        boxShadow: '0 2px 12px rgba(0,0,0,.18)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          border: '2px solid rgba(255,255,255,.4)',
          borderTopColor: '#fff',
          borderRadius: '50%',
          display: 'inline-block',
          animation: 'mlq-spin 0.8s linear infinite',
        }}
      />
      Waking up the server — this can take up to a minute after a period of inactivity. Please wait…
      <style>{`@keyframes mlq-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
