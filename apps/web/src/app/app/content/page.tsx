'use client';

import { useState, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { LoadState } from '@/components/load-state';
import { SearchableSelect } from '@/components/searchable-select';
import { Modal } from '@/components/modal';
import { ALL_INSTRUMENTS } from '@music-life/types';
import { Plus, Trash2 } from 'lucide-react';

type Status = 'learning' | 'polishing' | 'performance_ready' | 'completed';

interface Piece {
  id: string; title: string; composer: string | null; instrument: string | null;
  status: Status; notes: string | null; assignedAt: string; updatedAt: string;
  student: { id: string; firstName: string; lastName: string } | null;
  teacher: { id: string; firstName: string; lastName: string } | null;
}
interface Student { id: string; firstName: string; lastName: string; }

// Ordered as the work actually progresses, so the columns read left to right.
const COLUMNS: { key: Status; label: string; hint: string }[] = [
  { key: 'learning', label: 'Learning', hint: 'Just started' },
  { key: 'polishing', label: 'Polishing', hint: 'Notes are there, refining it' },
  { key: 'performance_ready', label: 'Performance ready', hint: 'Could play it today' },
  { key: 'completed', label: 'Completed', hint: 'Finished and put away' },
];

const NEXT: Partial<Record<Status, Status>> = {
  learning: 'polishing',
  polishing: 'performance_ready',
  performance_ready: 'completed',
};

export default function ContentPage() {
  const [studentId, setStudentId] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  const { data: studentData } = useApi<{ data: Student[] } | Student[]>('/students?limit=200&offset=0');
  const students: Student[] = Array.isArray(studentData) ? studentData : (studentData?.data ?? []);

  const key = studentId ? `/repertoire?studentId=${studentId}` : '/repertoire';
  const { data: pieces = [], error, isLoading, mutate } = useApi<Piece[]>(key);

  async function addPiece(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setAddError('');
    const f = new FormData(e.currentTarget);
    const target = (f.get('studentId') as string) || studentId;
    if (!target) { setAddError('Choose a student first.'); return; }
    setSaving(true);
    try {
      await apiFetch('/repertoire', {
        method: 'POST', token: tok(),
        body: JSON.stringify({
          studentId: target,
          title: f.get('title'),
          composer: (f.get('composer') as string) || undefined,
          instrument: (f.get('instrument') as string) || undefined,
          notes: (f.get('notes') as string) || undefined,
        }),
      });
      setShowAdd(false);
      mutate();
    } catch (err) { setAddError(err instanceof Error ? err.message : 'Could not add the piece.'); }
    finally { setSaving(false); }
  }

  async function setStatus(id: string, status: Status) {
    // Optimistic — moving a piece along is the most common action on this page
    // and it shouldn't wait for a round trip.
    mutate(prev => (prev ?? []).map(p => p.id === id ? { ...p, status } : p), { revalidate: false });
    try {
      await apiFetch(`/repertoire/${id}`, { method: 'PATCH', token: tok(), body: JSON.stringify({ status }) });
    } finally { mutate(); }
  }

  async function remove(id: string) {
    // Permanent delete — confirm before optimistically dropping the row.
    if (!confirm('Remove this piece from the repertoire library? This can’t be undone.')) return;
    mutate(prev => (prev ?? []).filter(p => p.id !== id), { revalidate: false });
    try {
      await apiFetch(`/repertoire/${id}`, { method: 'DELETE', token: tok() });
    } finally { mutate(); }
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Repertoire
            <InfoTooltip text="What each student is working on. Move a piece along as it progresses — Learning, Polishing, Performance ready, Completed. Teachers see only their own students." />
          </span>
        }
        subtitle="What your students are working on"
        action={
          <button onClick={() => { setAddError(''); setShowAdd(true); }} className="ui-btn-primary">
            <Plus size={15} /> Add piece
          </button>
        }
      />

      <div className="mb-5 max-w-sm">
        <label className="ui-label">Student</label>
        <SearchableSelect
          options={[{ value: '', label: 'All students' }, ...students.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))]}
          value={studentId} onChange={setStudentId} placeholder="All students"
        />
      </div>

      {(error || isLoading) && (
        <div className="bg-white rounded-2xl border p-6" style={{ borderColor: 'var(--bd)' }}>
          <LoadState error={error} loading={isLoading} onRetry={() => mutate()} failedLabel="Couldn't load repertoire." />
        </div>
      )}

      {!error && !isLoading && pieces.length === 0 && (
        <div className="bg-white rounded-2xl border px-6 py-12 text-center" style={{ borderColor: 'var(--bd)' }}>
          <p className="text-sm" style={{ color: 'var(--txt3)' }}>No pieces assigned yet.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--txt4)' }}>Add one to start tracking what a student is working on.</p>
        </div>
      )}

      {!error && pieces.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map(col => {
            const rows = pieces.filter(p => p.status === col.key);
            return (
              <div key={col.key}>
                <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--txt3)' }}>
                  {col.label} ({rows.length})
                </p>
                <p className="text-[11px] mb-2.5" style={{ color: 'var(--txt4)' }}>{col.hint}</p>
                <div className="space-y-2">
                  {rows.length === 0 && (
                    <p className="text-xs py-3" style={{ color: 'var(--txt4)' }}>Nothing here.</p>
                  )}
                  {rows.map(p => (
                    <div key={p.id} className="bg-white rounded-xl border p-3.5" style={{ borderColor: 'var(--bd)' }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate" style={{ color: 'var(--txt)' }}>{p.title}</p>
                          {p.composer && <p className="text-xs truncate" style={{ color: 'var(--txt3)' }}>{p.composer}</p>}
                        </div>
                        <button onClick={() => remove(p.id)} aria-label={`Remove ${p.title}`}
                          className="shrink-0 text-[var(--txt4)] hover:text-[var(--coral)] transition-colors p-0.5">
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {!studentId && p.student && (
                        <p className="text-xs mt-1.5" style={{ color: 'var(--txt4)' }}>
                          {p.student.firstName} {p.student.lastName}
                          {p.instrument ? ` · ${p.instrument}` : ''}
                        </p>
                      )}
                      {p.notes && <p className="text-xs mt-1.5 whitespace-pre-wrap" style={{ color: 'var(--txt3)' }}>{p.notes}</p>}
                      {NEXT[p.status] && (
                        <button onClick={() => setStatus(p.id, NEXT[p.status]!)}
                          className="mt-2.5 w-full text-xs font-semibold rounded-lg border py-1.5 hover:bg-[var(--surf)]"
                          style={{ borderColor: 'var(--bd2)', color: 'var(--txt)' }}>
                          Move to {COLUMNS.find(c => c.key === NEXT[p.status])!.label.toLowerCase()}
                        </button>
                      )}
                      {p.status === 'completed' && (
                        <button onClick={() => setStatus(p.id, 'polishing')}
                          className="mt-2.5 w-full text-xs font-semibold rounded-lg border py-1.5 hover:bg-[var(--surf)]"
                          style={{ borderColor: 'var(--bd2)', color: 'var(--txt3)' }}>
                          Bring back to polishing
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add a piece">
        <form onSubmit={addPiece} className="space-y-4">
          {addError && <p className="text-sm" style={{ color: 'var(--coral)' }}>{addError}</p>}
          <div>
            <label className="ui-label">Student <span style={{ color: 'var(--coral)' }}>*</span></label>
            <select name="studentId" defaultValue={studentId} required className="ui-input">
              <option value="">Select student…</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
            </select>
          </div>
          <div>
            <label className="ui-label">Title <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="title" required maxLength={200} placeholder="Minuet in G" className="ui-input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label">Composer</label>
              <input name="composer" maxLength={200} placeholder="Bach" className="ui-input" />
            </div>
            <div>
              <label className="ui-label">Instrument</label>
              <select name="instrument" className="ui-input">
                <option value="">—</option>
                {ALL_INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="ui-label">Notes</label>
            <textarea name="notes" rows={3} maxLength={2000}
              placeholder="Hands separately to bar 16 first." className="ui-input" style={{ resize: 'vertical' }} />
          </div>
          <button type="submit" disabled={saving} className="ui-btn-primary w-full justify-center">
            {saving ? 'Saving…' : 'Add piece'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
