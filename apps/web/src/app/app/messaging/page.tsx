'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { Modal } from '@/components/modal';
import { Search } from 'lucide-react';

interface Thread {
  id: string; subject: string; updatedAt: string;
  messages: { body: string; createdAt: string }[];
  participants: { user: { id: string; email: string } }[];
}

function NewThreadModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/threads', { method: 'POST', token: tok(), body: JSON.stringify({
        subject: f.get('subject'), body: f.get('body'),
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New message thread">
      {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="block text-sm font-medium mb-1">Subject <span className="text-red-500">*</span></label>
          <input name="subject" required autoFocus className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" /></div>
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
  const { data: threads = [], mutate } = useApi<Thread[]>('/threads');
  const load = () => mutate();

  const q = search.trim().toLowerCase();
  const filtered = q ? threads.filter(t =>
    t.subject.toLowerCase().includes(q) ||
    t.messages.some(m => m.body.toLowerCase().includes(q)) ||
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
        {filtered.length === 0 && (
          <div className="bg-white rounded-lg border px-4 py-12 text-center text-gray-400">
            {threads.length === 0 ? 'No messages yet.' : 'No results for that search.'}
          </div>
        )}
        {filtered.map(t => (
          <Link key={t.id} href={`/app/messaging/${t.id}`}
            className="block bg-white rounded-lg border px-4 py-3 hover:shadow-sm transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-gray-900">{t.subject}</p>
                <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{t.messages[0]?.body ?? ''}</p>
              </div>
              <span className="text-xs text-gray-400 ml-4 shrink-0">{new Date(t.updatedAt).toLocaleDateString('en-GB')}</span>
            </div>
            <div className="flex gap-1 mt-2">
              {t.participants.slice(0,4).map(p => (
                <span key={p.user.id} className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{p.user.email.split('@')[0]}</span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
