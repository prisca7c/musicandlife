'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { SearchableSelect } from '@/components/searchable-select';
import { linkify } from '@/lib/linkify';
import { uploadFile } from '@/lib/upload';
import { useRole } from '@/lib/use-role';
import { Lock, Users, Paperclip, X as XIcon, FileText, Download, Check } from 'lucide-react';

interface Student { id: string; firstName: string; lastName: string; }
interface Lesson { id: string; startsAt: string; duration: number; enrollment: { instrument: string } | null; }
interface NoteAttachment { fileId: string; name: string; mime: string; size?: number }
interface Note {
  // Widened from the enum on purpose — see the fail-closed filter below.
  id: string; body: string; visibility: string; createdAt: string; lessonId: string | null;
  authorName?: string;
  attachments?: NoteAttachment[] | null;
  student: { id: string; firstName: string; lastName: string } | null;
  author: { id: string; email: string } | null;
}
// A file the teacher has picked to attach: tracks upload progress until it has a fileId.
interface PendingAttachment { localId: string; name: string; mime: string; size: number; fileId?: string; error?: string }

export default function NotesPage() {
  const [studentId, setStudentId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [familyNote, setFamilyNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const isTeacher = useRole() === 'teacher';

  // Cached reads. The student list loads once; lessons and notes are keyed on
  // the selected student (null key = don't fetch until one is picked).
  const { data: students = [] } = useApi<Student[]>('/students');
  const notesKey = studentId ? `/notes?studentId=${studentId}` : null;
  const { data: notesRaw = [], mutate: mutateNotes } = useApi<Note[]>(notesKey);
  const notes = [...notesRaw].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lessonsKey = studentId ? `/lessons?studentId=${studentId}` : null;
  const { data: lessonsRaw = [] } = useApi<Lesson[]>(lessonsKey);
  const lessons = lessonsRaw
    .filter(l => new Date(l.startsAt) <= new Date())
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 8);

  async function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const picked = Array.from(fileList);
    const staged: PendingAttachment[] = picked.map(f => ({
      localId: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`,
      name: f.name, mime: f.type || 'application/octet-stream', size: f.size,
    }));
    setAttachments(prev => [...prev, ...staged]);
    await Promise.all(picked.map(async (f, i) => {
      const localId = staged[i]!.localId;
      try {
        const up = await uploadFile(f, tok());
        setAttachments(prev => prev.map(a => a.localId === localId ? { ...a, fileId: up.fileId } : a));
      } catch (e) {
        setAttachments(prev => prev.map(a => a.localId === localId ? { ...a, error: e instanceof Error ? e.message : 'Upload failed' } : a));
      }
    }));
  }

  function removeAttachment(localId: string) {
    setAttachments(prev => prev.filter(a => a.localId !== localId));
  }

  // Reset the composer when switching students.
  useEffect(() => {
    setLessonId(''); setFamilyNote(''); setInternalNote(''); setAttachments([]); setError('');
  }, [studentId]);

  const readyAttachments = attachments.filter(a => a.fileId).map(a => ({ fileId: a.fileId!, name: a.name, mime: a.mime, size: a.size }));
  const uploadsPending = attachments.some(a => !a.fileId && !a.error);
  const canSave = !!studentId && (!!familyNote.trim() || !!internalNote.trim() || readyAttachments.length > 0) && !uploadsPending;

  async function saveNotes() {
    if (!canSave) return;
    setSaving(true); setError('');
    try {
      // The family note carries any media; if the teacher attached files without
      // typing anything, give the note a sensible default body.
      if (familyNote.trim() || readyAttachments.length > 0) {
        await apiFetch('/notes', {
          method: 'POST', token: tok(),
          body: JSON.stringify({
            studentId, lessonId: lessonId || undefined,
            body: familyNote.trim() || 'Shared some materials with you.',
            visibility: 'family',
            attachments: readyAttachments,
          }),
        });
      }
      if (internalNote.trim()) {
        await apiFetch('/notes', {
          method: 'POST', token: tok(),
          body: JSON.stringify({ studentId, lessonId: lessonId || undefined, body: internalNote.trim(), visibility: 'internal' }),
        });
      }
      setFamilyNote(''); setInternalNote(''); setAttachments([]);
      mutateNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setSaving(false);
    }
  }

  // Teachers own the files they uploaded, so the owner-scoped download route works.
  async function downloadAttachment(fileId: string) {
    try {
      const { downloadUrl } = await apiFetch<{ downloadUrl: string }>(`/files/${fileId}/sign-download`, { token: tok() });
      window.open(downloadUrl, '_blank', 'noopener');
    } catch { /* ignore — link simply won't open */ }
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Lesson Notes
            <InfoTooltip text="“Notes for family” (and any media you attach) appear on the family's portal. “Notes for staff” stay internal — visible only to studio staff and the student's teachers. Both form part of the student's record, so keep them professional." />
          </span>
        }
        subtitle={isTeacher ? 'Notes for your students' : 'Notes across the studio'}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div>
          <label className="ui-label">Student</label>
          <SearchableSelect
            options={students.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            value={studentId} onChange={setStudentId} placeholder="Select a student…"
          />
        </div>

        {studentId && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-[var(--bd)] p-5">
              {lessons.length > 0 && (
                <div className="mb-4">
                  <label className="ui-label">Link to a recent lesson (optional)</label>
                  <SearchableSelect
                    options={lessons.map(l => ({
                      value: l.id,
                      label: `${new Date(l.startsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${l.enrollment?.instrument ?? 'Lesson'}`,
                    }))}
                    value={lessonId} onChange={setLessonId} emptyLabel="No specific lesson"
                  />
                </div>
              )}

              {error && (
                <div className="mb-4 text-sm rounded-xl px-4 py-3"
                  style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="ui-label flex items-center gap-1.5">
                    <Users size={13} /> Notes for family
                  </label>
                  <p className="text-xs mb-1.5" style={{ color: 'var(--txt4)' }}>Progress, practice tips, what to work on next — visible to the family on their portal.</p>
                  <textarea value={familyNote} onChange={e => setFamilyNote(e.target.value)} rows={4}
                    placeholder="e.g. Great progress on scales this week — keep practicing the left hand."
                    className="ui-input" style={{ resize: 'vertical' }} />

                  {/* Attach media for the family (recordings, sheet music, photos) */}
                  <div className="mt-2">
                    <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer px-2.5 py-1.5 rounded-lg border hover:bg-[var(--surf)]"
                      style={{ borderColor: 'var(--bd2)', color: 'var(--txt3)' }}>
                      <Paperclip size={13} /> Attach media
                      <input type="file" multiple className="hidden"
                        onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
                    </label>
                    {attachments.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {attachments.map(a => (
                          <div key={a.localId} className="flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5"
                            style={{ background: 'var(--surf)', color: 'var(--txt3)' }}>
                            <FileText size={13} className="shrink-0" />
                            <span className="truncate flex-1">{a.name}</span>
                            {a.error ? <span className="text-[var(--coral)] shrink-0">{a.error}</span>
                              : !a.fileId ? <span className="text-[var(--txt4)] shrink-0">Uploading…</span>
                              : <Check size={13} className="text-[var(--sage-dk)] shrink-0" />}
                            <button type="button" onClick={() => removeAttachment(a.localId)} className="shrink-0 hover:text-[var(--coral)]">
                              <XIcon size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="ui-label flex items-center gap-1.5">
                    <Lock size={13} /> Notes for staff
                  </label>
                  <p className="text-xs mb-1.5" style={{ color: 'var(--txt4)' }}>Internal observations, not shown to the family.</p>
                  <textarea value={internalNote} onChange={e => setInternalNote(e.target.value)} rows={4}
                    placeholder="e.g. Struggling with rhythm — flag for the next staff meeting."
                    className="ui-input" style={{ resize: 'vertical' }} />
                </div>
              </div>

              <div className="mt-4">
                <button onClick={saveNotes} disabled={saving || !canSave}
                  className="ui-btn-primary">
                  {saving ? 'Saving…' : uploadsPending ? 'Uploading…' : 'Save note(s)'}
                </button>
              </div>
            </div>

            {/* Two columns, not one interleaved list with a badge. What the
                family can read and what stays inside the studio are different
                kinds of record, and mixing them made it easy to skim the badge
                and write the wrong thing in the wrong place. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {([
                { key: 'family' as const, title: 'Shared with the family', hint: 'Visible to parents, and to the student in their own portal.' },
                { key: 'internal' as const, title: 'Staff only', hint: 'Never leaves the studio. Not visible to families or students.' },
              ]).map(col => {
                // Fail CLOSED on an unexpected visibility. Prod has a note
                // stored as "PUBLIC_EVERYONE" — outside the ['internal','family']
                // enum, written outside the API (the DTO validates it). With a
                // strict equality check on both columns that note appeared in
                // neither and looked deleted. Anything that isn't exactly
                // 'family' is treated as staff-only, never the reverse.
                const rows = col.key === 'family'
                  ? notes.filter(n => n.visibility === 'family')
                  : notes.filter(n => n.visibility !== 'family');
                return (
                  <div key={col.key}>
                    <p className="text-xs font-bold uppercase tracking-widest text-[var(--txt4)] mb-1">
                      {col.title} ({rows.length})
                    </p>
                    <p className="text-[11px] mb-3" style={{ color: 'var(--txt4)' }}>{col.hint}</p>
                    {rows.length === 0 ? (
                      <p className="text-sm" style={{ color: 'var(--txt4)' }}>
                        {col.key === 'family' ? 'Nothing shared with this family yet.' : 'No staff-only notes for this student.'}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {rows.map(n => (
                          <div key={n.id} className="bg-white rounded-xl border border-[var(--bd)] p-4">
                            <div className="flex items-center justify-between gap-3 mb-1.5">
                              <span className="text-xs font-semibold" style={{ color: 'var(--txt3)' }}>
                                {n.authorName ?? n.author?.email?.split('@')[0] ?? 'Studio'}
                              </span>
                              <span className="text-xs" style={{ color: 'var(--txt4)' }}>
                                {new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--txt)' }}>{linkify(n.body)}</p>
                            {n.attachments && n.attachments.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {n.attachments.map(a => (
                                  <button key={a.fileId} onClick={() => downloadAttachment(a.fileId)}
                                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border hover:bg-[var(--surf)]"
                                    style={{ borderColor: 'var(--bd2)', color: 'var(--txt3)' }}>
                                    <Download size={12} /> <span className="truncate max-w-[160px]">{a.name}</span>
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
              })}
            </div>
          </div>
        )}

        {!studentId && (
          <div className="bg-white rounded-2xl border border-[var(--bd)] px-6 py-12 text-center">
            <p className="text-[var(--txt3)]">Select a student to view or add notes.</p>
          </div>
        )}
      </div>
    </div>
  );
}
