'use client';

import { useState, useEffect, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Modal } from '@/components/modal';
import { linkify } from '@/lib/linkify';
import { Megaphone } from 'lucide-react';

interface NewsPost {
  id: string; title: string; body: string; publishedAt: string;
  author: { id: string; email: string } | null;
}

function PostModal({ open, onClose, onSaved, post }: {
  open: boolean; onClose: () => void; onSaved: () => void; post: NewsPost | null;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    const body = { title: f.get('title'), body: f.get('body') };
    try {
      if (post) {
        await apiFetch(`/news/${post.id}`, { method: 'PATCH', token: tok(), body: JSON.stringify(body) });
      } else {
        await apiFetch('/news', { method: 'POST', token: tok(), body: JSON.stringify(body) });
      }
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={post ? 'Edit news post' : 'New news post'}>
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Title <span style={{ color: 'var(--coral)' }}>*</span></label>
          <input name="title" required autoFocus defaultValue={post?.title} className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Body <span style={{ color: 'var(--coral)' }}>*</span></label>
          <textarea name="body" required rows={6} defaultValue={post?.body} className="ui-input" style={{ resize: 'vertical' }} />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : post ? 'Save changes' : 'Publish'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function NewsPage() {
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [editing, setEditing] = useState<NewsPost | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function load() { apiFetch<NewsPost[]>('/news', { token: tok() }).then(setPosts).catch(() => {}); }
  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    setDeleting(id);
    try { await apiFetch(`/news/${id}`, { method: 'DELETE', token: tok() }); load(); }
    catch (e) { console.error(e); } finally { setDeleting(null); }
  }

  return (
    <div>
      <PostModal open={showModal} onClose={() => setShowModal(false)} onSaved={load} post={editing} />
      <PageHeader title="Studio News" subtitle={`${posts.length} post${posts.length !== 1 ? 's' : ''}`}
        action={
          <button onClick={() => { setEditing(null); setShowModal(true); }} className="ui-btn-primary">
            <Megaphone size={15} /> New post
          </button>
        } />

      <div className="space-y-3">
        {posts.length === 0 && (
          <div className="bg-white rounded-2xl border px-6 py-16 text-center" style={{ borderColor: 'var(--bd)' }}>
            <p style={{ color: 'var(--txt4)' }}>No news posts yet. Published posts appear on the family and teacher home pages.</p>
          </div>
        )}
        {posts.map(p => (
          <div key={p.id} className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="font-bold" style={{ color: 'var(--txt)' }}>{p.title}</h3>
              <span className="text-xs shrink-0" style={{ color: 'var(--txt4)' }}>
                {new Date(p.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap mb-3" style={{ color: 'var(--txt3)' }}>{linkify(p.body)}</p>
            <div className="flex gap-3 text-xs font-semibold">
              <button onClick={() => { setEditing(p); setShowModal(true); }} style={{ color: 'var(--sage-dk)' }} className="hover:underline">Edit</button>
              <button onClick={() => remove(p.id)} disabled={deleting === p.id} style={{ color: 'var(--coral)' }} className="hover:underline disabled:opacity-50">
                {deleting === p.id ? 'Removing…' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
