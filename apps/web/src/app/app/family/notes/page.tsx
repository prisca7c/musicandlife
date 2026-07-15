'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { fmtDate } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { linkify } from '@/lib/linkify';
import { BookOpen, Download, FileText } from 'lucide-react';

interface NoteAttachment { fileId: string; name: string; mime: string; size?: number }
interface FamilyNote {
  id: string; body: string; lessonId: string | null; createdAt: string;
  student: { id: string; firstName: string; lastName: string } | null;
  attachments: NoteAttachment[];
}

export default function FamilyNotesPage() {
  const [notes, setNotes] = useState<FamilyNote[] | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    apiFetch<FamilyNote[]>('/family/notes', { token: tok() })
      .then(setNotes).catch(() => setNotes([]));
  }, []);

  async function download(noteId: string, fileId: string) {
    setDownloading(fileId);
    try {
      const { downloadUrl } = await apiFetch<{ downloadUrl: string }>(
        `/family/notes/${noteId}/attachments/${fileId}/sign-download`, { token: tok() },
      );
      window.open(downloadUrl, '_blank', 'noopener');
    } catch { /* ignore — link simply won't open */ }
    finally { setDownloading(null); }
  }

  return (
    <div>
      <PageHeader title="Lesson Notes" subtitle="Notes and materials your teacher has shared" />

      {notes === null ? (
        <p className="text-sm p-2" style={{ color: 'var(--txt3)' }}>Loading…</p>
      ) : notes.length === 0 ? (
        <div className="bg-white rounded-2xl border px-6 py-12 text-center" style={{ borderColor: 'var(--bd)' }}>
          <BookOpen size={28} className="mx-auto mb-3" style={{ color: 'var(--txt4)' }} />
          <p style={{ color: 'var(--txt3)' }}>No notes yet. When your teacher shares progress notes or materials, they&apos;ll appear here.</p>
        </div>
      ) : (
        <div className="space-y-3 max-w-3xl">
          {notes.map(n => (
            <div key={n.id} className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>
                  {n.student ? `${n.student.firstName} ${n.student.lastName}` : 'Your lessons'}
                </p>
                <span className="text-xs" style={{ color: 'var(--txt4)' }}>
                  {fmtDate(n.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--txt)' }}>{linkify(n.body)}</p>
              {n.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {n.attachments.map(a => (
                    <button key={a.fileId} onClick={() => download(n.id, a.fileId)} disabled={downloading === a.fileId}
                      className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-xl border font-medium hover:bg-[var(--surf)] disabled:opacity-60"
                      style={{ borderColor: 'var(--bd2)', color: 'var(--txt)' }}>
                      {downloading === a.fileId ? <FileText size={14} /> : <Download size={14} />}
                      <span className="truncate max-w-[200px]">{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
