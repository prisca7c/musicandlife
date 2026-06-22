'use client';

import { useState, useEffect, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { ALL_INSTRUMENTS } from '@music-life/types';
import { Plus, CircleCheck, CircleX } from 'lucide-react';

interface Registration {
  id: string; status: string; submittedAt: string; denyReason: string | null;
  payload: {
    studentFirstName: string; studentLastName: string;
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

  async function approve() {
    setActioning(true); setError('');
    try {
      await apiFetch(`/registrations/${reg!.id}/approve`, { method: 'POST', token: tok() });
      onDecision(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setActioning(false); }
  }

  async function deny() {
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
            { label: 'Family', value: p.familyName },
            { label: 'Contact', value: p.contactName },
            { label: 'Email', value: p.contactEmail },
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
                Creates the family, student, and enrollments. Sends a welcome email with portal login link.
              </p>
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
          <select name="instrumentInterest" className="ui-input">
            <option value="">Not specified</option>
            {ALL_INSTRUMENTS.map(i => <option key={i} value={i} className="capitalize">{i}</option>)}
          </select>
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

export default function IntakePage() {
  const [tab, setTab] = useState<'registrations' | 'leads'>('registrations');
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [regFilter, setRegFilter] = useState('pending');
  const [selectedReg, setSelectedReg] = useState<Registration | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [showAddLead, setShowAddLead] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function loadRegistrations() {
    apiFetch<Registration[]>(`/registrations?status=${regFilter}`, { token: tok() })
      .then(setRegistrations).catch(() => {});
  }
  function loadLeads() {
    apiFetch<Lead[]>('/leads', { token: tok() }).then(setLeads).catch(() => {});
  }

  useEffect(() => { loadRegistrations(); }, [regFilter]);
  useEffect(() => { loadLeads(); }, []);

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

      <PageHeader
        title="Intake"
        subtitle={
          tab === 'registrations' && regFilter === 'pending' && pending > 0 ? `${pending} pending review` :
          tab === 'leads' ? `${leads.length} lead${leads.length !== 1 ? 's' : ''}` : undefined
        }
        action={
          tab === 'leads'
            ? <button onClick={() => setShowAddLead(true)} className="ui-btn-primary"><Plus size={15} /> Add lead</button>
            : undefined
        }
      />

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b" style={{ borderColor: 'var(--bd)' }}>
        {(['registrations', 'leads'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors"
            style={{
              borderColor: tab === t ? 'var(--sage)' : 'transparent',
              color: tab === t ? 'var(--sage)' : 'var(--txt3)',
            }}>
            {t === 'registrations' ? 'Registrations' : 'Leads & Waitlist'}
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
    </div>
  );
}
