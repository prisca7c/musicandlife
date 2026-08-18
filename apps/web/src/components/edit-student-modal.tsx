'use client';

import { useState, useEffect, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { Modal } from '@/components/modal';

interface EditableStudent {
  id: string; firstName: string; lastName: string;
  dob: string | null; email: string | null; notes: string | null;
}

// Self-fetching by id (via the same `/students/:id` SWR key the detail page
// uses) so it can be dropped into a list row's "Edit" button without that
// row's own list-query fields covering dob/email/notes — instant if the
// detail page already warmed the cache, one extra fetch otherwise.
export function EditStudentModal({ open, onClose, studentId, onSaved }: {
  open: boolean; onClose: () => void; studentId: string | null; onSaved: () => void;
}) {
  const { data: student } = useApi<EditableStudent>(open && studentId ? `/students/${studentId}` : null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (!student) return;
    setFirstName(student.firstName); setLastName(student.lastName);
    setDob(student.dob ?? ''); setEmail(student.email ?? ''); setNotes(student.notes ?? '');
    setError('');
  }, [student, open]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!studentId) return;
    setSaving(true); setError('');
    try {
      await apiFetch(`/students/${studentId}`, {
        method: 'PATCH', token: tok(), body: JSON.stringify({
          firstName, lastName, dob: dob || undefined, email: email || undefined, notes: notes || undefined,
        }),
      });
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit student">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      {!student ? (
        <p className="text-sm text-center py-4" style={{ color: 'var(--txt4)' }}>Loading…</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label">First name <span style={{ color: 'var(--coral)' }}>*</span></label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} required autoFocus className="ui-input" />
            </div>
            <div>
              <label className="ui-label">Last name <span style={{ color: 'var(--coral)' }}>*</span></label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} required className="ui-input" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label">Date of birth</label>
              <input type="date" value={dob} onChange={e => setDob(e.target.value)} className="ui-input" />
            </div>
            <div>
              <label className="ui-label">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="ui-input" />
            </div>
          </div>
          <div>
            <label className="ui-label">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="ui-input" />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving} className="ui-btn-primary">{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
