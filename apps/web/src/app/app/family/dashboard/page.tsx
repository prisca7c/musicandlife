'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { useMe } from '@/lib/use-me';
import { fmtTime, fmtDate, studioDayString } from '@/lib/datetime';
import { formatMoney, formatBalance } from '@/lib/money';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { PaidDot } from '@/components/paid-dot';
import { AvailabilityWeekGrid, type AvailWindow } from '@/components/availability-week-grid';
import { Modal } from '@/components/modal';
import { CancelLessonModal } from '@/components/cancel-lesson-modal';
import { RescheduleLessonModal } from '@/components/reschedule-lesson-modal';
import { linkify } from '@/lib/linkify';
import {
  Calendar, Clock, BookOpen, AlertCircle,
  Plus, X, Megaphone, CalendarClock,
} from 'lucide-react';

interface NewsPost { id: string; title: string; body: string; publishedAt: string; }

interface DashboardData {
  // 'student' means a pupil is signed in with their own login rather than a
  // parent — used only to soften some copy/framing below. The API returns the
  // same balance/invoice/booking data either way: a student may be an adult
  // with no guardian account managing their own lessons and payments.
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

export default function FamilyDashboardPage() {
  // Cached reads — the portal renders instantly on revisit, then revalidates.
  // mutateData() refreshes the dashboard after a payment or cancellation.
  const { data, mutate: mutateData } = useApi<DashboardData>('/family/dashboard');
  const { firstName } = useMe();
  const { data: teacherAvail = [] } = useApi<AvailWindow[]>('/family/teacher-availability');
  const { data: teachers = [] } = useApi<{ id: string; firstName: string; lastName: string; phone: string | null; user: { email: string } | null }[]>('/family/teachers');
  const { data: newsRaw = [] } = useApi<NewsPost[]>('/news');
  const news = newsRaw.slice(0, 3);
  const [availTeacherFilter, setAvailTeacherFilter] = useState<string>('all');
  const [cancelModal, setCancelModal] = useState<{ lessonId: string; hoursUntil: number } | null>(null);
  const [reschedModal, setReschedModal] = useState<{ lessonId: string } | null>(null);
  // How the family says they'll pay. Bank transfer keeps the existing
  // reference + "I've sent it" self-reported claim flow. Cash is purely
  // informational — a staff member records it by hand once received, so
  // there's nothing here to claim automatically. Online has no processor
  // wired up (Mollie card payments were removed) — shown but disabled.
  const [payMethod, setPayMethod] = useState<'bank' | 'cash' | null>(null);
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState('');
  // Set once the family has told us they've sent the transfer. The invoice stays
  // "due" until the money is actually seen on the statement, so the card has to
  // say something other than "pay this" in the meantime.
  const [claimed, setClaimed] = useState(false);
  const { data: paymentDetails } = useApi<{
    reference: string;
    bank: { accountName: string | null; sortCode: string | null; accountNumber: string | null };
    bankConfigured: boolean;
  }>('/family/payment-details');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function openReschedule(lessonId: string) {
    setReschedModal({ lessonId });
  }

  async function markInvoicePaid() {
    if (!data?.outstandingInvoice) return;
    setPaying(true); setPayErr('');
    try {
      await apiFetch(`/family/invoices/${data.outstandingInvoice.id}/mark-paid`, {
        method: 'POST', token: tok(),
      });
      setPayMethod(null);
      setClaimed(true);
      mutateData();
    } catch (e) { setPayErr(e instanceof Error ? e.message : 'Could not record payment'); }
    finally { setPaying(false); }
  }

  if (!data) return <div className="p-8 text-[var(--txt3)]">Loading…</div>;

  const { nextLesson, balance, outstandingInvoice, students, lastNote } = data;
  const hoursUntil = nextLesson ? (new Date(nextLesson.startsAt).getTime() - Date.now()) / 3600000 : 0;

  // A student login may be an adult with no guardian account at all, so the
  // student portal needs full parity with the parent portal — booking,
  // rescheduling, cancelling, paying invoices, all of it. `isStudent` here only
  // adjusts copy/framing (leading with the lesson instead of a child's name),
  // never gates an action a guardian could take.
  const isStudent = data.viewer === 'student';
  const isToday = nextLesson
    ? studioDayString(nextLesson.startsAt) === studioDayString(new Date())
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
                No notes yet. Your teacher&apos;s notes will appear here after your lesson.
              </p>
            )}
          </div>
        )}

        {/* ── Balance / invoice ── */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2" style={{ color: 'var(--txt3)' }}>
              Account balance
              <PaidDot paid={balance >= 0} title={balance >= 0 ? 'Paid up' : 'You have an outstanding balance'} />
            </p>
            <p className={`text-2xl font-black ${balance >= 0 ? 'text-[var(--sage-dk)]' : 'text-[var(--coral)]'}`}>
              {formatBalance(balance)}
            </p>
            {/* "Nothing to pay" on its own read as an error to families. Say
                what the number means and what, if anything, they should do. */}
            <p className="text-xs mt-1" style={{ color: 'var(--txt4)' }}>
              {balance > 0
                ? 'in credit, nothing to pay right now'
                : balance === 0
                  ? 'all settled, nothing to pay right now'
                  : outstandingInvoice
                    ? 'owing, see the invoice below'
                    : 'owing, we’ll invoice you for this'}
            </p>
          </div>

          {outstandingInvoice && (
            <div className="bg-[var(--amber-lt)] rounded-2xl border border-[var(--amber-md)] p-4">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="text-[var(--amber)] mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-[var(--amber)]">Invoice due</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--txt3)' }}>
                    {outstandingInvoice.number} · {formatMoney(outstandingInvoice.total)} · due {outstandingInvoice.dueDate}
                  </p>
                </div>
              </div>

              {claimed ? (
                <p className="mt-3 text-xs" style={{ color: 'var(--txt3)' }}>
                  Thanks! We&apos;ll confirm {outstandingInvoice.number} as paid once the transfer
                  reaches the studio account. You don&apos;t need to do anything else.
                </p>
              ) : payMethod === 'cash' ? (
                <div className="mt-3">
                  <p className="text-xs" style={{ color: 'var(--txt3)' }}>
                    Pay {formatMoney(outstandingInvoice.total)} in cash at the studio. A staff member
                    will mark {outstandingInvoice.number} as paid once it&apos;s received. You don&apos;t
                    need to do anything else here.
                  </p>
                  <button
                    onClick={() => setPayMethod(null)}
                    className="mt-2 text-xs font-semibold"
                    style={{ color: 'var(--txt3)' }}
                  >
                    ← Choose a different way to pay
                  </button>
                </div>
              ) : !payMethod ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    disabled
                    title="Card payments aren't set up yet"
                    className="rounded-xl border text-xs font-semibold py-2 px-1 opacity-50 cursor-not-allowed"
                    style={{ borderColor: 'var(--bd)', color: 'var(--txt3)' }}
                  >
                    Pay online
                    <span className="block text-[10px] font-normal mt-0.5">Coming soon</span>
                  </button>
                  <button
                    onClick={() => { setPayErr(''); setPayMethod('bank'); }}
                    className="rounded-xl bg-[var(--amber)] text-white text-xs font-semibold py-2 px-1 hover:opacity-90 transition"
                  >
                    Bank transfer
                  </button>
                  <button
                    onClick={() => { setPayErr(''); setPayMethod('cash'); }}
                    className="rounded-xl border text-xs font-semibold py-2 px-1 hover:bg-[var(--bg)] transition"
                    style={{ borderColor: 'var(--bd)', color: 'var(--txt2)' }}
                  >
                    Cash
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="text-xs mb-2" style={{ color: 'var(--txt3)' }}>
                    Send {formatMoney(outstandingInvoice.total)} by bank transfer to:
                  </p>
                  {/* Where the money actually goes. This card used to give the
                      reference and nothing else — half an instruction. */}
                  {paymentDetails?.bankConfigured ? (
                    <dl className="mb-2 rounded-lg px-2.5 py-2 text-xs" style={{ background: 'var(--bg)' }}>
                      {paymentDetails.bank.accountName && (
                        <div className="flex justify-between gap-3">
                          <dt style={{ color: 'var(--txt3)' }}>Account name</dt>
                          <dd className="font-semibold" style={{ color: 'var(--txt)' }}>{paymentDetails.bank.accountName}</dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-3">
                        <dt style={{ color: 'var(--txt3)' }}>Sort code</dt>
                        <dd className="font-semibold tabular-nums" style={{ color: 'var(--txt)' }}>{paymentDetails.bank.sortCode}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt style={{ color: 'var(--txt3)' }}>Account number</dt>
                        <dd className="font-semibold tabular-nums" style={{ color: 'var(--txt)' }}>{paymentDetails.bank.accountNumber}</dd>
                      </div>
                    </dl>
                  ) : paymentDetails ? (
                    <p className="mb-2 rounded-lg px-2.5 py-2 text-xs" style={{ background: 'var(--bg)', color: 'var(--txt3)' }}>
                      Please contact the studio for the account details.
                    </p>
                  ) : null}
                  <p className="text-xs mb-1" style={{ color: 'var(--txt3)' }}>
                    Quote this reference so we can match your payment:
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
                      onClick={() => setPayMethod(null)}
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
        <div className="lg:col-span-2 bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--txt3)' }}>
            {isStudent ? 'Lessons available' : 'Students'}
          </p>
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

        {/* ── Your teacher(s) — name + contact only, scoped to this family's own
             assigned teachers (never the whole studio roster) by /family/teachers. ── */}
        {teachers.length > 0 && (
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--txt3)' }}>
              Your teacher{teachers.length > 1 ? 's' : ''}
            </p>
            <div className="space-y-2">
              {teachers.map(t => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{t.firstName} {t.lastName}</span>
                  <span className="text-right" style={{ color: 'var(--txt3)' }}>
                    {t.user?.email && <span className="block">{t.user.email}</span>}
                    {t.phone && <span className="block">{t.phone}</span>}
                    {!t.user?.email && !t.phone && '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Teacher availability — spans the full width (was stuck at 1/3
             with the other two columns sitting empty beside it) and, with more
             than one teacher, a switcher to view one at a time instead of
             everyone's hours blended into one hard-to-read grid. ── */}
        {teacherAvail.length > 0 && (
          <div className="lg:col-span-2 bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
              <p className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: 'var(--txt3)' }}>
                <CalendarClock size={12} /> When your teacher{teachers.length > 1 ? 's are' : ' is'} free
              </p>
              {teachers.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button onClick={() => setAvailTeacherFilter('all')}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition"
                    style={availTeacherFilter === 'all'
                      ? { borderColor: 'var(--sage)', background: 'var(--sage-lt)', color: 'var(--sage-dk)' }
                      : { borderColor: 'var(--bd2)', color: 'var(--txt3)' }}>
                    All teachers
                  </button>
                  {teachers.map(t => (
                    <button key={t.id} onClick={() => setAvailTeacherFilter(t.id)}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition"
                      style={availTeacherFilter === t.id
                        ? { borderColor: 'var(--sage)', background: 'var(--sage-lt)', color: 'var(--sage-dk)' }
                        : { borderColor: 'var(--bd2)', color: 'var(--txt3)' }}>
                      {t.firstName} {t.lastName}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[11px] mb-3" style={{ color: 'var(--txt4)' }}>Shaded hours are when your teacher can take lessons. Use “Book a lesson” to grab a slot.</p>
            <AvailabilityWeekGrid windows={availTeacherFilter === 'all' ? teacherAvail : teacherAvail.filter(w => w.staffId === availTeacherFilter)} />
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

      <CancelLessonModal
        open={!!cancelModal} onClose={() => setCancelModal(null)}
        lessonId={cancelModal?.lessonId ?? null} hoursUntil={cancelModal?.hoursUntil ?? 0}
        onCancelled={mutateData}
      />
      <RescheduleLessonModal
        open={!!reschedModal} onClose={() => setReschedModal(null)}
        lessonId={reschedModal?.lessonId ?? null} onSent={() => {}}
      />
    </div>
  );
}
