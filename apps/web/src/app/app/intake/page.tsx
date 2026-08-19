'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { SearchableSelect } from '@/components/searchable-select';
import { useInstruments } from '@/lib/use-instruments';
import { EditStudentModal } from '@/components/edit-student-modal';
import { Plus, CircleCheck, CircleX, Upload, Pencil, Trash2 } from 'lucide-react';

interface Registration {
  id: string; status: string; submittedAt: string; denyReason: string | null;
  payload: {
    studentFirstName: string; studentLastName: string; studentEmail?: string;
    familyName: string; contactName: string; contactEmail: string; contactPhone?: string;
    instruments: { instrument: string; lessonType: string }[];
    notes?: string;
  };
}

interface Lead { id: string; name: string; contact: string | null; instrumentInterest: string | null; source: string | null; status: string; notes: string | null; createdAt: string; }

function RegistrationDetailModal({ reg, open, onClose, onDecision }: {
  reg: Registration | null; open: boolean; onClose: () => void; onDecision: () => void;
}) {
  const [denyReason, setDenyReason] = useState('');
  const [actioning, setActioning] = useState(false);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  if (!reg) return null;
  const p = reg.payload;
  // With no contact email the server still creates the family/student/enrollments,
  // but can't create a portal login or send the welcome email — so the copy must
  // not promise one. (QA H13)
  const hasEmail = !!p.contactEmail?.trim();

  async function approve() {
    setActioning(true); setError('');
    try {
      await apiFetch(`/registrations/${reg!.id}/approve`, { method: 'POST', token: tok() });
      onDecision(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setActioning(false); }
  }

  async function deny() {
    // A denied registration can't be re-approved — the family would have to
    // resubmit from scratch — so this deserves the same confirm as the other
    // one-way decisions in this codebase.
    if (!window.confirm(`Deny ${p.studentFirstName} ${p.studentLastName}'s registration? This can't be undone — the family would need to submit a new registration.`)) return;
    setActioning(true); setError('');
    try {
      await apiFetch(`/registrations/${reg!.id}/deny`, { method: 'POST', token: tok(), body: JSON.stringify({ reason: denyReason }) });
      onDecision(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setActioning(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Registration review">
      <div className="space-y-4">
        {error && (
          <div className="text-sm rounded-xl px-4 py-3"
            style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
            {error}
          </div>
        )}

        {/* Detail block */}
        <div className="rounded-xl p-4 space-y-2.5 text-sm"
          style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
          {[
            { label: 'Student', value: `${p.studentFirstName} ${p.studentLastName}` },
            ...(p.studentEmail ? [{ label: 'Student email', value: p.studentEmail }] : []),
            { label: 'Family', value: p.familyName },
            { label: 'Contact', value: p.contactName },
            { label: 'Email', value: hasEmail ? p.contactEmail : 'None on file' },
            ...(p.contactPhone ? [{ label: 'Phone', value: p.contactPhone }] : []),
          ].map(row => (
            <div key={row.label} className="flex justify-between gap-4">
              <span style={{ color: 'var(--txt3)' }}>{row.label}</span>
              <span className="font-medium text-right">{row.value}</span>
            </div>
          ))}
          <div>
            <span style={{ color: 'var(--txt3)' }}>Instruments</span>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {p.instruments?.map(i => (
                <span key={`${i.instrument}|${i.lessonType}`}
                  className="text-xs rounded-full px-2.5 py-0.5 capitalize font-semibold"
                  style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)', border: '1px solid var(--sage-md)' }}>
                  {i.instrument} ({i.lessonType})
                </span>
              ))}
            </div>
          </div>
          {p.notes && (
            <div>
              <span style={{ color: 'var(--txt3)' }}>Notes </span>
              <span className="italic">{p.notes}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span style={{ color: 'var(--txt3)' }}>Submitted</span>
            <span className="font-medium">{new Date(reg.submittedAt).toLocaleDateString('en-GB')}</span>
          </div>
        </div>

        {reg.status === 'pending' && (
          <>
            <div>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--txt2)' }}>Approve registration</p>
              <p className="text-xs mb-3" style={{ color: 'var(--txt3)' }}>
                {hasEmail
                  ? 'Creates the family, student, and enrollments. Sends a welcome email with portal login link.'
                  : 'Creates the family, student, and enrollments.'}
              </p>
              {!hasEmail && (
                <div className="text-xs rounded-xl px-3 py-2 mb-3"
                  style={{ background: 'var(--amber-lt, #FEF3C7)', color: 'var(--amber-dk, #92400E)', border: '1px solid #FDE68A' }}>
                  No email on file — this family won’t get a welcome email or a portal login. Add an email to their record afterwards to invite them.
                </div>
              )}
              <button onClick={approve} disabled={actioning}
                className="w-full flex items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-50"
                style={{ background: 'var(--sage)' }}
                onMouseOver={e => (e.currentTarget.style.background = 'var(--sage-dk)')}
                onMouseOut={e => (e.currentTarget.style.background = 'var(--sage)')}>
                <CircleCheck size={16} />
                {actioning ? 'Approving…' : 'Approve & create accounts'}
              </button>
            </div>
            <div className="border-t pt-4" style={{ borderColor: 'var(--bd)' }}>
              <p className="text-sm font-semibold mb-2" style={{ color: 'var(--txt2)' }}>Deny registration</p>
              <textarea value={denyReason} onChange={e => setDenyReason(e.target.value)} rows={2}
                placeholder="Optional reason (sent to the family)"
                className="ui-input mb-3"
                style={{ resize: 'vertical' }} />
              <button onClick={deny} disabled={actioning}
                className="w-full flex items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-50"
                style={{ border: '1.5px solid #FCA5A5', color: 'var(--coral)', background: '#fff' }}
                onMouseOver={e => (e.currentTarget.style.background = 'var(--coral-lt)')}
                onMouseOut={e => (e.currentTarget.style.background = '#fff')}>
                <CircleX size={16} />
                {actioning ? 'Denying…' : 'Deny'}
              </button>
            </div>
          </>
        )}
        {reg.status !== 'pending' && (
          <p className="text-sm" style={{ color: 'var(--txt3)' }}>
            This registration has been <strong>{reg.status}</strong>.
          </p>
        )}
      </div>
    </Modal>
  );
}

function AddLeadModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const orgInstruments = useInstruments();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/leads', { method: 'POST', token: tok(), body: JSON.stringify({
        name: f.get('name'), contact: f.get('contact') || undefined,
        instrumentInterest: f.get('instrumentInterest') || undefined,
        source: f.get('source') || undefined, notes: f.get('notes') || undefined,
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add lead">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Name <span style={{ color: 'var(--coral)' }}>*</span></label>
          <input name="name" required autoFocus className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Contact (email or phone)</label>
          <input name="contact" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Instrument interest</label>
          <SearchableSelect
            name="instrumentInterest"
            options={orgInstruments.all.map(i => ({ value: i, label: i.charAt(0).toUpperCase() + i.slice(1) }))}
            emptyLabel="Not specified" placeholder="Not specified"
          />
        </div>
        <div>
          <label className="ui-label">Source</label>
          <select name="source" className="ui-input">
            <option value="">Unknown</option>
            <option value="website">Website</option>
            <option value="referral">Referral</option>
            <option value="social_media">Social media</option>
            <option value="walk_in">Walk-in</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="ui-label">Notes</label>
          <textarea name="notes" rows={2} className="ui-input" style={{ resize: 'vertical' }} />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Adding…' : 'Add lead'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

const REG_STATUS: Record<string, string> = { pending: 'trial', approved: 'active', denied: 'withdrawn' };
const LEAD_STATUS: Record<string, string> = { new: 'trial', contacted: 'default', converted: 'active', lost: 'withdrawn' };

interface ImportRow { rowNumber: number; data: Record<string, string>; errors: string[]; }
interface ImportPreview { rows: ImportRow[]; validCount: number; errorCount: number; }
interface ImportResult { created: number; failures: { row: number; error: string }[]; }

function ImportCsvPanel() {
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name); setPreview(null); setResult(null); setError('');
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  async function runPreview() {
    setLoading(true); setError('');
    try {
      const data = await apiFetch<ImportPreview>('/registrations/import/preview', { method: 'POST', token: tok(), body: JSON.stringify({ csv }) });
      setPreview(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not parse CSV'); }
    finally { setLoading(false); }
  }

  async function confirmImport() {
    if (!preview) return;
    const validRows = preview.rows.filter(r => r.errors.length === 0).map(r => r.data);
    setLoading(true); setError('');
    try {
      const res = await apiFetch<ImportResult>('/registrations/import/commit', { method: 'POST', token: tok(), body: JSON.stringify({ rows: validRows }) });
      setResult(res); setPreview(null); setCsv(''); setFileName('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
        <h2 className="font-bold text-sm mb-1" style={{ color: 'var(--txt)' }}>Import students from CSV</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--txt3)' }}>
          Required columns: <code>studentFirstName</code>, <code>studentLastName</code>, <code>guardianFirstName</code>, <code>guardianLastName</code>.
          Optional: <code>studentDob</code>, <code>studentEmail</code>, <code>guardianEmail</code>, <code>guardianPhone</code>, <code>address</code>, <code>familyName</code>, <code>instrument</code>, <code>lessonType</code>.
          Each row creates its own family — no merging of guardians across rows.
        </p>
        {error && (
          <div className="mb-4 text-sm rounded-xl px-4 py-3"
            style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
            {error}
          </div>
        )}
        <div className="flex items-center gap-3">
          <label className="ui-btn-ghost cursor-pointer">
            <Upload size={14} /> {fileName || 'Choose CSV file…'}
            <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
          </label>
          <button onClick={runPreview} disabled={!csv || loading} className="ui-btn-primary">
            {loading ? 'Working…' : 'Preview'}
          </button>
        </div>
      </div>

      {result && (
        <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
          <p className="text-sm font-bold mb-2" style={{ color: 'var(--sage-dk)' }}>
            Imported {result.created} student{result.created !== 1 ? 's' : ''}.
          </p>
          {result.failures.length > 0 && (
            <div className="text-sm" style={{ color: 'var(--coral)' }}>
              {result.failures.length} row{result.failures.length !== 1 ? 's' : ''} failed:
              <ul className="list-disc ml-5 mt-1">
                {result.failures.map(f => <li key={f.row}>Row {f.row}: {f.error}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {preview && (
        <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--bd)' }}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
              {preview.validCount} valid · {preview.errorCount} with errors
            </p>
            <button onClick={confirmImport} disabled={preview.validCount === 0 || loading} className="ui-btn-primary text-xs px-3 py-1.5">
              {loading ? 'Importing…' : `Confirm import (${preview.validCount})`}
            </button>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: 'var(--surf)' }}>
                <tr className="text-left">
                  <th className="px-4 py-2 font-semibold" style={{ color: 'var(--txt3)' }}>Row</th>
                  <th className="px-4 py-2 font-semibold" style={{ color: 'var(--txt3)' }}>Student</th>
                  <th className="px-4 py-2 font-semibold" style={{ color: 'var(--txt3)' }}>Guardian</th>
                  <th className="px-4 py-2 font-semibold" style={{ color: 'var(--txt3)' }}>Instrument</th>
                  <th className="px-4 py-2 font-semibold" style={{ color: 'var(--txt3)' }}>Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--bd)' }}>
                {preview.rows.map(r => (
                  <tr key={r.rowNumber} style={r.errors.length > 0 ? { background: 'var(--coral-lt)' } : undefined}>
                    <td className="px-4 py-2" style={{ color: 'var(--txt4)' }}>{r.rowNumber}</td>
                    <td className="px-4 py-2 font-medium">{r.data.studentFirstName} {r.data.studentLastName}</td>
                    <td className="px-4 py-2" style={{ color: 'var(--txt3)' }}>{r.data.guardianFirstName} {r.data.guardianLastName}</td>
                    <td className="px-4 py-2 capitalize" style={{ color: 'var(--txt3)' }}>{r.data.instrument || '—'}</td>
                    <td className="px-4 py-2 text-xs" style={{ color: 'var(--coral)' }}>{r.errors.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

interface WaitingStudent {
  id: string; firstName: string; lastName: string;
  family: { id: string; name: string; contactName: string | null; email: string | null; phone: string | null } | null;
  enrollments?: { instrument: string; teacher: { firstName: string; lastName: string } | null }[];
}

export default function IntakePage() {
  const [tab, setTab] = useState<'registrations' | 'waiting' | 'leads' | 'import'>('registrations');
  const [regFilter, setRegFilter] = useState('pending');
  const [selectedReg, setSelectedReg] = useState<Registration | null>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [editingWaitingId, setEditingWaitingId] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [selectedWaiting, setSelectedWaiting] = useState<Set<string>>(new Set());
  const [bulkWithdrawing, setBulkWithdrawing] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Cached reads. Registrations re-key on the status filter; both refresh via
  // their mutate() after a decision or lead update.
  const { data: registrations = [], mutate: mutateRegs } = useApi<Registration[]>(`/registrations?status=${regFilter}`);
  const { data: leads = [], mutate: mutateLeads } = useApi<Lead[]>('/leads');
  const { data: waitingData, mutate: mutateWaiting } = useApi<{ data: WaitingStudent[] }>('/students?status=waiting&limit=200&offset=0');
  const waiting = waitingData?.data ?? [];
  const loadRegistrations = () => mutateRegs();
  const loadLeads = () => mutateLeads();

  // The waiting list is the studio's own "hasn't been scheduled a trial yet"
  // bucket — promoting one just flips status to trial, same one-click pattern
  // as the roster's own trial→active promote button.
  async function promoteToTrial(id: string) {
    setPromoting(id);
    try {
      await apiFetch(`/students/${id}`, { method: 'PATCH', token: tok(), body: JSON.stringify({ status: 'trial' }) });
      mutateWaiting();
    } catch { /* leave as-is on failure */ }
    finally { setPromoting(null); }
  }

  async function withdrawWaitingOne(id: string, name: string) {
    if (!confirm(`Withdraw ${name}? This removes them from the waiting list and ends any enrollment. This cannot be undone from here — re-enroll them to bring them back.`)) return;
    setWithdrawingId(id);
    try {
      await apiFetch(`/students/${id}`, { method: 'DELETE', token: tok() });
      mutateWaiting();
      setSelectedWaiting(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch (e) { alert(e instanceof Error ? e.message : 'Could not withdraw this student'); }
    finally { setWithdrawingId(null); }
  }

  async function withdrawWaitingSelected() {
    const targets = waiting.filter(s => selectedWaiting.has(s.id));
    if (targets.length === 0) return;
    if (!confirm(`Withdraw ${targets.length} student${targets.length !== 1 ? 's' : ''} from the waiting list? This cannot be undone from here.`)) return;
    setBulkWithdrawing(true);
    for (const s of targets) {
      try { await apiFetch(`/students/${s.id}`, { method: 'DELETE', token: tok() }); }
      catch { /* one failure shouldn't stop the rest */ }
    }
    setBulkWithdrawing(false);
    setSelectedWaiting(new Set());
    mutateWaiting();
  }

  function toggleWaitingSelected(id: string) {
    setSelectedWaiting(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleWaitingSelectAll() {
    setSelectedWaiting(prev => prev.size === waiting.length ? new Set() : new Set(waiting.map(s => s.id)));
  }

  async function updateLeadStatus(id: string, status: 'new' | 'contacted' | 'converted' | 'lost') {
    setUpdatingId(id);
    try { await apiFetch(`/leads/${id}`, { method: 'PATCH', token: tok(), body: JSON.stringify({ status }) }); loadLeads(); }
    catch (e) { console.error(e); } finally { setUpdatingId(null); }
  }

  const pending = registrations.filter(r => r.status === 'pending').length;

  return (
    <div>
      <RegistrationDetailModal reg={selectedReg} open={!!selectedReg} onClose={() => setSelectedReg(null)} onDecision={loadRegistrations} />
      <AddLeadModal open={showAddLead} onClose={() => setShowAddLead(false)} onCreated={loadLeads} />
      <EditStudentModal open={!!editingWaitingId} onClose={() => setEditingWaitingId(null)} studentId={editingWaitingId} onSaved={() => mutateWaiting()} />

      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Pending
            <InfoTooltip text="Everyone on their way to becoming a student. 'Sign-ups' are families who completed the form and are waiting for you to approve them into full student accounts. 'Waiting list' is students who haven't been officially scheduled for a trial lesson yet. 'Enquiries' are people you're following up. Active and trial students live under their own tabs." />
          </span>
        }
        subtitle={
          tab === 'registrations' && regFilter === 'pending' && pending > 0 ? `${pending} pending review` :
          tab === 'waiting' ? `${waiting.length} waiting` :
          tab === 'leads' ? `${leads.length} lead${leads.length !== 1 ? 's' : ''}` : undefined
        }
        action={
          tab === 'leads'
            ? <button onClick={() => setShowAddLead(true)} className="ui-btn-primary"><Plus size={15} /> Add lead</button>
            : tab === 'waiting' && selectedWaiting.size > 0
            ? <button onClick={withdrawWaitingSelected} disabled={bulkWithdrawing} className="ui-btn-ghost" style={{ color: 'var(--coral)' }}>
                <Trash2 size={15} /> {bulkWithdrawing ? 'Withdrawing…' : `Withdraw (${selectedWaiting.size})`}
              </button>
            : undefined
        }
      />

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b" style={{ borderColor: 'var(--bd)' }}>
        {(['registrations', 'waiting', 'leads', 'import'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors"
            style={{
              borderColor: tab === t ? 'var(--sage)' : 'transparent',
              color: tab === t ? 'var(--sage)' : 'var(--txt3)',
            }}>
            {t === 'registrations' ? 'Sign-ups' : t === 'waiting' ? 'Waiting list' : t === 'leads' ? 'Enquiries & Waitlist' : 'Import (CSV)'}
          </button>
        ))}
      </div>

      {tab === 'registrations' && (
        <>
          <div className="flex gap-1 mb-5">
            {(['pending', 'approved', 'denied'] as const).map(s => (
              <button key={s} onClick={() => setRegFilter(s)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors"
                style={{
                  background: regFilter === s ? 'var(--sage-lt)' : 'transparent',
                  color: regFilter === s ? 'var(--sage)' : 'var(--txt4)',
                }}>
                {s}
              </button>
            ))}
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Family / Contact</th>
                  <th>Instruments</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {registrations.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                    No {regFilter} registrations.
                  </td></tr>
                )}
                {registrations.map(r => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.payload.studentFirstName} {r.payload.studentLastName}</td>
                    <td>
                      <div style={{ color: 'var(--txt2)' }}>{r.payload.familyName}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--txt4)' }}>{r.payload.contactEmail}</div>
                    </td>
                    <td className="text-xs capitalize" style={{ color: 'var(--txt3)' }}>
                      {r.payload.instruments?.map(i => i.instrument).join(', ')}
                    </td>
                    <td className="text-xs" style={{ color: 'var(--txt3)' }}>
                      {new Date(r.submittedAt).toLocaleDateString('en-GB')}
                    </td>
                    <td><Badge variant={REG_STATUS[r.status]}>{r.status}</Badge></td>
                    <td style={{ textAlign: 'right' }}>
                      <button onClick={() => setSelectedReg(r)}
                        className="text-sm font-semibold hover:underline"
                        style={{ color: 'var(--sage)' }}>
                        {r.status === 'pending' ? 'Review' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'waiting' && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={selectedWaiting.size > 0 && selectedWaiting.size === waiting.length} onChange={toggleWaitingSelectAll} />
                </th>
                <th>Student</th>
                <th>Family / Contact</th>
                <th>Instrument</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {waiting.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                  No one on the waiting list.
                </td></tr>
              )}
              {waiting.map(s => (
                <tr key={s.id}>
                  <td>
                    <input type="checkbox" checked={selectedWaiting.has(s.id)} onChange={() => toggleWaitingSelected(s.id)} />
                  </td>
                  <td className="font-semibold">
                    <Link href={`/app/students/${s.id}`} className="hover:underline" style={{ color: 'var(--sage-dk)' }}>
                      {s.firstName} {s.lastName}
                    </Link>
                  </td>
                  <td>
                    <div style={{ color: 'var(--txt2)' }}>{s.family?.contactName || s.family?.name || '—'}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--txt4)' }}>{s.family?.email}</div>
                  </td>
                  <td className="text-xs capitalize" style={{ color: 'var(--txt3)' }}>
                    {s.enrollments?.map(e => e.instrument).join(', ') || '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button onClick={() => promoteToTrial(s.id)} disabled={promoting === s.id}
                      className="text-sm font-semibold hover:underline disabled:opacity-50"
                      style={{ color: 'var(--sage)' }}
                      title="Move this student from the waiting list to Trial once their trial lesson is scheduled">
                      {promoting === s.id ? 'Moving…' : 'Move to Trial'}
                    </button>
                  </td>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <button onClick={() => setEditingWaitingId(s.id)} title="Edit student" style={{ color: 'var(--sage-dk)' }}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => withdrawWaitingOne(s.id, `${s.firstName} ${s.lastName}`)}
                        disabled={withdrawingId === s.id} title="Withdraw student" style={{ color: 'var(--coral)' }}
                        className="disabled:opacity-50">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'leads' && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Instrument</th>
                <th>Source</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                  No leads yet.
                </td></tr>
              )}
              {leads.map(l => (
                <tr key={l.id}>
                  <td className="font-semibold">{l.name}</td>
                  <td style={{ color: 'var(--txt3)' }}>{l.contact ?? '—'}</td>
                  <td className="capitalize" style={{ color: 'var(--txt3)' }}>{l.instrumentInterest ?? '—'}</td>
                  <td className="text-xs capitalize" style={{ color: 'var(--txt3)' }}>
                    {l.source?.replace('_', ' ') ?? '—'}
                  </td>
                  <td><Badge variant={LEAD_STATUS[l.status]}>{l.status}</Badge></td>
                  <td>
                    <select value={l.status} disabled={updatingId === l.id}
                      onChange={e => updateLeadStatus(l.id, e.target.value as 'new' | 'contacted' | 'converted' | 'lost')}
                      className="text-xs rounded-lg px-2.5 py-1.5 outline-none transition-all"
                      style={{
                        border: '1.5px solid var(--bd2)',
                        background: '#fff',
                        color: 'var(--txt2)',
                      }}>
                      <option value="new">New</option>
                      <option value="contacted">Contacted</option>
                      <option value="converted">Converted</option>
                      <option value="lost">Lost</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'import' && <ImportCsvPanel />}
    </div>
  );
}
