'use client';

import { useState, KeyboardEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { Check, Pencil, X } from 'lucide-react';

/**
 * Admin-only fields with no dedicated editor elsewhere: contact details, group
 * tags, internal notes, and the carried-over payroll balance. Never shown to
 * teachers or families — this page is gated to admin/manager server-side, and
 * none of this is included in the colleague directory or family-portal "your
 * teacher" projections.
 */
export function StaffAdminDetails({
  staffId, firstName, lastName, title, email, hasAccount, phone, address, notes, groupTags, payrollBalance,
}: {
  staffId: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  hasAccount: boolean;
  phone: string | null;
  address: string | null;
  notes: string | null;
  groupTags: string[];
  payrollBalance: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [firstNameV, setFirstNameV] = useState(firstName);
  const [lastNameV, setLastNameV] = useState(lastName);
  const [titleV, setTitleV] = useState(title ?? '');
  const [emailV, setEmailV] = useState(email ?? '');
  const [phoneV, setPhoneV] = useState(phone ?? '');
  const [addressV, setAddressV] = useState(address ?? '');
  const [notesV, setNotesV] = useState(notes ?? '');
  const [tags, setTags] = useState<string[]>(groupTags);
  const [tagInput, setTagInput] = useState('');
  const [noBalance, setNoBalance] = useState(payrollBalance === null);
  const [balanceText, setBalanceText] = useState(payrollBalance === null ? '' : (payrollBalance / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function cancel() {
    setFirstNameV(firstName); setLastNameV(lastName); setTitleV(title ?? '');
    setEmailV(email ?? '');
    setPhoneV(phone ?? ''); setAddressV(address ?? ''); setNotesV(notes ?? '');
    setTags(groupTags);
    setNoBalance(payrollBalance === null);
    setBalanceText(payrollBalance === null ? '' : (payrollBalance / 100).toFixed(2));
    setTagInput(''); setError(''); setEditing(false);
  }

  function addTag() {
    const v = tagInput.trim();
    if (v && !tags.includes(v)) setTags([...tags, v]);
    setTagInput('');
  }

  function onTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
  }

  async function save() {
    const balancePence = noBalance ? null : Math.round(parseFloat(balanceText || '0') * 100);
    if (balancePence !== null && !Number.isFinite(balancePence)) { setError('Enter a valid payroll balance.'); return; }
    if (hasAccount && emailV.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailV.trim())) {
      setError('Enter a valid email.'); return;
    }
    setSaving(true); setError('');
    try {
      await apiFetch(`/staff/${staffId}`, {
        method: 'PATCH', token: tok(),
        body: JSON.stringify({
          firstName: firstNameV, lastName: lastNameV, title: titleV || undefined,
          ...(hasAccount ? { email: emailV.trim() || undefined } : {}),
          phone: phoneV || undefined, address: addressV || undefined, notes: notesV || undefined,
          groupTags: tags, payrollBalance: balancePence,
        }),
      });
      setSavedAt(true); setEditing(false);
      setTimeout(() => setSavedAt(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Admin details</h2>
        {editing ? (
          <span className="text-[11px] font-semibold" style={{ color: 'var(--txt4)' }}>{saving ? 'Saving…' : 'Editing'}</span>
        ) : (
          <button onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color: 'var(--sage)' }}>
            {savedAt ? <>Saved <Check size={12} /></> : <><Pencil size={11} /> Edit</>}
          </button>
        )}
      </div>

      <dl className="space-y-3 text-sm">
        <div className="flex justify-between items-start gap-3">
          <dt style={{ color: 'var(--txt3)' }}>Name</dt>
          <dd className="font-medium text-right">
            {editing
              ? (
                <span className="flex gap-1.5">
                  <input value={firstNameV} onChange={e => setFirstNameV(e.target.value)} className="ui-input" style={{ width: 88 }} />
                  <input value={lastNameV} onChange={e => setLastNameV(e.target.value)} className="ui-input" style={{ width: 88 }} />
                </span>
              )
              : `${firstName} ${lastName}`}
          </dd>
        </div>
        <div className="flex justify-between items-start gap-3">
          <dt style={{ color: 'var(--txt3)' }}>Email</dt>
          <dd className="font-medium text-right">
            {editing
              ? hasAccount
                ? <input type="email" value={emailV} onChange={e => setEmailV(e.target.value)} className="ui-input" style={{ width: 180 }} />
                : <span style={{ color: 'var(--txt4)' }} title="No login account — email can't be set here">—</span>
              : (email ?? '—')}
          </dd>
        </div>
        <div className="flex justify-between items-start gap-3">
          <dt style={{ color: 'var(--txt3)' }}>Title</dt>
          <dd className="font-medium text-right">
            {editing
              ? <input value={titleV} onChange={e => setTitleV(e.target.value)} className="ui-input" style={{ width: 180 }} />
              : (title ?? '—')}
          </dd>
        </div>
        <div className="flex justify-between items-start gap-3">
          <dt style={{ color: 'var(--txt3)' }}>Phone</dt>
          <dd className="font-medium text-right">
            {editing
              ? <input value={phoneV} onChange={e => setPhoneV(e.target.value)} className="ui-input" style={{ width: 180 }} />
              : (phone ?? '—')}
          </dd>
        </div>
        <div className="flex justify-between items-start gap-3">
          <dt style={{ color: 'var(--txt3)' }}>Address</dt>
          <dd className="font-medium text-right">
            {editing
              ? <input value={addressV} onChange={e => setAddressV(e.target.value)} className="ui-input" style={{ width: 180 }} />
              : (address ?? '—')}
          </dd>
        </div>
        <div className="flex justify-between items-start gap-3">
          <dt style={{ color: 'var(--txt3)' }}>Payroll balance</dt>
          <dd className="font-medium text-right">
            {editing
              ? (
                <span className="inline-flex flex-col items-end gap-1.5">
                  <span className="inline-flex items-center gap-1">£<input type="number" step="0.01" value={balanceText} disabled={noBalance}
                    onChange={e => setBalanceText(e.target.value)} className="ui-input text-right" style={{ width: 100, opacity: noBalance ? 0.5 : 1 }} /></span>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--txt3)' }}>
                    <input type="checkbox" checked={noBalance} onChange={e => setNoBalance(e.target.checked)} className="accent-[var(--sage)]" />
                    Not applicable
                  </label>
                </span>
              )
              : payrollBalance === null ? <span style={{ color: 'var(--txt4)' }}>—</span> : formatMoney(payrollBalance)}
          </dd>
        </div>
        <div>
          <dt className="mb-1.5" style={{ color: 'var(--txt3)' }}>Group tags</dt>
          <dd>
            {editing ? (
              <div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium"
                      style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)' }}>
                      {t}
                      <button type="button" onClick={() => setTags(tags.filter(x => x !== t))}><X size={11} /></button>
                    </span>
                  ))}
                </div>
                <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                  onKeyDown={onTagKeyDown} onBlur={addTag}
                  placeholder="Type a tag, press Enter" className="ui-input" />
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.length === 0 && <span style={{ color: 'var(--txt4)' }}>—</span>}
                {tags.map(t => (
                  <span key={t} className="px-2 py-1 rounded-full text-xs font-medium"
                    style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)' }}>{t}</span>
                ))}
              </div>
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1.5" style={{ color: 'var(--txt3)' }}>Notes</dt>
          <dd>
            {editing
              ? <textarea value={notesV} onChange={e => setNotesV(e.target.value)} rows={3} className="ui-input w-full" />
              : <p className="whitespace-pre-line" style={{ color: notes ? undefined : 'var(--txt4)' }}>{notes ?? '—'}</p>}
          </dd>
        </div>
      </dl>

      {editing && (
        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving}
            className="bg-[var(--sage)] text-white rounded-lg px-3.5 py-1.5 text-xs font-semibold hover:bg-[var(--sage-dk)] disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={cancel} disabled={saving}
            className="rounded-lg px-3.5 py-1.5 text-xs font-semibold border hover:bg-gray-50">Cancel</button>
        </div>
      )}
      {error && <p className="text-xs mt-3" style={{ color: 'var(--coral)' }}>{error}</p>}

      <p className="text-[11px] mt-3" style={{ color: 'var(--txt4)' }}>
        Admin-only. Teachers only ever see each other&apos;s name and contact info; parents/students only see their assigned teacher&apos;s name and contact info.
      </p>
    </div>
  );
}
