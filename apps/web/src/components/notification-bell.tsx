'use client';

import { useState, useRef, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { Bell } from 'lucide-react';

interface Notification { id: string; title: string; body: string; readAt: string | null; createdAt: string; }

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Polled bell + dropdown for the in-app notification banner (booking/reschedule/
// cancellation events a user's own login is a recipient of). Mirrors the
// Messages unread-count polling pattern already used in this shell.
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  const { data: unreadData, mutate: mutateUnread } = useApi<{ count: number }>(
    '/notifications/unread-count', { refreshInterval: 30_000, dedupingInterval: 10_000 },
  );
  const { data: items = [], mutate: mutateList } = useApi<Notification[]>(open ? '/notifications' : null);
  const unread = unreadData?.count ?? 0;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function markRead(id: string) {
    await apiFetch(`/notifications/${id}/read`, { method: 'PATCH', token: tok() }).catch(() => {});
    mutateList(); mutateUnread();
  }

  async function markAllRead() {
    await apiFetch('/notifications/read-all', { method: 'POST', token: tok() }).catch(() => {});
    mutateList(); mutateUnread();
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-label="Notifications"
        className="relative p-1.5 rounded-lg transition-colors hover:bg-black/5">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] text-center text-[10px] font-bold rounded-full px-1"
            style={{ background: 'var(--sage)', color: 'white' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl border bg-white shadow-lg z-50"
          style={{ borderColor: 'var(--bd)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-sm font-bold">Notifications</p>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs font-semibold hover:underline" style={{ color: 'var(--sage)' }}>
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>No notifications yet.</p>
          )}
          {items.map(n => (
            <button key={n.id} onClick={() => !n.readAt && markRead(n.id)}
              className="w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-gray-50"
              style={{ borderColor: 'var(--bd)', background: n.readAt ? undefined : 'var(--sage-lt)' }}>
              <p className="text-sm font-semibold">{n.title}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--txt3)' }}>{n.body}</p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--txt4)' }}>{timeAgo(n.createdAt)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
