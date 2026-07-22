'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { Modal } from '@/components/modal';
import { Search, Check } from 'lucide-react';

interface Person { userId: string; name: string; email: string; role: string; roleLabel: string; }
interface Thread {
  id: string; subject: string; updatedAt: string;
  messages: { body: string; createdAt: string }[];
  participants: { user: { id: string; email: string } }[];
  withNames: string[];
  people: Person[];
  unreadCount: number;
}

interface Recipient { userId: string; name: string; email: string; role: string; roleLabel: string; }

function NewThreadModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [recipQuery, setRecipQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Who the current user is allowed to message (staff→everyone, parent→staff only).
  const { data: recipients = [] } = useApi<Recipient[]>(open ? '/threads/recipients' : null);
  const rq = recipQuery.trim().toLowerCase();
  const shown = rq
    ? recipients.filter(r => r.name.toLowerCase().includes(rq) || r.email.toLowerCase().includes(rq) || r.roleLabel.toLowerCase().includes(rq))
    : recipients;
  const selectedRecips = recipients.filter(r => selected.includes(r.userId));

  function toggle(id: string) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('');
    if (selected.length === 0) { setError('Please choose at least one person to send this to.'); return; }
    setSaving(true);
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/threads', { method: 'POST', token: tok(), body: JSON.stringify({
        subject: f.get('subject'), body: f.get('body'), participantIds: selected,
      })});
      setSelected([]); setRecipQuery('');
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New message thread">
      {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">To <span className="text-red-500">*</span></label>
          {selectedRecips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedRecips.map(r => (
                <span key={r.userId} className="inline-flex items-center gap-1 text-xs bg-[var(--sage-lt)] text-[var(--sage-dk)] rounded-full pl-2.5 pr-1 py-0.5">
                  {r.name} <span className="opacity-60">· {r.roleLabel}</span>
                  <button type="button" onClick={() => toggle(r.userId)} aria-label={`Remove ${r.name}`}
                    className="rounded-full w-4 h-4 flex items-center justify-center hover:bg-[var(--sage-md)]">×</button>
                </span>
              ))}
            </div>
          )}
          <input value={recipQuery} onChange={e => setRecipQuery(e.target.value)} placeholder="Search people by name, role or email…"
            className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" />
          <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--bd2)' }}>
            {shown.length === 0 ? (
              <p className="px-3 py-3 text-xs text-gray-400">{recipients.length === 0 ? 'No one available to message.' : 'No matches.'}</p>
            ) : shown.map(r => {
              const on = selected.includes(r.userId);
              return (
                <button type="button" key={r.userId} onClick={() => toggle(r.userId)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surf)] ${on ? 'bg-[var(--sage-lt)]' : ''}`}>
                  <span className="min-w-0">
                    <span className="font-medium">{r.name}</span> <span className="text-xs text-gray-400">· {r.roleLabel}</span>
                    {/* Two people can share a name; the address is what tells them
                        apart before you send a parent something meant for staff. */}
                    <span className="block text-xs text-gray-400 truncate">{r.email}</span>
                  </span>
                  {on && <Check size={14} className="text-[var(--sage-dk)] shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
        <div><label className="block text-sm font-medium mb-1">Subject <span className="text-red-500">*</span></label>
          <input name="subject" required className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" /></div>
        <div><label className="block text-sm font-medium mb-1">Message <span className="text-red-500">*</span></label>
          <textarea name="body" required rows={4} className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" /></div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">{saving ? 'Sending…' : 'Send'}</button>
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm border hover:bg-gray-50">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function MessagingPage() {
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Cached read — instant on revisit, revalidates in the background.
  const { data: threads = [], error, isLoading, mutate } = useApi<Thread[]>('/threads');
  const load = () => mutate();

  const q = search.trim().toLowerCase();
  const filtered = q ? threads.filter(t =>
    t.subject.toLowerCase().includes(q) ||
    t.messages.some(m => m.body.toLowerCase().includes(q)) ||
    (t.withNames ?? []).some(n => n.toLowerCase().includes(q)) ||
    t.participants.some(p => p.user.email.toLowerCase().includes(q))
  ) : threads;

  return (
    <div>
      <NewThreadModal open={showNew} onClose={() => setShowNew(false)} onCreated={load} />
      <PageHeader title="Messages"
        action={<button onClick={() => setShowNew(true)} className="bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)]">+ New message</button>} />

      <div className="mb-5 relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--txt4)' }}>
          <Search size={15} />
        </span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search people or messages…"
          className="ui-search pl-9"
        />
      </div>

      <div className="space-y-2">
        {error && (
          <div className="bg-white rounded-lg border px-4 py-8 text-center">
            <p className="text-sm text-red-600">Couldn&apos;t load your messages.</p>
            <button onClick={() => mutate()} className="mt-3 text-sm border rounded px-3 py-1.5 hover:bg-gray-50">Try again</button>
          </div>
        )}
        {!error && isLoading && threads.length === 0 && (
          <div className="bg-white rounded-lg border px-4 py-12 text-center text-gray-400">Loading…</div>
        )}
        {!error && !isLoading && filtered.length === 0 && (
          <div className="bg-white rounded-lg border px-4 py-12 text-center text-gray-400">
            {threads.length === 0 ? 'No messages yet.' : 'No results for that search.'}
          </div>
        )}
        {!error && filtered.map(t => {
          // Lead with WHO, the way a chat app does — the subject is the second
          // line. People recognise "Aiko Nakamura · Parent", not "Re: Tuesday".
          const names = t.withNames?.length ? t.withNames : ['(no one else)'];
          const unread = (t.unreadCount ?? 0) > 0;
          return (
            <Link key={t.id} href={`/app/messaging/${t.id}`}
              className="block bg-white rounded-lg border px-4 py-3 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`truncate ${unread ? 'font-semibold text-gray-900' : 'font-medium text-gray-800'}`}>
                    {names.join(', ')}
                  </p>
                  <p className="text-sm text-gray-600 mt-0.5 truncate">{t.subject}</p>
                  <p className={`text-sm mt-0.5 line-clamp-1 ${unread ? 'text-gray-800' : 'text-gray-400'}`}>
                    {t.messages[0]?.body ?? ''}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  <span className="text-xs text-gray-400">{new Date(t.updatedAt).toLocaleDateString('en-GB')}</span>
                  {unread && (
                    <span className="min-w-[1.25rem] text-center text-[11px] font-semibold text-white bg-[var(--sage)] rounded-full px-1.5 py-0.5">
                      {t.unreadCount}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {(t.people ?? []).slice(0, 4).map(p => (
                  <span key={p.userId} className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                    {p.name}{p.roleLabel ? ` · ${p.roleLabel}` : ''}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
