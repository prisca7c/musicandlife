'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
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
  nextLesson: {
    id: string; startsAt: string; duration: number; isTrialLesson: boolean;
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

export default function FamilyDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [teacherAvail, setTeacherAvail] = useState<AvailWindow[]>([]);
  const [news, setNews] = useState<NewsPost[]>([]);
  const [cancelModal, setCancelModal] = useState<{ lessonId: string; hoursUntil: number } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reschedModal, setReschedModal] = useState<{ lessonId: string } | null>(null);
  const [reschedTimes, setReschedTimes] = useState<[string, string, string]>(['', '', '']);
  const [reschedErr, setReschedErr] = useState('');
  const [reschedSaving, setReschedSaving] = useState(false);
  const [reschedDone, setReschedDone] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function openReschedule(lessonId: string) {
    setReschedTimes(['', '', '']); setReschedErr(''); setReschedDone(false);
    setReschedModal({ lessonId });
  }

  async function submitReschedule() {
    if (!reschedModal) return;
    if (!reschedTimes[0]) { setReschedErr('Please choose at least a first preferred time.'); return; }
    setReschedSaving(true); setReschedErr('');
    try {
      // Send the naive wall-clock exactly as picked (e.g. "2026-07-13T16:00"); the
      // backend interprets it in the studio timezone. Converting via new Date().toISOString()
      // here would wrongly bake in the parent's *browser* timezone. Append seconds if the
      // datetime-local value omits them ("YYYY-MM-DDTHH:MM" is 16 chars).
      const toIso = (v: string) => (v ? (v.length === 16 ? `${v}:00` : v) : undefined);
      await apiFetch('/reschedule-requests', {
        method: 'POST', token: tok(),
        body: JSON.stringify({
          lessonId: reschedModal.lessonId,
          proposedStartsAt: toIso(reschedTimes[0]),
          proposedStartsAt2: toIso(reschedTimes[1]),
          proposedStartsAt3: toIso(reschedTimes[2]),
        }),
      });
      setReschedDone(true);
    } catch (e) { setReschedErr(e instanceof Error ? e.message : 'Could not send request'); }
    finally { setReschedSaving(false); }
  }

  useEffect(() => {
    apiFetch<DashboardData>('/family/dashboard', { token: tok() })
      .then(setData).catch(() => {});
    apiFetch<AvailWindow[]>('/family/teacher-availability', { token: tok() })
      .then(setTeacherAvail).catch(() => {});
    apiFetch<NewsPost[]>('/news', { token: tok() })
      .then(rows => setNews(rows.slice(0, 3))).catch(() => {});
  }, []);

  async function cancelLesson(choice: 'absent_makeup' | 'absent_no_pay') {
    if (!cancelModal) return;
    setCancelling(true);
    try {
      await apiFetch(`/family/lessons/${cancelModal.lessonId}/cancel`, {
        method: 'POST', token: tok(),
        body: JSON.stringify({ choice }),
      });
      setCancelModal(null);
      apiFetch<DashboardData>('/family/dashboard', { token: tok() }).then(setData).catch(() => {});
    } catch (e) { console.error(e); }
    finally { setCancelling(false); }
  }

  if (!data) return <div className="p-8 text-[var(--txt3)]">Loading…</div>;

  const { nextLesson, balance, outstandingInvoice, students, lastNote } = data;
  const hoursUntil = nextLesson ? (new Date(nextLesson.startsAt).getTime() - Date.now()) / 3600000 : 0;

  return (
    <div>
      <PageHeader title="My Dashboard" subtitle="Your family's lessons at a glance" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Next lesson ── */}
        <div className="lg:col-span-2 bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--txt3)' }}>Next lesson</p>
          {nextLesson ? (
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="font-bold text-lg" style={{ color: 'var(--txt)' }}>
                  {nextLesson.student?.firstName} {nextLesson.student?.lastName}
                  {nextLesson.isTrialLesson && (
                    <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--amber-lt)] text-[var(--amber)]">Trial</span>
                  )}
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--txt3)' }}>
                  with {nextLesson.teacher?.firstName} {nextLesson.teacher?.lastName}
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
                <Link href="/app/family/book"
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl border font-medium hover:bg-[var(--surf)]"
                  style={{ borderColor: 'var(--bd2)', color: 'var(--txt)' }}>
                  <Plus size={13} /> Book another
                </Link>
                {hoursUntil >= 24 && (
                  <button
                    onClick={() => openReschedule(nextLesson.id)}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl border font-medium hover:bg-[var(--surf)]"
                    style={{ borderColor: 'var(--bd2)', color: 'var(--txt)' }}>
                    <CalendarClock size={13} /> Request reschedule
                  </button>
                )}
                {hoursUntil > 0 && (
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
              <Link href="/app/family/book"
                className="inline-flex items-center gap-1.5 bg-[var(--sage)] text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-[var(--sage-dk)]">
                <Plus size={14} /> Book a lesson
              </Link>
            </div>
          )}
        </div>

        {/* ── Balance / invoice ── */}
        <div className="space-y-4">
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
            </div>
          )}
        </div>

        {/* ── Students / lessons remaining ── */}
        <div className="lg:col-span-2 bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
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

        {/* ── Last note ── */}
        {lastNote && (
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
              <span>Give up to three preferred times, in order of preference.</span>
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
                <input
                  type="datetime-local"
                  value={reschedTimes[i]}
                  onChange={(e) => setReschedTimes((t) => { const n = [...t] as [string, string, string]; n[i] = e.target.value; return n; })}
                  className="ui-input"
                />
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
