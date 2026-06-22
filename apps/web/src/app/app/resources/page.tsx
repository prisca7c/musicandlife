'use client';

import { useState, useEffect, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';

interface Resource { id: string; title: string; description: string | null; type: string; scope: string; url: string | null; file: { id: string; mime: string; originalName: string | null } | null; createdAt: string; }

const SCOPE_COLORS: Record<string, string> = { studio: 'default', teacher: 'trial', family: 'active', student: 'planned' };

function AddResourceModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<'link'|'note'>('link');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/resources', { method: 'POST', token: tok(), body: JSON.stringify({
        title: f.get('title'), description: f.get('description') || undefined,
        type, url: f.get('url') || undefined, scope: f.get('scope'),
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add resource">
      {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="block text-sm font-medium mb-1">Title <span className="text-red-500">*</span></label>
          <input name="title" required autoFocus className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" /></div>
        <div><label className="block text-sm font-medium mb-1">Type</label>
          <div className="flex gap-4">
            {(['link','note'] as const).map(t => (
              <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" checked={type===t} onChange={()=>setType(t)} className="text-[var(--sage)]" />
                <span className="capitalize">{t}</span>
              </label>
            ))}
          </div></div>
        {type === 'link' && <div><label className="block text-sm font-medium mb-1">URL</label>
          <input name="url" type="url" className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" /></div>}
        <div><label className="block text-sm font-medium mb-1">Description</label>
          <textarea name="description" rows={type==='note'?4:2} className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" /></div>
        <div><label className="block text-sm font-medium mb-1">Visible to</label>
          <select name="scope" className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]">
            <option value="studio">All staff (studio)</option>
            <option value="teacher">Teachers only</option>
            <option value="family">Families & students</option>
            <option value="student">Students only</option>
          </select></div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">{saving?'Saving…':'Add resource'}</button>
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm border hover:bg-gray-50">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState<string|null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function load() { apiFetch<Resource[]>('/resources', { token: tok() }).then(setResources).catch(()=>{}); }
  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    setDeleting(id);
    try { await apiFetch(`/resources/${id}`, { method: 'DELETE', token: tok() }); load(); }
    catch(e) { console.error(e); } finally { setDeleting(null); }
  }

  return (
    <div>
      <AddResourceModal open={showAdd} onClose={()=>setShowAdd(false)} onCreated={load} />
      <PageHeader title="Resources" subtitle={`${resources.length} item${resources.length!==1?'s':''}`}
        action={<button onClick={()=>setShowAdd(true)} className="bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)]">+ Add resource</button>} />
      <div className="space-y-2">
        {resources.length === 0 && <div className="bg-white rounded-lg border px-4 py-12 text-center text-gray-400">No resources yet. Add links, notes, or files for your students and staff.</div>}
        {resources.map(r => (
          <div key={r.id} className="bg-white rounded-lg border px-4 py-3 flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900 truncate">{r.title}</span>
                <Badge variant={SCOPE_COLORS[r.scope]}>{r.scope}</Badge>
                <span className="text-xs text-gray-400 capitalize">{r.type}</span>
              </div>
              {r.description && <p className="text-sm text-gray-500 mt-0.5 truncate">{r.description}</p>}
              {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-[var(--sage)] hover:underline mt-0.5 block truncate">{r.url}</a>}
            </div>
            <button onClick={()=>remove(r.id)} disabled={deleting===r.id}
              className="text-xs text-red-500 hover:underline shrink-0 disabled:opacity-50">Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
