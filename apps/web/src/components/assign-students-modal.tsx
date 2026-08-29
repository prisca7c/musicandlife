'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { Modal } from '@/components/modal';
import { SearchableSelect } from '@/components/searchable-select';
import { Check, Search, Loader2 } from 'lucide-react';

interface StaffMember { id: string; firstName: string; lastName: string; }
interface Student { id: string; firstName: string; lastName: string; family?: { name: string; contactName?: string | null } | null; }
interface StaffDetail { assignments: { student: { id: string } }[] }

/**
 * Visual "Assign students" editor. Pick a teacher, then toggle students on/off —
 * each toggle persists immediately (POST/DELETE /staff/:id/assignments), the same
 * optimistic pattern as the instrument editor. Already-assigned students show a
 * filled check.
 */
export function AssignStudentsModal({ open, onClose, onChanged, teachers, defaultTeacherId }: {
  open: boolean; onClose: () => void; onChanged?: () => void;
  teachers: StaffMember[]; defaultTeacherId?: string;
}) {
  const [teacherId, setTeacherId] = useState(defaultTeacherId ?? '');
  const [students, setStudents] = useState<Student[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Load the full student roster once when the modal opens.
  useEffect(() => {
    if (!open) return;
    setTeacherId(defaultTeacherId ?? ''); setSearch(''); setError('');
    // No pagination params → the API returns the full roster in one array
    // (studios/students.service.ts:findAll). A `?limit=500` here used to get
    // silently clamped to the API's 200-row page cap and switched into the
    // paginated {data,total} shape, so any studio with more than 200 students
    // lost everyone past the 200th from this picker with no error shown.
    apiFetch<Student[]>('/students', { token: tok() })
      .then(setStudents)
      .catch(() => {});
  }, [open, defaultTeacherId]);

  // Whenever the selected teacher changes, load their current assignments.
  useEffect(() => {
    if (!open || !teacherId) { setAssigned(new Set()); return; }
    setLoading(true); setError('');
    apiFetch<StaffDetail>(`/staff/${teacherId}`, { token: tok() })
      .then(d => setAssigned(new Set(d.assignments.map(a => a.student.id))))
      .catch(() => setError('Could not load this teacher’s students'))
      .finally(() => setLoading(false));
  }, [open, teacherId]);

  async function toggle(studentId: string) {
    if (!teacherId || busy) return;
    const isOn = assigned.has(studentId);
    setBusy(studentId); setError('');
    // Optimistic update, rolled back on failure.
    const next = new Set(assigned);
    if (isOn) next.delete(studentId); else next.add(studentId);
    setAssigned(next);
    try {
      if (isOn) {
        await apiFetch(`/staff/${teacherId}/assignments/${studentId}`, { method: 'DELETE', token: tok() });
      } else {
        await apiFetch(`/staff/${teacherId}/assignments`, {
          method: 'POST', token: tok(), body: JSON.stringify({ studentId }),
        });
      }
      onChanged?.();
    } catch (err) {
      setAssigned(assigned); // rollback
      setError(err instanceof Error ? err.message : 'Could not update assignment');
    } finally { setBusy(null); }
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? students.filter(s => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q)
        || (s.family?.contactName || s.family?.name || '').toLowerCase().includes(q))
    : students;

  return (
    <Modal open={open} onClose={onClose} title="Assign students to a teacher">
      <div className="space-y-4">
        <div>
          <label className="ui-label">Teacher <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={teachers.map(t => ({ value: t.id, label: `${t.firstName} ${t.lastName}` }))}
            value={teacherId} onChange={setTeacherId} placeholder="Select a teacher…"
          />
        </div>

        {error && (
          <div className="text-sm rounded-xl px-4 py-3"
            style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
            {error}
          </div>
        )}

        {teacherId && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold" style={{ color: 'var(--txt2)' }}>
                {assigned.size} assigned
              </p>
              <div className="relative w-48">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--txt4)' }}>
                  <Search size={14} />
                </span>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Filter students…" className="ui-search pl-8 text-sm py-1.5" />
              </div>
            </div>

            <div className="rounded-xl border overflow-y-auto" style={{ borderColor: 'var(--bd)', maxHeight: 320 }}>
              {loading ? (
                <p className="p-6 text-center text-sm flex items-center justify-center gap-2" style={{ color: 'var(--txt4)' }}>
                  <Loader2 size={15} className="animate-spin" /> Loading…
                </p>
              ) : filtered.length === 0 ? (
                <p className="p-6 text-center text-sm" style={{ color: 'var(--txt4)' }}>No students found.</p>
              ) : filtered.map(s => {
                const on = assigned.has(s.id);
                const isBusy = busy === s.id;
                return (
                  <button key={s.id} type="button" onClick={() => toggle(s.id)} disabled={isBusy}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left border-b last:border-b-0 transition-colors disabled:opacity-60"
                    style={{ borderColor: 'var(--bd)', background: on ? 'var(--sage-lt)' : '#fff' }}
                    onMouseOver={e => { if (!on) e.currentTarget.style.background = 'var(--surf)'; }}
                    onMouseOut={e => { if (!on) e.currentTarget.style.background = '#fff'; }}>
                    <span className="flex items-center justify-center rounded-md shrink-0 transition-colors"
                      style={{
                        width: 20, height: 20,
                        background: on ? 'var(--sage)' : '#fff',
                        border: `1.5px solid ${on ? 'var(--sage)' : 'var(--bd2)'}`,
                      }}>
                      {isBusy ? <Loader2 size={12} className="animate-spin" style={{ color: on ? '#fff' : 'var(--txt4)' }} />
                        : on ? <Check size={13} color="#fff" strokeWidth={3} /> : null}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate"
                        style={{ color: on ? 'var(--sage-dk)' : 'var(--txt)' }}>
                        {s.firstName} {s.lastName}
                      </span>
                      {(s.family?.contactName || s.family?.name) && (
                        <span className="block text-[11px] truncate" style={{ color: 'var(--txt4)' }}>{s.family.contactName || s.family.name}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px]" style={{ color: 'var(--txt4)' }}>
              Changes save as you toggle. Assigned students appear on the teacher’s dashboard and calendar.
            </p>
          </>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="ui-btn-primary">Done</button>
        </div>
      </div>
    </Modal>
  );
}
