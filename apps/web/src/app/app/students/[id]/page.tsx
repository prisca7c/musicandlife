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
import { WEEKDAYS, lessonRate } from '@music-life/types';
import { useInstruments } from '@/lib/use-instruments';
import { SearchableSelect } from '@/components/searchable-select';
import { EditStudentModal } from '@/components/edit-student-modal';
import { EditFamilyModal } from '@/components/edit-family-modal';
import { EditEnrollmentModal } from '@/components/edit-enrollment-modal';
import { StudentCreditsCard } from '@/components/student-credits-card';
import { BackButton } from '@/components/back-button';
import { Mail, Phone } from 'lucide-react';
import { useRole } from '@/lib/use-role';

interface StudentDetail {
  id: string; firstName: string; lastName: string; status: string;
  dob: string | null; email: string | null; notes: string | null;
  family: { id: string; name: string; phone: string | null; email: string | null } | null;
  enrollments: {
    id: string; instrument: string; lessonType: string; status: string; rate: number;
    trialRate: number | null;
    defaultDuration: number;
    teacher: { id: string; firstName: string; lastName: string } | null;
    term: { id: string; name: string; status: string } | null;
    scheduleRule: { weekday: string; startTime: string } | null;
  }[];
}
interface StaffMember { id: string; firstName: string; lastName: string; instruments: string[]; }
interface Term { id: string; name: string; status: string; }

// Teachers who teach the selected instrument, per each teacher's own
// "Instruments taught" list. Falls back to the full staff list when nobody
// matches (an unconfigured/legacy teacher record) so admins are never left
// unable to assign anyone, and when no instrument is chosen yet.
function eligibleTeachers(staff: StaffMember[], instrument: string): StaffMember[] {
  if (!instrument) return staff;
  const matching = staff.filter(s => s.instruments?.includes(instrument));
  return matching.length > 0 ? matching : staff;
}
interface LessonNote {
  id: string; body: string; visibility: 'internal' | 'family'; createdAt: string;
  author: { id: string; email: string } | null;
}
interface HistoryLesson {
  id: string; startsAt: string; duration: number; status: string;
  teacher: { id: string; firstName: string; lastName: string } | null;
  enrollment: { instrument: string; lessonType: string } | null;
  attendance: { status: string } | null;
}

// Enrollments only show the abstract recurring rule ("weekly Tue 16:00"), not
// how many actual lesson rows it's generated — a parent asking "has she really
// had 12 lessons?" had no way to check without opening the calendar and paging
// week by week. This is the flat list, unbounded by date (same /lessons?studentId
// endpoint the calendar's cross-week search now uses), newest first.
function LessonTable({ lessons }: { lessons: HistoryLesson[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Time</th>
          <th>Instrument</th>
          <th>Teacher</th>
          <th>Status</th>
          <th>Attendance</th>
        </tr>
      </thead>
      <tbody>
        {lessons.map(l => {
          const d = new Date(l.startsAt);
          return (
            <tr key={l.id}>
              <td className="font-medium">{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td style={{ color: 'var(--txt3)' }}>{d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
              <td className="capitalize">{l.enrollment?.instrument ?? '—'}</td>
              <td>{l.teacher ? `${l.teacher.firstName} ${l.teacher.lastName}` : '—'}</td>
              <td><Badge variant={l.status}>{l.status.replace(/^cancelled_/, 'cancelled ')}</Badge></td>
              <td style={{ color: 'var(--txt3)' }}>{l.attendance?.status ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Split into Upcoming (soonest first — the thing you actually came here to
// check) and Past (most recent first). A single newest-first list buried the
// next lesson at the bottom under however many past ones existed.
function LessonHistory({ studentId }: { studentId: string }) {
  const { data: lessons = [] } = useApi<HistoryLesson[]>(`/lessons?studentId=${studentId}`);
  const [expandedPast, setExpandedPast] = useState(false);
  const now = Date.now();
  const upcoming = lessons
    .filter(l => new Date(l.startsAt).getTime() >= now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const past = lessons
    .filter(l => new Date(l.startsAt).getTime() < now)
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  const pastShown = expandedPast ? past : past.slice(0, 8);
  const bookedCount = lessons.filter(l => l.status === 'scheduled' || l.status === 'completed').length;

  return (
    <div className="mt-6 space-y-6">
      <div className="data-table-wrap overflow-hidden">
        <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
          <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Upcoming lessons</h2>
          <span className="text-xs font-semibold" style={{ color: 'var(--txt3)' }}>
            {bookedCount} lesson{bookedCount !== 1 ? 's' : ''} booked
          </span>
        </div>
        {upcoming.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>No upcoming lessons.</p>
        ) : (
          <LessonTable lessons={upcoming} />
        )}
      </div>

      <div className="data-table-wrap overflow-hidden">
        <div className="px-5 py-3.5 border-b" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
          <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Past lessons</h2>
        </div>
        {past.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>No past lessons.</p>
        ) : (
          <>
            <LessonTable lessons={pastShown} />
            {past.length > 8 && (
              <div className="px-5 py-3 border-t text-center" style={{ borderColor: 'var(--bd)' }}>
                <button onClick={() => setExpandedPast(v => !v)} className="text-xs font-semibold hover:underline" style={{ color: 'var(--sage-dk)' }}>
                  {expandedPast ? 'Show less' : `Show all ${past.length} past lessons`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Core profile fields (name/dob/email/notes) had no edit UI at all — PATCH
// /students/:id already supported them, but nothing in the app called it for
// anything but sub-resources (enrollments, status). This is that missing form.
function AddEnrollmentModal({ open, onClose, studentId, onCreated }: { open: boolean; onClose: () => void; studentId: string; onCreated: () => void }) {
  const [lessonType, setLessonType] = useState<'private' | 'group'>('private');
  const [duration, setDuration] = useState(30);
  const [instrument, setInstrument] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [termId, setTermId] = useState('');
  const [weekday, setWeekday] = useState('');
  const [enrollStatus, setEnrollStatus] = useState('active');
  // Auto-filled from the standard T&Cs rate, but editable — real pricing has
  // exceptions the flat duration→rate table can't express (e.g. a group's
  // whole-term flat fee sitting alongside separately-priced individual
  // lessons), so this used to be locked read-only and force the standard
  // rate on anyone who needed something else.
  const [rateText, setRateText] = useState('');
  const [rateEdited, setRateEdited] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ created: number; through: string | null } | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Cached picker options — only fetched once the modal is open.
  const { data: staff = [] } = useApi<StaffMember[]>(open ? '/staff' : null);
  const { data: terms = [] } = useApi<Term[]>(open ? '/terms' : null);
  const orgInstruments = useInstruments();

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setInstrument(''); setTeacherId(''); setWeekday(''); setEnrollStatus('active'); setError(''); setResult(null);
    setRateEdited(false);
  }, [open]);

  // Keep the rate in sync with the standard T&Cs figure as type/duration
  // change — unless the admin has already typed their own number, in which
  // case leave it alone rather than clobbering a deliberate override.
  useEffect(() => {
    if (rateEdited) return;
    setRateText((lessonRate(lessonType, duration) / 100).toFixed(2));
  }, [lessonType, duration, rateEdited]);

  // Default to the active term once terms load (don't clobber a manual choice).
  useEffect(() => {
    if (!termId) {
      const active = terms.find((t: Term) => t.status === 'active');
      if (active) setTermId(active.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms]);

  const instruments = lessonType === 'private' ? orgInstruments.private : orgInstruments.group;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    const startTime = (f.get('startTime') as string) || '';
    const hasSchedule = !!weekday && !!startTime;
    const ratePence = Math.round(parseFloat(rateText) * 100);
    if (!Number.isFinite(ratePence) || ratePence < 0) { setError('Enter a valid rate.'); setSaving(false); return; }
    try {
      const enrollment = await apiFetch<{ id: string }>(`/students/${studentId}/enrollments`, { method: 'POST', token: tok(), body: JSON.stringify({
        termId: termId || undefined, instrument, lessonType,
        duration,
        teacherId: teacherId || undefined,
        rate: ratePence,
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
        // No weekly time was set — this used to close silently with zero
        // lessons booked and no indication anything was skipped, which read
        // as "I added a student and everything's just blank." Say so instead.
        setResult({ created: 0, through: null });
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
            {result.through ? (
              result.created > 0 ? (
                <p>Booked <strong>{result.created}</strong> weekly lesson{result.created !== 1 ? 's' : ''} through{' '}
                  {new Date(result.through).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
                  They’re on the calendar now.</p>
              ) : (
                <p>No new lessons were booked (they may already exist for this schedule).</p>
              )
            ) : (
              <p>No weekly time was set, so <strong>no lessons were booked</strong> — the calendar will stay empty for this
                student until you edit the enrollment to add a weekday and time, or book lessons for them manually.</p>
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
                  <input type="radio" checked={lessonType === t} onChange={() => { setLessonType(t); setDuration(t === 'group' ? 60 : 30); setInstrument(''); }}
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
            options={eligibleTeachers(staff, instrument).map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
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
            <input name="rate" type="number" min="0" step="0.01" value={rateText}
              onChange={e => { setRateText(e.target.value); setRateEdited(true); }} className="ui-input" />
            {!rateEdited && <span className="text-xs whitespace-nowrap" style={{ color: 'var(--txt4)' }}>auto from T&amp;Cs</span>}
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'var(--txt4)' }}>
            Filled from the standard T&amp;Cs rate — edit it for special cases (e.g. a group&apos;s flat term fee).
          </p>
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

// Change an already-recurring enrollment's weekly day/time. "Apply to all
// future lessons" cancels and rebooks everything from today; unchecking it
// reveals a date picker instead, so the old day/time keeps running up to
// that date and only lessons from it onward move to the new slot (e.g. stay
// on Tuesdays until half-term, then switch to Thursdays).
function RescheduleWeeklyModal({ open, onClose, enrollment, onSaved }: {
  open: boolean; onClose: () => void; enrollment: EnrollmentRow | null; onSaved: () => void;
}) {
  const [weekday, setWeekday] = useState('monday');
  const [startTime, setStartTime] = useState('16:00');
  const [applyNow, setApplyNow] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number } | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (!open || !enrollment?.scheduleRule) return;
    setWeekday(enrollment.scheduleRule.weekday);
    setStartTime(enrollment.scheduleRule.startTime);
    setApplyNow(true);
    setEffectiveFrom('');
    setError(''); setResult(null);
  }, [open, enrollment]);

  async function save() {
    if (!enrollment) return;
    if (!applyNow && !effectiveFrom) { setError('Pick a date, or tick "Apply to all future lessons".'); return; }
    setSaving(true); setError('');
    try {
      const res = await apiFetch<{ created: number }>(`/enrollments/${enrollment.id}/reschedule-weekly`, {
        method: 'PATCH', token: tok(), body: JSON.stringify({
          weekday, startTime, effectiveFrom: applyNow ? undefined : effectiveFrom,
        }),
      });
      setResult({ created: res.created });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not reschedule'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={enrollment ? `Reschedule ${enrollment.instrument}` : 'Reschedule'}>
      {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      {result ? (
        <div className="space-y-4">
          <div className="rounded-xl px-4 py-4 text-sm"
            style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)', border: '1px solid var(--sage)' }}>
            <p className="font-bold text-base mb-1">Rescheduled ✓</p>
            <p>Now weekly on {weekday} at {startTime}. {result.created} upcoming lesson{result.created !== 1 ? 's' : ''} booked on the new slot.</p>
          </div>
          <button type="button" onClick={onClose} className="ui-btn-primary">Done</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label">Day</label>
              <SearchableSelect
                options={WEEKDAYS.map(d => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) }))}
                value={weekday} onChange={setWeekday}
              />
            </div>
            <div>
              <label className="ui-label">Time</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="ui-input" />
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={applyNow} onChange={e => setApplyNow(e.target.checked)}
                style={{ accentColor: 'var(--sage)' }} />
              Apply to all future lessons
            </label>
            {!applyNow && (
              <div className="mt-2">
                <label className="ui-label">Starting from</label>
                <input type="date" value={effectiveFrom} min={new Date().toISOString().split('T')[0]}
                  onChange={e => setEffectiveFrom(e.target.value)} className="ui-input" />
                <p className="text-xs mt-1" style={{ color: 'var(--txt4)' }}>
                  Lessons before this date keep the old day/time. From this date on, they move to the new one.
                </p>
              </div>
            )}
            {applyNow && (
              <p className="text-xs mt-1" style={{ color: 'var(--txt4)' }}>
                Cancels every future lesson on the old day/time (no charge) and rebooks them on the new one, starting now.
              </p>
            )}
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={save} disabled={saving} className="ui-btn-primary">{saving ? 'Saving…' : 'Reschedule'}</button>
            <button onClick={onClose} className="ui-btn-ghost">Cancel</button>
          </div>
        </div>
      )}
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
  const router = useRouter();
  const id = params.id;
  const [showEnroll, setShowEnroll] = useState(false);
  const [editEnrollmentId, setEditEnrollmentId] = useState<string | null>(null);
  const [rescheduleEnrollment, setRescheduleEnrollment] = useState<EnrollmentRow | null>(null);
  const [showEditStudent, setShowEditStudent] = useState(false);
  const [showEditFamily, setShowEditFamily] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const role = useRole();
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Cached read — instant on revisit. load() refreshes after an edit/enrollment.
  const { data: student = null, mutate } = useApi<StudentDetail>(`/students/${id}`);
  const load = () => mutate();

  // Withdrawing the whole student (as opposed to one of their enrollments) was
  // only reachable via a direct API/DB call — there was no button anywhere in
  // the app, even though the server (#171) does the full, correct teardown in
  // one transaction: flips the student to withdrawn, withdraws every
  // enrollment, clears each schedule rule, and cancels every future scheduled
  // lesson at no charge. Past lessons are untouched. DELETE-shaped but not a
  // data loss — the record stays, just marked left — so it gets the same
  // confirm bar as an enrollment withdrawal, not a "type to confirm" prompt.
  async function withdrawStudent() {
    if (!confirm(`Withdraw ${student!.firstName} ${student!.lastName}? This ends every enrollment, stops all their weekly lessons, and cancels all future scheduled lessons at no charge. Past lessons are unaffected. This cannot be undone from here — re-enroll them to bring them back.`)) return;
    setWithdrawing(true);
    try {
      await apiFetch(`/students/${id}`, { method: 'DELETE', token: tok() });
      router.push('/app/students');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not withdraw this student');
      setWithdrawing(false);
    }
  }

  async function changeEnrollmentStatus(enrollmentId: string, status: string) {
    // Withdrawing isn't just a label change: the server ends the series —
    // it clears the weekly rule and cancels every future scheduled lesson at
    // no charge (same teardown as "Stop weekly", which already confirms). It's
    // one click away from "Paused" in the dropdown and hard to undo, so guard
    // it. On cancel we bail without calling the API; the controlled <select>
    // snaps back to the real status on the next render.
    if (status === 'withdrawn' &&
        !confirm('Withdraw this enrollment? This stops the weekly lessons and cancels all future scheduled lessons at no charge. Past lessons are unaffected. To pause temporarily without cancelling upcoming lessons, choose "Paused" instead.')) {
      load();
      return;
    }
    try { await apiFetch(`/enrollments/${enrollmentId}`, { method: 'PATCH', token: tok(), body: JSON.stringify({ status }) }); load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Could not update enrollment'); }
  }

  // A genuine mistake (wrong student, duplicate click, never actually ran) has
  // no history worth keeping — unlike withdraw, this actually removes the
  // row. The server only allows it when nothing (a lesson, credit, or
  // request) references the enrolment yet; anything with real history 409s
  // with a message pointing back to withdraw instead.
  async function deleteEnrollment(enrollmentId: string, instrument: string) {
    if (!confirm(`Delete this ${instrument} enrolment? This only works if it has no lesson history — if it does, withdraw it instead. This cannot be undone.`)) return;
    try { await apiFetch(`/enrollments/${enrollmentId}`, { method: 'DELETE', token: tok() }); load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Could not delete this enrollment'); }
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
      <EditEnrollmentModal open={!!editEnrollmentId} onClose={() => setEditEnrollmentId(null)} enrollmentId={editEnrollmentId} onSaved={load} />
      <RescheduleWeeklyModal open={!!rescheduleEnrollment} onClose={() => setRescheduleEnrollment(null)} enrollment={rescheduleEnrollment} onSaved={load} />
      <EditStudentModal open={showEditStudent} onClose={() => setShowEditStudent(false)} studentId={id} onSaved={load} />
      {student.family && (
        <EditFamilyModal open={showEditFamily} onClose={() => setShowEditFamily(false)} familyId={student.family.id} onSaved={load} />
      )}

      <div className="mb-5">
        <BackButton label="Students" fallbackHref="/app/students" />
      </div>

      <PageHeader title={`${student.firstName} ${student.lastName}`} subtitle={student.family?.name}
        action={
          <span className="inline-flex items-center gap-2.5">
            <Badge variant={student.status}>{student.status}</Badge>
            {/* Only admins can actually withdraw (DELETE /students/:id is
                admin-gated server-side) — hidden rather than shown-disabled
                for everyone else, so a receptionist/teacher/manager on this
                page isn't shown a button that would just 403. */}
            {student.status !== 'withdrawn' && (role === 'admin') && (
              <button onClick={withdrawStudent} disabled={withdrawing}
                className="text-xs font-semibold hover:underline disabled:opacity-50"
                style={{ color: 'var(--coral)' }}>
                {withdrawing ? 'Withdrawing…' : 'Withdraw student'}
              </button>
            )}
          </span>
        } />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Profile</h2>
              {/* PATCH /students/:id is receptionist+ server-side; hidden rather
                  than shown-disabled for teacher, which would just 403. */}
              {role !== 'teacher' && (
                <button onClick={() => setShowEditStudent(true)}
                  className="text-[11px] font-semibold hover:underline" style={{ color: 'var(--sage)' }}>
                  Edit
                </button>
              )}
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Date of birth</dt>
                <dd className="font-medium">{student.dob ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="flex items-center gap-1.5" style={{ color: 'var(--txt3)' }}>
                  <Mail size={13} /> Email
                </dt>
                <dd className="font-medium">{student.email ?? '—'}</dd>
              </div>
            </dl>
          </div>
          <StudentCreditsCard studentId={id} role={role} />
          {student.family && (
            <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Family</h2>
                {role !== 'teacher' && (
                  <button onClick={() => setShowEditFamily(true)}
                    className="text-[11px] font-semibold hover:underline" style={{ color: 'var(--sage)' }}>
                    Edit
                  </button>
                )}
              </div>
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
                    <dt className="flex items-center gap-1.5" style={{ color: 'var(--txt3)' }}>
                      <Phone size={13} /> Phone
                    </dt>
                    <dd className="font-medium">{student.family.phone}</dd>
                  </div>
                )}
                {student.family.email && (
                  <div className="flex justify-between gap-3">
                    <dt className="flex items-center gap-1.5" style={{ color: 'var(--txt3)' }}>
                      <Mail size={13} /> Email
                    </dt>
                    <dd className="font-medium">{student.family.email}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Profile notes</h2>
              {role !== 'teacher' && (
                <button onClick={() => setShowEditStudent(true)}
                  className="text-[11px] font-semibold hover:underline" style={{ color: 'var(--sage)' }}>
                  Edit
                </button>
              )}
            </div>
            {student.notes ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--txt2)' }}>{student.notes}</p>
            ) : (
              <p className="text-sm" style={{ color: 'var(--txt4)' }}>No notes yet.</p>
            )}
          </div>
          <LessonNotes studentId={id} />
        </div>

        <div className="lg:col-span-2">
          <div className="data-table-wrap overflow-hidden">
            <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
              <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Enrollments</h2>
              {role !== 'teacher' && (
                <button onClick={() => setShowEnroll(true)} className="ui-btn-primary text-xs px-3 py-1.5">
                  + Add enrollment
                </button>
              )}
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Type</th>
                  <th>Teacher</th>
                  <th>Term</th>
                  {/* Rate/billing and edit actions are hidden from teachers —
                      a shared student can have enrolments with OTHER
                      teachers, and a teacher shouldn't see what a colleague
                      charges (or be able to edit it). Their own rate for
                      their own enrolment lives in the Assigned Students
                      card on their own staff profile instead. */}
                  {role !== 'teacher' && <th>Rate</th>}
                  <th>Status</th>
                  {role !== 'teacher' && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {student.enrollments.length === 0 && (
                  <tr><td colSpan={role !== 'teacher' ? 7 : 5} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
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
                    {role !== 'teacher' && <td className="font-medium">{formatMoney(e.rate)}</td>}
                    <td><Badge variant={e.status}>{e.status}</Badge></td>
                    {role !== 'teacher' && (
                      <td>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setEditEnrollmentId(e.id)}
                            className="text-xs font-semibold hover:underline" style={{ color: 'var(--sage-dk)' }}
                            title="Edit teacher, rate and duration">
                            Edit
                          </button>
                          <select value={e.status} onChange={ev => changeEnrollmentStatus(e.id, ev.target.value)}
                            className="text-xs border rounded-lg px-2 py-1" style={{ borderColor: 'var(--bd2)' }}
                            title="Change enrollment status">
                            <option value="waiting">Waiting</option>
                            <option value="trial">Trial</option>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                            <option value="withdrawn">Withdrawn</option>
                          </select>
                          {e.scheduleRule && (
                            <>
                              <button onClick={() => setRescheduleEnrollment(e)}
                                className="text-xs font-semibold hover:underline" style={{ color: 'var(--sage-dk)' }}
                                title="Change the weekly day/time">
                                Reschedule
                              </button>
                              <button onClick={() => stopWeekly(e.id)}
                                className="text-xs font-semibold hover:underline" style={{ color: 'var(--coral)' }}>
                                Stop weekly
                              </button>
                            </>
                          )}
                          {role === 'admin' && (
                            <button onClick={() => deleteEnrollment(e.id, e.instrument)}
                              className="text-xs font-semibold hover:underline" style={{ color: 'var(--coral)' }}
                              title="Permanently delete — only works if this enrolment has no lesson history">
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LessonHistory studentId={id} />
        </div>
      </div>
    </div>
  );
}
