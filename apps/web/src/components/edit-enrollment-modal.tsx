'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { Modal } from '@/components/modal';
import { SearchableSelect } from '@/components/searchable-select';
import { useInstruments } from '@/lib/use-instruments';

interface StaffMember { id: string; firstName: string; lastName: string; instruments: string[]; }
interface EditableEnrollment {
  id: string; instrument: string; lessonType: string; status: string; rate: number;
  trialRate: number | null; defaultDuration: number;
  teacher: { id: string; firstName: string; lastName: string } | null;
}

// Teachers who teach the selected instrument, per each teacher's own
// "Instruments taught" list. Falls back to the full staff list when nobody
// matches (an unconfigured/legacy teacher record) so admins are never left
// unable to assign anyone, and when no instrument is chosen yet.
function eligibleTeachers(staff: StaffMember[], instrument: string): StaffMember[] {
  if (!instrument) return staff;
  const matching = staff.filter(s => s.instruments?.includes(instrument));
  return matching.length > 0 ? matching : staff;
}

// Self-fetching by id (via GET /enrollments/:id) so it can be dropped
// anywhere an enrolment is referenced — the staff detail page's Assigned
// Students table only ever has a thin summary (instrument names, not a full
// enrolment record), same reasoning as EditFamilyModal/EditStudentModal.
export function EditEnrollmentModal({ open, onClose, enrollmentId, onSaved }: {
  open: boolean; onClose: () => void; enrollmentId: string | null; onSaved: () => void;
}) {
  const { data: enrollment } = useApi<EditableEnrollment>(open && enrollmentId ? `/enrollments/${enrollmentId}` : null);
  const [lessonType, setLessonType] = useState<'private' | 'group'>('private');
  const [instrument, setInstrument] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [status, setStatus] = useState('active');
  const [rateText, setRateText] = useState('');
  const [trialRateText, setTrialRateText] = useState('');
  const [duration, setDuration] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const { data: staff = [] } = useApi<StaffMember[]>(open ? '/staff' : null);
  const orgInstruments = useInstruments();
  const instruments = lessonType === 'private' ? orgInstruments.private : orgInstruments.group;

  useEffect(() => {
    if (!open || !enrollment) return;
    setLessonType(enrollment.lessonType === 'group' ? 'group' : 'private');
    setInstrument(enrollment.instrument);
    setTeacherId(enrollment.teacher?.id ?? '');
    setStatus(enrollment.status);
    setRateText((enrollment.rate / 100).toFixed(2));
    setTrialRateText(enrollment.trialRate != null ? (enrollment.trialRate / 100).toFixed(2) : '');
    setDuration(enrollment.defaultDuration ?? 60);
    setError('');
  }, [open, enrollment]);

  async function save() {
    if (!instrument.trim()) { setError('Choose an instrument.'); return; }
    const pence = Math.round(parseFloat(rateText) * 100);
    if (!Number.isFinite(pence) || pence < 0) { setError('Enter a valid rate.'); return; }
    if (!Number.isInteger(duration) || duration < 5 || duration > 240) { setError('Duration must be 5–240 minutes.'); return; }
    let trialRate: number | null = null;
    if (trialRateText.trim() !== '') {
      const tp = Math.round(parseFloat(trialRateText) * 100);
      if (!Number.isFinite(tp) || tp < 0) { setError('Enter a valid trial rate, or leave it blank.'); return; }
      trialRate = tp;
    }
    if (!enrollmentId) return;
    setSaving(true); setError('');
    try {
      await apiFetch(`/enrollments/${enrollmentId}`, {
        method: 'PATCH', token: tok(),
        body: JSON.stringify({ instrument, lessonType, teacherId: teacherId || null, status, rate: pence, trialRate, duration }),
      });
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={enrollment ? `Edit ${enrollment.instrument} enrollment` : 'Edit enrollment'}>
      {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      {!enrollment ? (
        <p className="text-sm text-center py-4" style={{ color: 'var(--txt4)' }}>Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label">Lesson type</label>
              <div className="flex gap-4 mt-2">
                {(['private', 'group'] as const).map(t => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="radio" checked={lessonType === t} onChange={() => { setLessonType(t); setInstrument(''); }}
                      style={{ accentColor: 'var(--sage)' }} />
                    <span className="capitalize">{t}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="ui-label">Instrument <span style={{ color: 'var(--coral)' }}>*</span></label>
              <SearchableSelect
                options={instruments.map(i => ({ value: i, label: i.charAt(0).toUpperCase() + i.slice(1) }))}
                value={instrument} onChange={setInstrument} placeholder="Select…"
              />
            </div>
          </div>
          <div>
            <label className="ui-label">Teacher</label>
            <SearchableSelect
              options={eligibleTeachers(staff, instrument).map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
              value={teacherId} onChange={setTeacherId} emptyLabel="Unassigned" placeholder="Unassigned"
            />
          </div>
          <div>
            <label className="ui-label">Status</label>
            <SearchableSelect
              options={[
                { value: 'waiting', label: 'Waiting' },
                { value: 'trial', label: 'Trial' },
                { value: 'active', label: 'Active' },
                { value: 'paused', label: 'Paused' },
                { value: 'withdrawn', label: 'Withdrawn' },
              ]}
              value={status} onChange={setStatus}
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
          <div>
            <label className="ui-label">Trial rate (£) — optional</label>
            <input type="number" step="0.01" min="0" value={trialRateText} placeholder="Leave blank for normal rate"
              onChange={e => setTrialRateText(e.target.value)} className="ui-input w-full" />
          </div>
          <p className="text-xs" style={{ color: 'var(--txt4)' }}>
            The rate is what the family is charged for this enrollment; a lesson of a different length is prorated against the duration.
            {lessonType === 'group' && ' For a group class, this is the set price and length.'}
            {' '}A trial rate is a flat price charged for a lesson marked as a trial; leave it blank to charge trials the normal rate.
          </p>
          <div className="flex gap-3 pt-1">
            <button onClick={save} disabled={saving} className="ui-btn-primary">{saving ? 'Saving…' : 'Save changes'}</button>
            <button onClick={onClose} className="ui-btn-ghost">Cancel</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
