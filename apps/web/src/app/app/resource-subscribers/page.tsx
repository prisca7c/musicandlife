'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Copy, Check, Play, XCircle } from 'lucide-react';

interface Subscriber {
  id: string; email: string; name: string | null;
  status: 'pending' | 'active' | 'canceled';
  paidUntil: string | null; active: boolean; accessLink: string; createdAt: string;
}

export default function ResourceSubscribersPage() {
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const { data: subscribers = [], mutate } = useApi<Subscriber[]>('/resource-subscribers');
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function act(id: string, action: 'activate' | 'cancel') {
    setBusy(id); setError('');
    try {
      await apiFetch(`/resource-subscribers/${id}/${action}`, { method: 'POST', token: tok() });
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally { setBusy(null); }
  }

  async function copyLink(id: string, link: string) {
    try { await navigator.clipboard.writeText(link); setCopied(id); setTimeout(() => setCopied(null), 1500); } catch { /* ignore */ }
  }

  // A row whose status is still 'active' but whose paid period has run out is
  // "lapsed" — surface that distinctly rather than mislabelling it "active".
  const statusLabel = (s: Subscriber) =>
    s.active ? 'active' : s.status === 'active' ? 'lapsed' : s.status;
  const statusVariant = (s: Subscriber) =>
    s.active ? 'active' : s.status === 'pending' ? 'trial' : 'default';

  return (
    <div>
      <PageHeader title="Library subscribers"
        subtitle={`${subscribers.length} ${subscribers.length === 1 ? 'person' : 'people'} · public resource-library access`} />

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 text-sm text-amber-800">
        Public subscribers can see every resource shared with the <strong>studio</strong> audience. Only publish material to
        &ldquo;All staff (studio)&rdquo; that you&apos;re happy for a paying member of the public to view.
      </div>

      {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      <div className="space-y-2">
        {subscribers.length === 0 && (
          <div className="bg-white rounded-lg border px-4 py-12 text-center text-gray-400">
            No one has requested library access yet. Share the public page at <code className="text-gray-500">/library</code>.
          </div>
        )}
        {subscribers.map(s => (
          <div key={s.id} className="bg-white rounded-lg border px-4 py-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900">{s.name || s.email}</span>
                <Badge variant={statusVariant(s)}>{statusLabel(s)}</Badge>
              </div>
              {s.name && <p className="text-xs text-gray-500">{s.email}</p>}
              <p className="text-xs text-gray-400 mt-0.5">
                {s.paidUntil ? `Access until ${s.paidUntil}` : 'Not yet activated'}
              </p>
              {s.active && (
                <button onClick={() => copyLink(s.id, s.accessLink)}
                  className="inline-flex items-center gap-1.5 text-xs mt-1 text-[var(--sage-dk)] hover:underline">
                  {copied === s.id ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy access link</>}
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <button onClick={() => act(s.id, 'activate')} disabled={busy === s.id}
                className="inline-flex items-center gap-1.5 bg-[var(--sage)] text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">
                <Play size={12} /> {s.active ? 'Renew' : 'Activate'}
              </button>
              {s.status !== 'canceled' && (
                <button onClick={() => {
                  if (!confirm(`Cancel ${s.name || s.email}'s subscription? This revokes their library access immediately${s.paidUntil ? `, even though they've paid until ${s.paidUntil}` : ''}. This can't be undone from here — you'd need to activate them again.`)) return;
                  act(s.id, 'cancel');
                }} disabled={busy === s.id}
                  className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:underline disabled:opacity-50 px-3 py-1">
                  <XCircle size={12} /> Cancel
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
