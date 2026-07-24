'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { PRIVATE_INSTRUMENTS, GROUP_INSTRUMENTS, WEEKDAYS, lessonRate } from '@music-life/types';
import { SearchableSelect } from '@/components/searchable-select';
import { BackButton } from '@/components/back-button';

interface StudentDetail {
  id: string; firstName: string; lastName: string; status: string;
  dob: string | null; email: string | null; notes: string | null;
  family: { id: string; name: string; phone: string | null; email: string | null } | null;
  enrollments: {
    id: string; instrument: string; lessonType: string; status: string; rate: number;
    defaultDuration: number;
    teacher: { id: string; firstName: string; lastName: string } | null;
    term: { id: string; name: string; status: string } | null;
    scheduleRule: { weekday: string; startTime: string } | null;
  }[];
}
interface StaffMember { id: string; firstName: string; lastName: string; }
interface Term { id: string; name: string; status: string; }
interface LessonNote {
  id: string; body: string; visibility: 'internal' | 'family'; createdAt: string;
  author: { id: string; email: string } | null;
}

function AddEnrollmentModal({ open, onClose, studentId, onCreated }: { open: boolean; onClose: () => void; studentId: string; onCreated: () => void }) {
  const [lessonType, setLessonType] = useState<'private' | 'group'>('private');
  const [duration, setDuration] = useState(60);
  const [instrument, setInstrument] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [termId, setTermId] = useState('');
  const [weekday, setWeekday] = useState('');
  const [enrollStatus, setEnrollStatus] = useState('active');
  const autoRate = (lessonRate(lessonType, duration) / 100).toFixed(2);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ created: number; through: string } | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Cached picker options — only fetched once the modal is open.
  const { data: staff = [] } = useApi<StaffMember[]>(open ? '/staff' : null);
  const { data: terms = [] } = useApi<Term[]>(open ? '/terms' : null);

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setInstrument(''); setTeacherId(''); setWeekday(''); setEnrollStatus('active'); setError(''); setResult(null);
  }, [open]);

  // Default to the active term once terms load (don't clobber a manual choice).
  useEffect(() => {
    if (!termId) {
      const active = terms.find((t: Term) => t.status === 'active');
      if (active) setTermId(active.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms]);

  const instruments = lessonType === 'private' ? PRIVATE_INSTRUMENTS : GROUP_INSTRUMENTS;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    const startTime = (f.get('startTime') as string) || '';
    const hasSchedule = !!weekday && !!startTime;
    try {
      const enrollment = await apiFetch<{ id: string }>(`/students/${studentId}/enrollments`, { method: 'POST', token: tok(), body: JSON.stringify({
        termId: termId || undefined, instrument, lessonType,
        duration,
        teacherId: teacherId || undefined,
        rate: lessonRate(lessonType, duration),
        scheduleRule: hasSchedule ? { weekday, startTime } : undefined,
        autoRenew: f.get('autoRenew') === 'on', status: enrollStatus,
      })});
      onCreated();
      // A weekly schedule was set → materialise the upcoming lessons now so they
      // appear on the calendar immediately, and show how many were booked.
      if (hasSchedule) {
        const r = await apiFetch<{ created: number; through: string }>('/lessons/recurring', {
          method: 'POST', token: tok(), body: JSON.stringify({ enrollmentId: enrollment.id }),
        });
        setResult({ created: r.created, through: r.through });
      } else {
        onClose();
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add enrollment">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      {result ? (
        <div className="space-y-4">
          <div className="rounded-xl px-4 py-4 text-sm"
            style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)', border: '1px solid var(--sage)' }}>
            <p className="font-bold text-base mb-1">Enrollment added ✓</p>
            {result.created > 0 ? (
              <p>Booked <strong>{result.created}</strong> weekly lesson{result.created !== 1 ? 's' : ''} through{' '}
                {new Date(result.through).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
                They’re on the calendar now.</p>
            ) : (
              <p>No new lessons were booked (they may already exist for this schedule).</p>
            )}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="ui-btn-primary">Done</button>
          </div>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Lesson type</label>
            <div className="flex gap-4 mt-2">
              {(['private', 'group'] as const).map(t => (
                <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="radio" checked={lessonType === t} onChange={() => { setLessonType(t); setDuration(60); setInstrument(''); }}
                    style={{ accentColor: 'var(--sage)' }} />
                  <span className="capitalize">{t}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="ui-label">Duration</label>
            <SearchableSelect
              options={lessonType === 'private'
                ? [30,45,60].map(d => ({ value: String(d), label: `${d} min — ${formatMoney(lessonRate('private',d))}` }))
                : [{ value: '60', label: `60 min — ${formatMoney(lessonRate('group',60))}` }]
              }
              value={String(duration)}
              onChange={v => setDuration(parseInt(v))}
              disabled={lessonType === 'group'}
            />
          </div>
        </div>
        <div>
          <label className="ui-label">Instrument <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={instruments.map(i => ({ value: i, label: i.charAt(0).toUpperCase() + i.slice(1) }))}
            value={instrument} onChange={setInstrument} placeholder="Select…"
          />
        </div>
        <div>
          <label className="ui-label">Teacher</label>
          <SearchableSelect
            options={staff.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            value={teacherId} onChange={setTeacherId} emptyLabel="Unassigned"
          />
        </div>
        <div>
          <label className="ui-label">Term</label>
          <SearchableSelect
            options={terms.map(t => ({ value: t.id, label: `${t.name}${t.status === 'active' ? ' ✓ active' : ''}` }))}
            value={termId} onChange={setTermId} emptyLabel="No term"
          />
        </div>
        <div>
          <label className="ui-label">Rate (£ per lesson)</label>
          <div className="flex items-center gap-2">
            <input name="rate" type="number" min="0" step="0.01" value={autoRate}
              onChange={() => {}} readOnly className="ui-input" />
            <span className="text-xs whitespace-nowrap" style={{ color: 'var(--txt4)' }}>auto from T&amp;Cs</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Day</label>
            <SearchableSelect
              options={WEEKDAYS.map(d => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) }))}
              value={weekday} onChange={setWeekday} emptyLabel="Not set"
            />
          </div>
          <div>
            <label className="ui-label">Start time</label>
            <input name="startTime" type="time" className="ui-input" />
          </div>
        </div>
        <div>
          <label className="ui-label">Status</label>
          <SearchableSelect
            options={[
              { value: 'trial', label: 'Trial' },
              { value: 'active', label: 'Active' },
              { value: 'paused', label: 'Paused' },
            ]}
            value={enrollStatus} onChange={setEnrollStatus}
          />
        </div>
        <div className="flex items-center gap-2">
          <input name="autoRenew" type="checkbox" defaultChecked id="autoRenew"
            className="h-4 w-4 rounded" style={{ accentColor: 'var(--sage)' }} />
          <label htmlFor="autoRenew" className="text-sm" style={{ color: 'var(--txt2)' }}>Auto-renew into next term</label>
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : 'Add enrollment'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
      )}
    </Modal>
  );
}

type EnrollmentRow = StudentDetail['enrollments'][number];

// Edit an EXISTING enrollment's teacher, rate and lesson length. Registration
// creates enrollments with a flat £45 and no teacher, and the row itself only
// let you change status — so this is the one place to fix the rate, assign or
// change the teacher, and set a group's price/duration after the fact.
function EditEnrollmentModal({ open, onClose, enrollment, onSaved }: {
  open: boolean; onClose: () => void; enrollment: EnrollmentRow | null; onSaved: () => void;
}) {
  const [teacherId, setTeacherId] = useState('');
  const [rateText, setRateText] = useState('');
  const [duration, setDuration] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const { data: staff = [] } = useApi<StaffMember[]>(open ? '/staff' : null);

  // Load the enrollment's current values whenever the modal opens on a row.
  useEffect(() => {
    if (!open || !enrollment) return;
    setTeacherId(enrollment.teacher?.id ?? '');
    setRateText((enrollment.rate / 100).toFixed(2));
    setDuration(enrollment.defaultDuration ?? 60);
    setError('');
  }, [open, enrollment]);

  async function save() {
    const pence = Math.round(parseFloat(rateText) * 100);
    if (!Number.isFinite(pence) || pence < 0) { setError('Enter a valid rate.'); return; }
    if (!Number.isInteger(duration) || duration < 5 || duration > 240) { setError('Duration must be 5–240 minutes.'); return; }
    if (!enrollment) return;
    setSaving(true); setError('');
    try {
      await apiFetch(`/enrollments/${enrollment.id}`, {
        method: 'PATCH', token: tok(),
        body: JSON.stringify({ teacherId: teacherId || null, rate: pence, duration }),
      });
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={enrollment ? `Edit ${enrollment.instrument} enrollment` : 'Edit enrollment'}>
      {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      <div className="space-y-4">
        <div>
          <label className="ui-label">Teacher</label>
          <SearchableSelect
            options={staff.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            value={teacherId} onChange={setTeacherId} emptyLabel="Unassigned" placeholder="Unassigned"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Rate (£)</label>
            <input type="number" step="0.01" min="0" value={rateText}
              onChange={e => setRateText(e.target.value)} className="ui-input w-full" />
          </div>
          <div>
            <label className="ui-label">Duration (min)</label>
            <input type="number" step="5" min="5" max="240" value={duration}
              onChange={e => setDuration(parseInt(e.target.value || '0', 10))} className="ui-input w-full" />
          </div>
        </div>
        <p className="text-xs" style={{ color: 'var(--txt4)' }}>
          The rate is what the family is charged for this enrollment; a lesson of a different length is prorated against the duration.
          {enrollment?.lessonType === 'group' && ' For a group class, this is the set price and length.'}
        </p>
        <div className="flex gap-3 pt-1">
          <button onClick={save} disabled={saving} className="ui-btn-primary">{saving ? 'Saving…' : 'Save changes'}</button>
          <button onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

function LessonNotes({ studentId }: { studentId: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const [familyNote, setFamilyNote] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Cached read keyed on the student — instant on revisit. load() refreshes
  // after adding a note.
  const { data: notes = [], mutate } = useApi<LessonNote[]>(`/notes?studentId=${studentId}`);
  const load = () => mutate();

  async function handleSave() {
    if (!familyNote.trim() && !privateNote.trim()) return;
    setSaving(true);
    try {
      const t = tok();
      if (familyNote.trim()) {
        await apiFetch('/notes', { method: 'POST', token: t, body: JSON.stringify({ studentId, body: familyNote.trim(), visibility: 'family' }) });
      }
      if (privateNote.trim()) {
        await apiFetch('/notes', { method: 'POST', token: t, body: JSON.stringify({ studentId, body: privateNote.trim(), visibility: 'internal' }) });
      }
      setFamilyNote(''); setPrivateNote(''); setShowAdd(false);
      load();
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Lesson notes</h2>
        <button onClick={() => setShowAdd(v => !v)} className="ui-btn-ghost text-xs px-3 py-1.5">
          {showAdd ? 'Cancel' : '+ Add note'}
        </button>
      </div>

      {showAdd && (
        <div className="space-y-3 mb-4 pb-4 border-b" style={{ borderColor: 'var(--bd)' }}>
          <div>
            <label className="ui-label">Family note <span style={{ color: 'var(--txt4)' }}>(visible to family)</span></label>
            <textarea value={familyNote} onChange={e => setFamilyNote(e.target.value)} rows={2}
              className="ui-input w-full" placeholder="Progress, practice tips, what to work on next…" />
          </div>
          <div>
            <label className="ui-label">Private note <span style={{ color: 'var(--txt4)' }}>(staff only)</span></label>
            <textarea value={privateNote} onChange={e => setPrivateNote(e.target.value)} rows={2}
              className="ui-input w-full" placeholder="Internal observations, not shown to family…" />
          </div>
          <button onClick={handleSave} disabled={saving} className="ui-btn-primary text-xs px-3 py-1.5">
            {saving ? 'Saving…' : 'Save note(s)'}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {notes.length === 0 && !showAdd && (
          <p className="text-sm text-center py-2" style={{ color: 'var(--txt4)' }}>No lesson notes yet.</p>
        )}
        {notes.map(n => (
          <div key={n.id} className="flex items-start gap-2">
            <span className={`shrink-0 mt-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${n.visibility === 'family' ? 'bg-[var(--sage-lt)] text-[var(--sage-dk)]' : 'bg-[var(--surf)] text-[var(--txt3)]'}`}>
              {n.visibility === 'family' ? 'Family' : 'Internal'}
            </span>
            <div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--txt2)' }}>{n.body}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--txt4)' }}>
                {new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [showEnroll, setShowEnroll] = useState(false);
  const [editEnrollment, setEditEnrollment] = useState<EnrollmentRow | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Cached read — instant on revisit. load() refreshes after an edit/enrollment.
  const { data: student = null, mutate } = useApi<StudentDetail>(`/students/${id}`);
  const load = () => mutate();

  async function changeEnrollmentStatus(enrollmentId: string, status: string) {
    try { await apiFetch(`/enrollments/${enrollmentId}`, { method: 'PATCH', token: tok(), body: JSON.stringify({ status }) }); load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Could not update enrollment'); }
  }

  async function stopWeekly(enrollmentId: string) {
    if (!confirm('Stop the weekly lessons for this enrollment? Future scheduled lessons will be cancelled at no charge. Past lessons are unaffected.')) return;
    try {
      const res = await apiFetch<{ cancelledLessons: number }>(`/enrollments/${enrollmentId}/stop-recurring`, { method: 'POST', token: tok() });
      load();
      alert(`Weekly lessons stopped. ${res.cancelledLessons} upcoming lesson${res.cancelledLessons !== 1 ? 's' : ''} cancelled.`);
    } catch (e) { alert(e instanceof Error ? e.message : 'Could not stop the series'); }
  }

  if (!student) return <div className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>Loading…</div>;

  return (
    <div>
      <AddEnrollmentModal open={showEnroll} onClose={() => setShowEnroll(false)} studentId={id} onCreated={load} />
      <EditEnrollmentModal open={!!editEnrollment} onClose={() => setEditEnrollment(null)} enrollment={editEnrollment} onSaved={load} />

      <div className="mb-5">
        <BackButton label="Students" fallbackHref="/app/students" />
      </div>

      <PageHeader title={`${student.firstName} ${student.lastName}`} subtitle={student.family?.name}
        action={<Badge variant={student.status}>{student.status}</Badge>} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <h2 className="font-bold mb-4 text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Profile</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Date of birth</dt>
                <dd className="font-medium">{student.dob ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Email</dt>
                <dd className="font-medium">{student.email ?? '—'}</dd>
              </div>
            </dl>
          </div>
          {student.family && (
            <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
              <h2 className="font-bold mb-4 text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Family</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt style={{ color: 'var(--txt3)' }}>Name</dt>
                  <dd><Link href={`/app/families/${student.family.id}`}
                    className="font-semibold hover:underline" style={{ color: 'var(--sage-dk)' }}>
                    {student.family.name}
                  </Link></dd>
                </div>
                {student.family.phone && (
                  <div className="flex justify-between gap-3">
                    <dt style={{ color: 'var(--txt3)' }}>Phone</dt>
                    <dd className="font-medium">{student.family.phone}</dd>
                  </div>
                )}
                {student.family.email && (
                  <div className="flex justify-between gap-3">
                    <dt style={{ color: 'var(--txt3)' }}>Email</dt>
                    <dd className="font-medium">{student.family.email}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          {student.notes && (
            <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
              <h2 className="font-bold mb-3 text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Profile notes</h2>
              <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--txt2)' }}>{student.notes}</p>
            </div>
          )}
          <LessonNotes studentId={id} />
        </div>

        <div className="lg:col-span-2">
          <div className="data-table-wrap overflow-hidden">
            <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
              <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Enrollments</h2>
              <button onClick={() => setShowEnroll(true)} className="ui-btn-primary text-xs px-3 py-1.5">
                + Add enrollment
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Type</th>
                  <th>Teacher</th>
                  <th>Term</th>
                  <th>Rate</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {student.enrollments.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                    No enrollments yet.
                  </td></tr>
                )}
                {student.enrollments.map(e => (
                  <tr key={e.id}>
                    <td className="capitalize font-medium">
                      {e.instrument}
                      {e.scheduleRule && (
                        <span className="ml-2 text-[11px] font-semibold rounded-full px-2 py-0.5"
                          style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)' }}>
                          weekly {e.scheduleRule.weekday.slice(0, 3)} {e.scheduleRule.startTime}
                        </span>
                      )}
                    </td>
                    <td className="capitalize" style={{ color: 'var(--txt3)' }}>{e.lessonType}</td>
                    <td>
                      {e.teacher
                        ? <Link href={`/app/staff/${e.teacher.id}`} className="hover:underline font-medium" style={{ color: 'var(--sage-dk)' }}>
                            {e.teacher.firstName} {e.teacher.lastName}
                          </Link>
                        : '—'}
                    </td>
                    <td style={{ color: 'var(--txt3)' }}>{e.term?.name ?? '—'}</td>
                    <td className="font-medium">{formatMoney(e.rate)}</td>
                    <td><Badge variant={e.status}>{e.status}</Badge></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setEditEnrollment(e)}
                          className="text-xs font-semibold hover:underline" style={{ color: 'var(--sage-dk)' }}
                          title="Edit teacher, rate and duration">
                          Edit
                        </button>
                        <select value={e.status} onChange={ev => changeEnrollmentStatus(e.id, ev.target.value)}
                          className="text-xs border rounded-lg px-2 py-1" style={{ borderColor: 'var(--bd2)' }}
                          title="Change enrollment status">
                          <option value="active">Active</option>
                          <option value="trial">Trial</option>
                          <option value="paused">Paused</option>
                          <option value="withdrawn">Withdrawn</option>
                        </select>
                        {e.scheduleRule && (
                          <button onClick={() => stopWeekly(e.id)}
                            className="text-xs font-semibold hover:underline" style={{ color: 'var(--coral)' }}>
                            Stop weekly
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
