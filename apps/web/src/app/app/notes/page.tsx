'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { SearchableSelect } from '@/components/searchable-select';
import { linkify } from '@/lib/linkify';
import { Lock, Users } from 'lucide-react';

interface Student { id: string; firstName: string; lastName: string; }
interface Lesson { id: string; startsAt: string; duration: number; enrollment: { instrument: string } | null; }
interface Note {
  id: string; body: string; visibility: 'internal' | 'family'; createdAt: string; lessonId: string | null;
  student: { id: string; firstName: string; lastName: string } | null;
  author: { id: string; email: string } | null;
}

function getRoleFromToken(token?: string): string {
  try {
    if (!token) return '';
    const payload = JSON.parse(atob(token.split('.')[1]!));
    return payload.role ?? '';
  } catch { return ''; }
}

export default function NotesPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState('');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lessonId, setLessonId] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [familyNote, setFamilyNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [isTeacher, setIsTeacher] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    setIsTeacher(getRoleFromToken(tok()) === 'teacher');
    apiFetch<Student[]>('/students', { token: tok() }).then(setStudents).catch(() => {});
  }, []);

  function loadNotes(forStudentId: string) {
    apiFetch<Note[]>(`/notes?studentId=${forStudentId}`, { token: tok() })
      .then(rows => setNotes(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))))
      .catch(() => setNotes([]));
  }

  useEffect(() => {
    setLessonId(''); setFamilyNote(''); setInternalNote(''); setError('');
    if (!studentId) { setLessons([]); setNotes([]); return; }
    loadNotes(studentId);
    apiFetch<Lesson[]>(`/lessons?studentId=${studentId}`, { token: tok() })
      .then(rows => setLessons(
        rows.filter(l => new Date(l.startsAt) <= new Date())
          .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
          .slice(0, 8),
      ))
      .catch(() => setLessons([]));
  }, [studentId]);

  async function saveNotes() {
    if (!studentId || (!familyNote.trim() && !internalNote.trim())) return;
    setSaving(true); setError('');
    try {
      if (familyNote.trim()) {
        await apiFetch('/notes', {
          method: 'POST', token: tok(),
          body: JSON.stringify({ studentId, lessonId: lessonId || undefined, body: familyNote.trim(), visibility: 'family' }),
        });
      }
      if (internalNote.trim()) {
        await apiFetch('/notes', {
          method: 'POST', token: tok(),
          body: JSON.stringify({ studentId, lessonId: lessonId || undefined, body: internalNote.trim(), visibility: 'internal' }),
        });
      }
      setFamilyNote(''); setInternalNote('');
      loadNotes(studentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Lesson Notes" subtitle={isTeacher ? 'Notes for your students' : 'Notes across the studio'} />

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
                    <Users size={13} /> Family note
                  </label>
                  <p className="text-xs mb-1.5" style={{ color: 'var(--txt4)' }}>Visible to the family on their portal.</p>
                  <textarea value={familyNote} onChange={e => setFamilyNote(e.target.value)} rows={4}
                    placeholder="e.g. Great progress on scales this week — keep practicing the left hand."
                    className="ui-input" style={{ resize: 'vertical' }} />
                </div>
                <div>
                  <label className="ui-label flex items-center gap-1.5">
                    <Lock size={13} /> Private note
                  </label>
                  <p className="text-xs mb-1.5" style={{ color: 'var(--txt4)' }}>Staff only — never shown to the family.</p>
                  <textarea value={internalNote} onChange={e => setInternalNote(e.target.value)} rows={4}
                    placeholder="e.g. Struggling with rhythm — flag for the next staff meeting."
                    className="ui-input" style={{ resize: 'vertical' }} />
                </div>
              </div>

              <div className="mt-4">
                <button onClick={saveNotes} disabled={saving || (!familyNote.trim() && !internalNote.trim())}
                  className="ui-btn-primary">
                  {saving ? 'Saving…' : 'Save note(s)'}
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--txt4)] mb-3">
                History ({notes.length})
              </p>
              {notes.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--txt4)' }}>No notes yet for this student.</p>
              ) : (
                <div className="space-y-2">
                  {notes.map(n => (
                    <div key={n.id} className="bg-white rounded-xl border border-[var(--bd)] p-4">
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <Badge variant={n.visibility}>{n.visibility === 'family' ? 'Family' : 'Private'}</Badge>
                        <span className="text-xs" style={{ color: 'var(--txt4)' }}>
                          {new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {n.author?.email && ` · ${n.author.email}`}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--txt)' }}>{linkify(n.body)}</p>
                    </div>
                  ))}
                </div>
              )}
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
