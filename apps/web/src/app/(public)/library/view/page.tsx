'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Music, Download, Play, ExternalLink, Lock, Search } from 'lucide-react';

interface LibraryItem {
  id: string; title: string; description: string | null; type: string;
  url: string | null; delivery: 'download' | 'view_only'; instrument: string | null;
  hasFile: boolean; fileName: string | null; mime: string | null;
}
interface Library { email: string; paidUntil: string | null; items: LibraryItem[]; }

function LibraryView() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [data, setData] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!token) { setError('This link is missing its access token.'); return; }
    apiFetch<Library>(`/public/library?token=${encodeURIComponent(token)}`)
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'This access link is no longer active.'));
  }, [token]);

  async function openFile(id: string) {
    setOpening(id); setOpenError(null);
    try {
      const { url } = await apiFetch<{ url: string }>(`/public/library/file/${id}?token=${encodeURIComponent(token)}`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setOpenError({ id, message: err instanceof Error ? err.message : 'Could not open this file.' });
    } finally { setOpening(null); }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl border shadow-sm p-8 max-w-md text-center">
          <Lock size={28} className="mx-auto mb-3 text-gray-300" />
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Library unavailable</h1>
          <p className="text-sm text-gray-600">{error}</p>
          <a href="/library" className="inline-block mt-4 text-sm text-[var(--sage-dk)] hover:underline">Renew or subscribe →</a>
        </div>
      </div>
    );
  }

  if (!data) return <div className="min-h-screen bg-gray-50 py-12 px-4 text-center text-sm text-gray-400">Loading your library…</div>;

  const filtered = data.items.filter(i =>
    !search || i.title.toLowerCase().includes(search.toLowerCase()) || (i.description ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-1 text-[var(--sage-dk)]">
          <Music size={22} />
          <span className="font-semibold">Resource library</span>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          {data.email}{data.paidUntil && <> · access until {data.paidUntil}</>}
        </p>

        <div className="relative mb-4">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Search size={14} /></span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the library…"
            className="w-full border rounded px-3 py-2 pl-8 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" />
        </div>

        <div className="space-y-2">
          {filtered.length === 0 && (
            <div className="bg-white rounded-lg border px-4 py-12 text-center text-gray-400">
              {data.items.length === 0 ? 'The library is empty for now — check back soon.' : 'Nothing matches your search.'}
            </div>
          )}
          {filtered.map(i => (
            <div key={i.id} className="bg-white rounded-lg border px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900">{i.title}</span>
                {i.instrument && <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 capitalize">{i.instrument}</span>}
              </div>
              {i.description && <p className="text-sm text-gray-500 mt-0.5">{i.description}</p>}
              {i.type === 'link' && i.url && (
                <a href={i.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs mt-1 text-[var(--sage-dk)] hover:underline">
                  <ExternalLink size={12} /> Open link
                </a>
              )}
              {i.type === 'file' && i.hasFile && (
                <button onClick={() => openFile(i.id)} disabled={opening === i.id}
                  className="inline-flex items-center gap-1.5 text-xs mt-1 text-[var(--sage-dk)] hover:underline disabled:opacity-50">
                  {i.delivery === 'view_only' ? <Play size={12} /> : <Download size={12} />}
                  {opening === i.id ? 'Opening…' : i.delivery === 'view_only'
                    ? (i.mime?.startsWith('video/') ? 'Watch video' : 'View')
                    : 'Download'}
                  {i.fileName && <span className="text-gray-400">{i.fileName}</span>}
                </button>
              )}
              {openError?.id === i.id && <p className="text-xs text-red-500 mt-1">{openError.message}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LibraryViewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 py-12 px-4 text-center text-sm text-gray-400">Loading…</div>}>
      <LibraryView />
    </Suspense>
  );
}
