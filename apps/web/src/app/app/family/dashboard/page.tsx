'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { useMe } from '@/lib/use-me';
import { fmtTime, fmtDate } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { PaidDot } from '@/components/paid-dot';
import { AvailabilityWeekGrid, type AvailWindow } from '@/components/availability-week-grid';
import { Modal } from '@/components/modal';
import { InfoTooltip } from '@/components/info-tooltip';
import { linkify } from '@/lib/linkify';
import {
  Calendar, Clock, BookOpen, AlertCircle,
  Plus, X, Check, Megaphone, CalendarClock,
} from 'lucide-react';

interface NewsPost { id: string; title: string; body: string; publishedAt: string; }

interface DashboardData {
  // 'student' means a pupil is signed in with their own login; the API omits
  // the family's money entirely in that case.
  viewer: 'student' | 'guardian';
  nextLesson: {
    id: string; startsAt: string; duration: number; isTrialLesson: boolean;
    instrument: string | null; meetingLink: string | null;
    teacher: { firstName: string; lastName: string } | null;
    student: { firstName: string; lastName: string } | null;
  } | null;
  balance: number;
  outstandingInvoice: { id: string; number: string; total: number; dueDate: string } | null;
  students: {
    id: string; firstName: string; lastName: string; status: string;
    lessons: { total: number; prepaid: number; makeup: number };
  }[];
  lastNote: { body: string; student: { firstName: string; lastName: string } | null } | null;
}

// 15-minute time slots (08:00–21:00) so parents pick a tidy time, never "3:27pm".
const RESCHED_TIME_OPTIONS = (() => {
  const out: { value: string; label: string }[] = [];
  for (let m = 8 * 60; m <= 21 * 60; m += 15) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const value = `${hh}:${mm}`;
    const h12 = ((Math.floor(m / 60) + 11) % 12) + 1;
    const ampm = m < 12 * 60 ? 'am' : 'pm';
    out.push({ value, label: `${h12}:${mm} ${ampm}` });
  }
  return out;
})();

export default function FamilyDashboardPage() {
  // Cached reads — the portal renders instantly on revisit, then revalidates.
  // mutateData() refreshes the dashboard after a payment or cancellation.
  const { data, mutate: mutateData } = useApi<DashboardData>('/family/dashboard');
  const { firstName } = useMe();
  const { data: teacherAvail = [] } = useApi<AvailWindow[]>('/family/teacher-availability');
  const { data: newsRaw = [] } = useApi<NewsPost[]>('/news');
  const news = newsRaw.slice(0, 3);
  const [cancelModal, setCancelModal] = useState<{ lessonId: string; hoursUntil: number } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reschedModal, setReschedModal] = useState<{ lessonId: string } | null>(null);
  // Three preferred slots, each a date + a 15-minute time (kept separate so the
  // time picker can only offer :00/:15/:30/:45 — no "3:27pm").
  const [reschedDates, setReschedDates] = useState<[string, string, string]>(['', '', '']);
  const [reschedTimes, setReschedTimes] = useState<[string, string, string]>(['', '', '']);
  const [reschedErr, setReschedErr] = useState('');
  const [reschedSaving, setReschedSaving] = useState(false);
  const [reschedDone, setReschedDone] = useState(false);
  const [confirmPay, setConfirmPay] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState('');
  // Set once the family has told us they've sent the transfer. The invoice stays
  // "due" until the money is actually seen on the statement, so the card has to
  // say something other than "pay this" in the meantime.
  const [claimed, setClaimed] = useState(false);
  const { data: paymentDetails } = useApi<{ reference: string }>('/family/payment-details');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function openReschedule(lessonId: string) {
    setReschedDates(['', '', '']); setReschedTimes(['', '', '']);
    setReschedErr(''); setReschedDone(false);
    setReschedModal({ lessonId });
  }

  async function submitReschedule() {
    if (!reschedModal) return;
    if (!reschedDates[0] || !reschedTimes[0]) { setReschedErr('Please choose a date and time for your first preferred slot.'); return; }
    setReschedSaving(true); setReschedErr('');
    try {
      // Compose the naive wall-clock exactly as picked (e.g. "2026-07-13T16:00:00");
      // the backend interprets it in the studio timezone. Converting via
      // new Date().toISOString() here would wrongly bake in the parent's *browser*
      // timezone. A choice only counts when both its date and time are set.
      const toIso = (i: number) =>
        reschedDates[i] && reschedTimes[i] ? `${reschedDates[i]}T${reschedTimes[i]}:00` : undefined;
      await apiFetch('/reschedule-requests', {
        method: 'POST', token: tok(),
        body: JSON.stringify({
          lessonId: reschedModal.lessonId,
          proposedStartsAt: toIso(0),
          proposedStartsAt2: toIso(1),
          proposedStartsAt3: toIso(2),
        }),
      });
      setReschedDone(true);
    } catch (e) { setReschedErr(e instanceof Error ? e.message : 'Could not send request'); }
    finally { setReschedSaving(false); }
  }

  async function markInvoicePaid() {
    if (!data?.outstandingInvoice) return;
    setPaying(true); setPayErr('');
    try {
      await apiFetch(`/family/invoices/${data.outstandingInvoice.id}/mark-paid`, {
        method: 'POST', token: tok(),
      });
      setConfirmPay(false);
      setClaimed(true);
      mutateData();
    } catch (e) { setPayErr(e instanceof Error ? e.message : 'Could not record payment'); }
    finally { setPaying(false); }
  }

  async function cancelLesson(choice: 'absent_makeup' | 'absent_no_pay') {
    if (!cancelModal) return;
    setCancelling(true);
    try {
      await apiFetch(`/family/lessons/${cancelModal.lessonId}/cancel`, {
        method: 'POST', token: tok(),
        body: JSON.stringify({ choice }),
      });
      setCancelModal(null);
      mutateData();
    } catch (e) { console.error(e); }
    finally { setCancelling(false); }
  }

  if (!data) return <div className="p-8 text-[var(--txt3)]">Loading…</div>;

  const { nextLesson, balance, outstandingInvoice, students, lastNote } = data;
  const hoursUntil = nextLesson ? (new Date(nextLesson.startsAt).getTime() - Date.now()) / 3600000 : 0;

  // A pupil's home page is not a smaller parent home page. Money — the balance,
  // an invoice due, the "I've sent the transfer" button — is between the studio
  // and whoever pays; a child was being shown all of it. What's left is what
  // they actually need: the next lesson, what to bring, and what their teacher
  // last wrote. Changing or cancelling a lesson has a fee attached, so that
  // stays with the parent too.
  const isStudent = data.viewer === 'student';
  const isToday = nextLesson
    ? new Date(nextLesson.startsAt).toDateString() === new Date().toDateString()
    : false;

  return (
    <div>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        subtitle={isStudent ? 'Your lessons and notes' : "Your family's lessons at a glance"}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Next lesson ── */}
        <div className="lg:col-span-2 bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--txt3)' }}>
            {isToday ? 'Today' : 'Next lesson'}
          </p>
          {nextLesson ? (
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="font-bold text-lg" style={{ color: 'var(--txt)' }}>
                  {/* A pupil already knows who they are — lead with the lesson. */}
                  {isStudent
                    ? (nextLesson.instrument
                        ? nextLesson.instrument.charAt(0).toUpperCase() + nextLesson.instrument.slice(1)
                        : 'Your lesson')
                    : `${nextLesson.student?.firstName ?? ''} ${nextLesson.student?.lastName ?? ''}`}
                  {nextLesson.isTrialLesson && (
                    <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--amber-lt)] text-[var(--amber)]">Trial</span>
                  )}
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--txt3)' }}>
                  with {nextLesson.teacher?.firstName} {nextLesson.teacher?.lastName}
                  {!isStudent && nextLesson.instrument ? ` · ${nextLesson.instrument}` : ''}
                </p>
                <div className="flex items-center gap-4 mt-3 text-sm" style={{ color: 'var(--txt3)' }}>
                  <span className="flex items-center gap-1.5">
                    <Calendar size={14} />
                    {fmtDate(nextLesson.startsAt, { weekday: 'long', day: 'numeric', month: 'long' })}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock size={14} />
                    {fmtTime(nextLesson.startsAt)}
                    {' '}({nextLesson.duration} min)
                  </span>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {/* Rescheduling and cancelling both have a fee attached, so they
                    belong to whoever pays the bill — not to the pupil. */}
                {isStudent ? (
                  <p className="text-xs max-w-[14rem]" style={{ color: 'var(--txt4)' }}>
                    Need to move or cancel this lesson? Ask a parent — they can do it from their account.
                  </p>
                ) : (
                  <Link href="/app/family/book"
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl border font-medium hover:bg-[var(--surf)]"
                    style={{ borderColor: 'var(--bd2)', color: 'var(--txt)' }}>
                    <Plus size={13} /> Book another
                  </Link>
                )}
                {!isStudent && hoursUntil >= 24 && (
                  <button
                    onClick={() => openReschedule(nextLesson.id)}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl border font-medium hover:bg-[var(--surf)]"
                    style={{ borderColor: 'var(--bd2)', color: 'var(--txt)' }}>
                    <CalendarClock size={13} /> Request reschedule
                  </button>
                )}
                {!isStudent && hoursUntil > 0 && (
                  <button
                    onClick={() => setCancelModal({ lessonId: nextLesson.id, hoursUntil })}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl border font-medium hover:bg-[var(--coral-lt)]"
                    style={{ borderColor: 'var(--bd2)', color: 'var(--coral)' }}>
                    <X size={13} /> Cancel lesson
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-sm mb-3" style={{ color: 'var(--txt3)' }}>No upcoming lessons.</p>
              {isStudent ? (
                <p className="text-xs" style={{ color: 'var(--txt4)' }}>Your parent can book your next one.</p>
              ) : (
                <Link href="/app/family/book"
                  className="inline-flex items-center gap-1.5 bg-[var(--sage)] text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-[var(--sage-dk)]">
                  <Plus size={14} /> Book a lesson
                </Link>
              )}
            </div>
          )}
        </div>

        {/* ── What the teacher last wrote — the student's main reason to be here ── */}
        {isStudent && (
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--txt3)' }}>
              <BookOpen size={12} className="inline mr-1" /> From your last lesson
            </p>
            {lastNote ? (
              <>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--txt)' }}>{lastNote.body}</p>
                <Link href="/app/family/notes" className="inline-block mt-3 text-xs font-semibold text-[var(--sage-dk)] hover:underline">
                  All lesson notes →
                </Link>
              </>
            ) : (
              <p className="text-sm" style={{ color: 'var(--txt3)' }}>
                No notes yet — your teacher&apos;s notes will appear here after your lesson.
              </p>
            )}
          </div>
        )}

        {/* ── Balance / invoice — parents only ── */}
        <div className={`space-y-4 ${isStudent ? 'hidden' : ''}`}>
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2" style={{ color: 'var(--txt3)' }}>
              Account balance
              <PaidDot paid={balance >= 0} title={balance >= 0 ? 'Paid up' : 'You have an outstanding balance'} />
            </p>
            <p className={`text-2xl font-black ${balance >= 0 ? 'text-[var(--sage-dk)]' : 'text-[var(--coral)]'}`}>
              {balance >= 0 ? '+' : ''}£{Math.abs(balance / 100).toFixed(2)}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--txt4)' }}>
              {balance >= 0 ? 'credit on account' : 'outstanding balance'}
            </p>
          </div>

          {outstandingInvoice && (
            <div className="bg-[var(--amber-lt)] rounded-2xl border border-[var(--amber-md)] p-4">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="text-[var(--amber)] mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-[var(--amber)]">Invoice due</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--txt3)' }}>
                    {outstandingInvoice.number} · £{(outstandingInvoice.total / 100).toFixed(2)} · due {outstandingInvoice.dueDate}
                  </p>
                </div>
              </div>

              {claimed ? (
                <p className="mt-3 text-xs" style={{ color: 'var(--txt3)' }}>
                  Thanks — we&apos;ll confirm {outstandingInvoice.number} as paid once the transfer
                  reaches the studio account. You don&apos;t need to do anything else.
                </p>
              ) : !confirmPay ? (
                <button
                  onClick={() => { setPayErr(''); setConfirmPay(true); }}
                  className="mt-3 w-full rounded-xl bg-[var(--amber)] text-white text-sm font-semibold py-2 hover:opacity-90 transition"
                >
                  I&apos;ve sent the transfer
                </button>
              ) : (
                <div className="mt-3">
                  <p className="text-xs mb-2" style={{ color: 'var(--txt3)' }}>
                    Send £{(outstandingInvoice.total / 100).toFixed(2)} by bank transfer, quoting
                    this reference so we can match your payment:
                  </p>
                  {/* The reference is the whole mechanism — without it an incoming
                      transfer can't be tied to a family automatically. */}
                  <p className="mb-2 rounded-lg px-2 py-1.5 text-center text-sm font-bold tracking-wider"
                     style={{ background: 'var(--bg)', color: 'var(--txt)' }}>
                    {paymentDetails?.reference ?? 'Loading…'}
                  </p>
                  {payErr && <p className="text-xs text-[var(--coral)] mb-2">{payErr}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={markInvoicePaid}
                      disabled={paying}
                      className="flex-1 rounded-xl bg-[var(--amber)] text-white text-sm font-semibold py-2 hover:opacity-90 transition disabled:opacity-60"
                    >
                      {paying ? 'Sending…' : "I've sent it"}
                    </button>
                    <button
                      onClick={() => setConfirmPay(false)}
                      disabled={paying}
                      className="rounded-xl border text-sm font-semibold py-2 px-3"
                      style={{ borderColor: 'var(--bd)', color: 'var(--txt3)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Students / lessons remaining ── */}
        <div className={`lg:col-span-2 bg-white rounded-2xl border p-5 ${isStudent ? 'hidden' : ''}`} style={{ borderColor: 'var(--bd)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--txt3)' }}>Students</p>
          <div className="space-y-3">
            {students.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0" style={{ borderColor: 'var(--bd)' }}>
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>{s.firstName} {s.lastName}</p>
                  <Badge variant={s.status}>{s.status}</Badge>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black" style={{ color: 'var(--sage-dk)' }}>{s.lessons.total}</p>
                  <p className="text-xs" style={{ color: 'var(--txt4)' }}>
                    lessons available
                    {s.lessons.makeup > 0 && ` (${s.lessons.makeup} makeup)`}
                  </p>
                </div>
              </div>
            ))}
            {students.length === 0 && (
              <p className="text-sm py-3 text-center" style={{ color: 'var(--txt3)' }}>No students found.</p>
            )}
          </div>
        </div>

        {/* ── Teacher availability ── */}
        {teacherAvail.length > 0 && (
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5" style={{ color: 'var(--txt3)' }}>
              <CalendarClock size={12} /> When your teacher is free
            </p>
            <p className="text-[11px] mb-3" style={{ color: 'var(--txt4)' }}>Shaded hours are when your teacher can take lessons — use “Book a lesson” to grab a slot.</p>
            <AvailabilityWeekGrid windows={teacherAvail} />
          </div>
        )}

        {/* ── Studio News ── */}
        {news.length > 0 && (
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--txt3)' }}>
              <Megaphone size={12} className="inline mr-1" /> Studio News
            </p>
            <div className="space-y-3">
              {news.map(n => (
                <div key={n.id}>
                  <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{n.title}</p>
                  <p className="text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--txt3)' }}>{linkify(n.body)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lessons remaining — the one number a pupil benefits from knowing,
            with none of the family's money attached to it. */}
        {isStudent && students[0] && (
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--txt3)' }}>Lessons available</p>
            <p className="text-2xl font-black" style={{ color: 'var(--sage-dk)' }}>{students[0].lessons.total}</p>
            {students[0].lessons.makeup > 0 && (
              <p className="text-xs mt-1" style={{ color: 'var(--txt4)' }}>includes {students[0].lessons.makeup} makeup</p>
            )}
          </div>
        )}

        {/* ── Last note (parent view; students get the fuller card above) ── */}
        {!isStudent && lastNote && (
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--txt3)' }}>
              <BookOpen size={12} className="inline mr-1" /> Latest note
            </p>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--txt3)' }}>
              {lastNote.student?.firstName} {lastNote.student?.lastName}
            </p>
            <p className="text-sm leading-relaxed line-clamp-4" style={{ color: 'var(--txt)' }}>{lastNote.body}</p>
          </div>
        )}
      </div>

      {/* ── Cancel modal ── */}
      <Modal open={!!cancelModal} onClose={() => setCancelModal(null)} title="Cancel lesson">
        <div className="space-y-4">
          {cancelModal && cancelModal.hoursUntil >= 24 ? (
            <>
              <p className="text-sm" style={{ color: 'var(--txt3)' }}>
                You have given more than 24 hours notice. Choose an option:
              </p>
              <button
                onClick={() => cancelLesson('absent_makeup')}
                disabled={cancelling}
                className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-[var(--sage-md)] bg-[var(--sage-lt)] hover:bg-[var(--sage-lt)] text-left disabled:opacity-50">
                <Check size={18} className="text-[var(--sage-dk)] mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold text-sm text-[var(--sage-dk)]">Get a makeup lesson</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--txt3)' }}>
                    Your lesson fee is still charged, but you receive a lesson you can book again, free of charge.
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
                    No charge and no makeup lesson. The lesson slot is freed.
                  </p>
                </div>
              </button>
            </>
          ) : (
            <>
              <p className="text-sm" style={{ color: 'var(--txt3)' }}>
                This lesson is within 24 hours. Cancelling now will still charge the lesson fee — no extra lesson is given.
              </p>
              <button
                onClick={() => cancelLesson('absent_no_pay')}
                disabled={cancelling}
                className="w-full py-3 px-4 rounded-xl bg-[var(--coral)] text-white font-bold text-sm hover:opacity-90 disabled:opacity-50">
                Confirm cancellation (fee applies)
              </button>
            </>
          )}
        </div>
      </Modal>

      {/* ── Request reschedule ── */}
      <Modal open={!!reschedModal} onClose={() => setReschedModal(null)} title="Request a reschedule">
        {reschedDone ? (
          <div className="text-center py-4">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-full mb-3"
              style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)' }}>
              <Check size={22} />
            </div>
            <p className="font-semibold" style={{ color: 'var(--txt)' }}>Request sent</p>
            <p className="text-sm mt-1" style={{ color: 'var(--txt3)' }}>
              The studio will pick whichever of your preferred times works best for the teacher and let you know.
            </p>
            <button onClick={() => setReschedModal(null)} className="ui-btn-primary mt-4">Done</button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm flex items-start gap-1.5" style={{ color: 'var(--txt3)' }}>
              <span>Give up to three preferred slots, in order of preference. The studio picks whichever works best for the teacher.</span>
              <InfoTooltip text="You don't have to match the teacher's schedule yourself — offering a few options lets the studio slot you into a time the teacher is actually free, often back-to-back with other lessons. Only your 1st choice is required." />
            </p>
            {reschedErr && (
              <div className="text-sm rounded-xl px-4 py-3"
                style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
                {reschedErr}
              </div>
            )}
            {([0, 1, 2] as const).map((i) => (
              <div key={i}>
                <label className="ui-label">
                  {i === 0 ? '1st choice' : i === 1 ? '2nd choice' : '3rd choice'}
                  {i === 0 ? <span style={{ color: 'var(--coral)' }}> *</span> : <span className="font-normal text-[11px]" style={{ color: 'var(--txt4)' }}> (optional)</span>}
                </label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={reschedDates[i]}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setReschedDates((t) => { const n = [...t] as [string, string, string]; n[i] = e.target.value; return n; })}
                    className="ui-input flex-1"
                  />
                  <select
                    value={reschedTimes[i]}
                    onChange={(e) => setReschedTimes((t) => { const n = [...t] as [string, string, string]; n[i] = e.target.value; return n; })}
                    className="ui-input w-32 shrink-0"
                  >
                    <option value="">Time…</option>
                    {RESCHED_TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            ))}
            <div className="flex gap-3 pt-1">
              <button onClick={submitReschedule} disabled={reschedSaving} className="ui-btn-primary">
                {reschedSaving ? 'Sending…' : 'Send request'}
              </button>
              <button onClick={() => setReschedModal(null)} className="ui-btn-ghost">Cancel</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
