'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Badge } from '@/components/badge';

/**
 * Active/inactive toggle for a staff member. Until now this status was
 * display-only (a Badge with no control anywhere in the UI) even though the
 * server fully understands "inactive": the recurrence worker skips an
 * inactive teacher's enrolments (#172) and family self-booking is blocked
 * against one (#193). Those protections only matter if a manager can actually
 * *set* a teacher inactive when they leave — otherwise the only way to do it
 * is a direct API/DB call. This is the missing control.
 *
 * Deactivating stops that teacher's future recurring billing and blocks new
 * bookings, so it gets a confirm; reactivating is reversible and harmless.
 */
export function StaffStatusToggle({
  staffId, initialStatus, teacherName,
}: {
  staffId: string; initialStatus: string; teacherName: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function setActive(next: boolean) {
    const nextStatus = next ? 'active' : 'inactive';
    if (!next && !confirm(
      `Deactivate ${teacherName}? Their recurring lessons will stop being billed going forward and families won't be able to book new lessons with them. Existing scheduled lessons are not cancelled — reassign or cancel those separately. You can reactivate them at any time.`
    )) return;
    setSaving(true);
    try {
      await apiFetch(`/staff/${staffId}`, {
        method: 'PATCH', token: tok(), body: JSON.stringify({ status: nextStatus }),
      });
      setStatus(nextStatus);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not update status');
    } finally { setSaving(false); }
  }

  return (
    <span className="inline-flex items-center gap-2.5">
      <Badge variant={status}>{status}</Badge>
      <button
        onClick={() => setActive(status !== 'active')}
        disabled={saving}
        className="text-xs font-semibold hover:underline disabled:opacity-50"
        style={{ color: status === 'active' ? 'var(--coral)' : 'var(--sage-dk)' }}
      >
        {saving ? '…' : status === 'active' ? 'Deactivate' : 'Reactivate'}
      </button>
    </span>
  );
}
