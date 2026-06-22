'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
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
    teacher: { id: string; firstName: string; lastName: string } | null;
    term: { id: string; name: string; status: string } | null;
  }[];
}
interface StaffMember { id: string; firstName: string; lastName: string; }
interface Term { id: string; name: string; status: string; }

function AddEnrollmentModal({ open, onClose, studentId, onCreated }: { open: boolean; onClose: () => void; studentId: string; onCreated: () => void }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
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
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (!open) return;
    setInstrument(''); setTeacherId(''); setWeekday(''); setEnrollStatus('active'); setError('');
    const t = tok();
    Promise.all([
      apiFetch<StaffMember[]>('/staff', { token: t }).catch(() => []),
      apiFetch<Term[]>('/terms', { token: t }).catch(() => []),
    ]).then(([s, te]) => {
      setStaff(s); setTerms(te);
      const active = te.find((t: Term) => t.status === 'active');
      setTermId(active?.id ?? '');
    });
  }, [open]);

  const instruments = lessonType === 'private' ? PRIVATE_INSTRUMENTS : GROUP_INSTRUMENTS;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch(`/students/${studentId}/enrollments`, { method: 'POST', token: tok(), body: JSON.stringify({
        termId: termId || undefined, instrument, lessonType,
        duration,
        teacherId: teacherId || undefined,
        rate: lessonRate(lessonType, duration),
        scheduleRule: weekday ? { weekday, startTime: f.get('startTime') } : undefined,
        autoRenew: f.get('autoRenew') === 'on', status: enrollStatus,
      })});
      onCreated(); onClose();
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
                ? [30,45,60].map(d => ({ value: String(d), label: `${d} min — £${(lessonRate('private',d)/100).toFixed(2)}` }))
                : [{ value: '60', label: `60 min — £${(lessonRate('group',60)/100).toFixed(2)}` }]
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
    </Modal>
  );
}

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [showEnroll, setShowEnroll] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function load() {
    apiFetch<StudentDetail>(`/students/${id}`, { token: tok() }).then(setStudent).catch(() => setStudent(null));
  }

  useEffect(() => { load(); }, [id]);

  if (!student) return <div className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>Loading…</div>;

  return (
    <div>
      <AddEnrollmentModal open={showEnroll} onClose={() => setShowEnroll(false)} studentId={id} onCreated={load} />

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
              <h2 className="font-bold mb-3 text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Notes</h2>
              <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--txt2)' }}>{student.notes}</p>
            </div>
          )}
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
                </tr>
              </thead>
              <tbody>
                {student.enrollments.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                    No enrollments yet.
                  </td></tr>
                )}
                {student.enrollments.map(e => (
                  <tr key={e.id}>
                    <td className="capitalize font-medium">{e.instrument}</td>
                    <td className="capitalize" style={{ color: 'var(--txt3)' }}>{e.lessonType}</td>
                    <td>
                      {e.teacher
                        ? <Link href={`/app/staff/${e.teacher.id}`} className="hover:underline font-medium" style={{ color: 'var(--sage-dk)' }}>
                            {e.teacher.firstName} {e.teacher.lastName}
                          </Link>
                        : '—'}
                    </td>
                    <td style={{ color: 'var(--txt3)' }}>{e.term?.name ?? '—'}</td>
                    <td className="font-medium">£{(e.rate / 100).toFixed(2)}</td>
                    <td><Badge variant={e.status}>{e.status}</Badge></td>
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
