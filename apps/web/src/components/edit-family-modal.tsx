'use client';

import { useState, useEffect, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { Modal } from '@/components/modal';

interface EditableFamily {
  id: string; name: string; contactName: string | null;
  phone: string | null; email: string | null; address: string | null;
}

// Self-fetching by id (via the same `/families/:id` SWR key the family detail
// page uses) so it can be dropped anywhere a family is referenced — the
// student and parent profile pages only ever load a thin subset of family
// fields (id/name/phone/email), not enough to populate contactName/address.
export function EditFamilyModal({ open, onClose, familyId, onSaved }: {
  open: boolean; onClose: () => void; familyId: string | null; onSaved: () => void;
}) {
  const { data: family } = useApi<EditableFamily>(open && familyId ? `/families/${familyId}` : null);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (!family) return;
    setName(family.name); setContactName(family.contactName ?? '');
    setPhone(family.phone ?? ''); setEmail(family.email ?? ''); setAddress(family.address ?? '');
    setError('');
  }, [family, open]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!familyId) return;
    setSaving(true); setError('');
    try {
      await apiFetch(`/families/${familyId}`, {
        method: 'PATCH', token: tok(), body: JSON.stringify({
          name, contactName: contactName || undefined, phone: phone || undefined,
          email: email || undefined, address: address || undefined,
        }),
      });
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit family">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      {!family ? (
        <p className="text-sm text-center py-4" style={{ color: 'var(--txt4)' }}>Loading…</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="ui-label">Family name <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} required autoFocus className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Contact name</label>
            <input value={contactName} onChange={e => setContactName(e.target.value)} className="ui-input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label">Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} className="ui-input" />
            </div>
            <div>
              <label className="ui-label">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="ui-input" />
            </div>
          </div>
          <div>
            <label className="ui-label">Address</label>
            <textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} className="ui-input" />
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
