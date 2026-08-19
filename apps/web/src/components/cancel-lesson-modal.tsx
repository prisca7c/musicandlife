'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Modal } from '@/components/modal';
import { Check, X } from 'lucide-react';

// Shared by the family dashboard's "next lesson" card and the family
// calendar's click-through lesson detail — same policy either way: 24+
// hours' notice is free (rebook or release the slot), inside 24 hours still
// charges the fee.
export function CancelLessonModal({ open, onClose, lessonId, hoursUntil, onCancelled }: {
  open: boolean; onClose: () => void; lessonId: string | null; hoursUntil: number; onCancelled: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function cancelLesson(choice: 'absent_makeup' | 'absent_no_pay') {
    if (!lessonId) return;
    setCancelling(true);
    try {
      await apiFetch(`/family/lessons/${lessonId}/cancel`, {
        method: 'POST', token: tok(), body: JSON.stringify({ choice }),
      });
      onClose();
      onCancelled();
    } catch (e) { console.error(e); }
    finally { setCancelling(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Cancel lesson">
      <div className="space-y-4">
        {hoursUntil >= 24 ? (
          <>
            <p className="text-sm" style={{ color: 'var(--txt3)' }}>
              You have given more than 24 hours&apos; notice, so there is no charge either way.
              Which is it?
            </p>
            <button
              onClick={() => cancelLesson('absent_makeup')}
              disabled={cancelling}
              className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-[var(--sage-md)] bg-[var(--sage-lt)] hover:bg-[var(--sage-lt)] text-left disabled:opacity-50">
              <Check size={18} className="text-[var(--sage-dk)] mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-sm text-[var(--sage-dk)]">I&apos;d like to rebook it</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--txt3)' }}>
                  No charge for this lesson. We&apos;ll arrange another time with your teacher.
                </p>
              </div>
            </button>
            <button
              onClick={() => cancelLesson('absent_no_pay')}
              disabled={cancelling}
              className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-[var(--bd2)] hover:border-[var(--bd)] hover:bg-[var(--surf)] text-left disabled:opacity-50">
              <X size={18} className="text-[var(--txt3)] mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-sm" style={{ color: 'var(--txt)' }}>No lesson needed</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--txt3)' }}>
                  No charge, and we won&apos;t chase you for a new time. The slot is freed.
                </p>
              </div>
            </button>
            <button onClick={onClose} disabled={cancelling} className="ui-btn-ghost w-full">
              Never mind
            </button>
          </>
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--txt3)' }}>
              This lesson is within 24 hours. Cancelling now will still charge the lesson fee, and no extra lesson is given.
            </p>
            <button
              onClick={() => cancelLesson('absent_no_pay')}
              disabled={cancelling}
              className="w-full py-3 px-4 rounded-xl bg-[var(--coral)] text-white font-bold text-sm hover:opacity-90 disabled:opacity-50">
              Confirm cancellation (fee applies)
            </button>
            <button onClick={onClose} disabled={cancelling} className="ui-btn-ghost w-full">
              Never mind
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
