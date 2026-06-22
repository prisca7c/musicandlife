'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { UserPlus, Search } from 'lucide-react';
import { SearchableSelect } from '@/components/searchable-select';

interface Student { id: string; firstName: string; lastName: string; status: string; family: { id: string; name: string } | null; enrollments?: { instrument: string }[]; }
interface Family { id: string; name: string; }

function AddStudentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [status, setStatus] = useState('active');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (open) {
      apiFetch<Family[]>('/families', { token: tok() }).then(setFamilies).catch(() => {});
      setFamilyId(''); setStatus('active'); setError('');
    }
  }, [open]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch<{ id: string }>('/students', { method: 'POST', token: tok(), body: JSON.stringify({
        familyId, firstName: f.get('firstName'), lastName: f.get('lastName'),
        dob: f.get('dob') || undefined, email: f.get('email') || undefined, status,
        notes: f.get('notes') || undefined,
      })});
      onCreated(); onClose();
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
              { value: 'trial', label: 'Trial' },
              { value: 'active', label: 'Active' },
              { value: 'paused', label: 'Paused' },
            ]}
            value={status} onChange={setStatus}
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

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function load(q = search) {
    const qs = q ? `?search=${encodeURIComponent(q)}` : '';
    apiFetch<Student[]>(`/students${qs}`, { token: tok() }).then(setStudents).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <AddStudentModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => load()} />
      <PageHeader
        title="Students"
        subtitle={`${students.length} student${students.length !== 1 ? 's' : ''}`}
        action={
          <button onClick={() => setShowAdd(true)} className="ui-btn-primary">
            <UserPlus size={15} /> Add student
          </button>
        }
      />

      <div className="mb-5 relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--txt4)' }}>
          <Search size={15} />
        </span>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); load(e.target.value); }}
          placeholder="Search by name…"
          className="ui-search pl-9"
        />
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Family</th>
              <th>Status</th>
              <th>Instruments</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                No students yet.
              </td></tr>
            )}
            {students.map(s => (
              <tr key={s.id}>
                <td>
                  <Link href={`/app/students/${s.id}`}
                    className="font-semibold hover:underline"
                    style={{ color: 'var(--sage-dk)' }}>
                    {s.firstName} {s.lastName}
                  </Link>
                </td>
                <td style={{ color: 'var(--txt3)' }}>
                  {s.family
                    ? <Link href={`/app/families/${s.family.id}`} className="hover:underline" style={{ color: 'var(--txt2)' }}>{s.family.name}</Link>
                    : '—'}
                </td>
                <td><Badge variant={s.status}>{s.status}</Badge></td>
                <td style={{ color: 'var(--txt3)' }}>{s.enrollments?.map(e => e.instrument).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
