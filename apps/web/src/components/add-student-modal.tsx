'use client';

import { useState, useEffect, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { Modal } from '@/components/modal';
import { SearchableSelect } from '@/components/searchable-select';
import { useInstruments } from '@/lib/use-instruments';
import { lessonRate } from '@music-life/types';

interface Family { id: string; name: string; }
interface StaffMember { id: string; firstName: string; lastName: string; instruments: string[]; }

// Teachers who teach the picked instrument, per each teacher's own
// "Instruments taught" list — falls back to the full staff list when nobody
// matches (an unconfigured teacher, or no instrument picked yet).
function eligibleTeachers(staff: StaffMember[], instrument: string): StaffMember[] {
  if (!instrument) return staff;
  const matching = staff.filter(s => s.instruments?.includes(instrument));
  return matching.length > 0 ? matching : staff;
}

/**
 * Reusable "Add student" modal. Creates a student under an existing family via
 * POST /students, and — if an instrument was picked — a matching enrollment
 * right after. Shared by the Students list and the Calendar toolbar.
 * `onCreated` receives the new student's id so callers can chain (e.g. assign a teacher).
 */
export function AddStudentModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated?: (studentId: string) => void;
}) {
  const [families, setFamilies] = useState<Family[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [status, setStatus] = useState('active');
  const [lessonType, setLessonType] = useState<'private' | 'group'>('private');
  const [instrument, setInstrument] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [duration, setDuration] = useState(30);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const orgInstruments = useInstruments();
  const instruments = lessonType === 'private' ? orgInstruments.private : orgInstruments.group;

  useEffect(() => {
    if (open) {
      const t = tok();
      apiFetch<Family[]>('/families', { token: t }).then(setFamilies).catch(() => {});
      apiFetch<StaffMember[]>('/staff', { token: t }).then(setStaff).catch(() => {});
      setFamilyId(''); setStatus('active'); setError('');
      setLessonType('private'); setInstrument(''); setTeacherId(''); setDuration(30);
    }
  }, [open]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!familyId) { setError('Please select a family'); return; }
    setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      const created = await apiFetch<{ id: string }>('/students', { method: 'POST', token: tok(), body: JSON.stringify({
        familyId, firstName: f.get('firstName'), lastName: f.get('lastName'),
        dob: f.get('dob') || undefined, email: f.get('email') || undefined, status,
        notes: f.get('notes') || undefined,
      })});
      // Instrument/teacher are optional (a waiting-list student may not have
      // either picked yet) — only create an enrollment when an instrument was
      // actually chosen. The enrollment's status mirrors the student's, so a
      // waiting-list enrollment sits alongside the student until scheduled.
      if (instrument) {
        await apiFetch(`/students/${created.id}/enrollments`, { method: 'POST', token: tok(), body: JSON.stringify({
          instrument, lessonType, teacherId: teacherId || undefined, duration,
          rate: lessonRate(lessonType, duration), status,
        })});
      }
      onCreated?.(created.id); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add student">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Family <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={families.map(f => ({ value: f.id, label: f.name }))}
            value={familyId} onChange={setFamilyId} placeholder="Select a family…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">First name <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="firstName" required className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Last name <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="lastName" required className="ui-input" />
          </div>
        </div>
        <div>
          <label className="ui-label">Date of birth</label>
          <input name="dob" type="date" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">
            Student email{' '}
            <span className="font-normal text-[11px]" style={{ color: 'var(--txt4)' }}>(optional — creates portal login)</span>
          </label>
          <input name="email" type="email" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Status</label>
          <SearchableSelect
            options={[
              { value: 'waiting', label: 'Waiting — not yet scheduled a trial' },
              { value: 'trial', label: 'Trial' },
              { value: 'active', label: 'Active' },
              { value: 'paused', label: 'Paused' },
            ]}
            value={status} onChange={setStatus}
          />
        </div>

        <div className="h-px" style={{ background: 'var(--bd)' }} />

        <div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--txt2)' }}>Instrument &amp; teacher</p>
          <p className="text-xs mb-3" style={{ color: 'var(--txt4)' }}>
            Optional — a waiting-list student often doesn&rsquo;t have either yet, but you can set them now if you already know.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Lesson type</label>
            <div className="flex gap-4 mt-2">
              {(['private', 'group'] as const).map(t => (
                <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="radio" checked={lessonType === t} onChange={() => { setLessonType(t); setInstrument(''); setDuration(t === 'group' ? 60 : 30); }}
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
                ? [30, 45, 60].map(d => ({ value: String(d), label: `${d} min` }))
                : [{ value: '60', label: '60 min' }]}
              value={String(duration)}
              onChange={v => setDuration(parseInt(v))}
              disabled={lessonType === 'group'}
            />
          </div>
        </div>
        <div>
          <label className="ui-label">Instrument</label>
          <SearchableSelect
            options={instruments.map(i => ({ value: i, label: i.charAt(0).toUpperCase() + i.slice(1) }))}
            value={instrument} onChange={setInstrument} placeholder="Not picked yet"
          />
        </div>
        <div>
          <label className="ui-label">Teacher</label>
          <SearchableSelect
            options={eligibleTeachers(staff, instrument).map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            value={teacherId} onChange={setTeacherId} emptyLabel="Unassigned" placeholder="Unassigned"
          />
        </div>

        <div>
          <label className="ui-label">Notes</label>
          <textarea name="notes" rows={2} className="ui-input" style={{ resize: 'vertical' }} />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : 'Add student'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
