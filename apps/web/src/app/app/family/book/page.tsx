'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { useApi } from '@/lib/swr';
import { fmtTime, fmtDate } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { SearchableSelect } from '@/components/searchable-select';
import { ChevronLeft, ChevronRight, Check, Loader2 } from 'lucide-react';

interface Teacher { id: string; firstName: string; lastName: string; instruments: string[]; defaultDuration: number; }
interface Enrollment { id: string; instrument: string; rate: number; teacherId: string | null; lessonType: string; status: string; defaultDuration: number; }
interface Student { id: string; firstName: string; lastName: string; status: string; enrollments: Enrollment[]; }
interface Slot { startsAt: string; endsAt: string; }
interface DashboardData { students: Student[]; }

function weekMonday(date: Date) {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function BookLessonPage() {
  const router = useRouter();
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [selectedEnrollment, setSelectedEnrollment] = useState('');
  const [isTrial, setIsTrial] = useState(false);
  const [weekStart, setWeekStart] = useState(() => weekMonday(new Date()));
  const [selectedSlot, setSelectedSlot] = useState('');
  const [booking, setBooking] = useState(false);
  const [done, setDone] = useState(false);

  // Cached reads — the teacher/student pickers populate instantly on revisit.
  const { data: teachers = [] } = useApi<Teacher[]>('/family/teachers');
  const { data: dashData } = useApi<DashboardData>('/family/dashboard');
  const students = (dashData?.students as unknown as Student[]) ?? [];

  const teacher = teachers.find(t => t.id === selectedTeacher);
  const student = students.find(s => s.id === selectedStudent);
  const enrollment = student?.enrollments?.find(e => e.id === selectedEnrollment);
  // Lesson length comes from the STUDENT's enrollment, not the teacher's
  // default: a 30-minute pupil was being booked into a 60-minute slot (and
  // charged accordingly) whenever their teacher's default happened to be 60.
  // Families can still pick a different length — some weeks want a longer
  // session — and the price follows, prorated exactly as the API charges it.
  const contracted = enrollment?.defaultDuration ?? teacher?.defaultDuration ?? 60;
  const [durationChoice, setDurationChoice] = useState<number | null>(null);
  const duration = durationChoice ?? contracted;

  // Reset to the contracted length whenever the instrument changes.
  useEffect(() => { setDurationChoice(null); }, [selectedEnrollment]);

  // A student signing in with their own login is shown a "Student" dropdown
  // containing exactly one option: themselves. Pick it for them. The same
  // applies to a one-child family — there is nothing to choose.
  const onlyStudentId = students.length === 1 ? students[0]!.id : null;
  useEffect(() => {
    if (onlyStudentId) setSelectedStudent(prev => prev || onlyStudentId);
  }, [onlyStudentId]);

  // The enrolment names the teacher; adopt it rather than asking. Only an
  // enrolment with no teacher assigned falls through to the picker.
  const enrollmentTeacherId = enrollment?.teacherId ?? null;
  useEffect(() => {
    if (enrollmentTeacherId) setSelectedTeacher(enrollmentTeacherId);
    else setSelectedTeacher('');
  }, [enrollmentTeacherId]);

  // Mirrors proratedAmount() on the API: a length other than the enrollment's
  // normal one is charged in proportion.
  const priceFor = (mins: number) =>
    enrollment ? Math.round((enrollment.rate * mins) / (enrollment.defaultDuration || mins)) : 0;

  // Availability is cached per teacher+week+duration; picking a teacher (or
  // paging weeks) re-keys and loads the slots. Null key = don't fetch yet.
  const ws = weekStart.toISOString().split('T')[0];
  const slotsKey = selectedTeacher
    ? `/family/availability?teacherId=${selectedTeacher}&weekStart=${ws}&duration=${duration}`
    : null;
  const { data: slots = [], isLoading: loadingSlots } = useApi<Slot[]>(slotsKey);

  // Clear any picked slot when the teacher/week/duration changes.
  useEffect(() => { setSelectedSlot(''); }, [selectedTeacher, weekStart, duration]);

  const slotsByDay = slots.reduce<Record<string, Slot[]>>((acc, s) => {
    const day = fmtDate(s.startsAt, { weekday: 'long', day: 'numeric', month: 'short' });
    (acc[day] = acc[day] ?? []).push(s);
    return acc;
  }, {});

  async function book() {
    if (!selectedSlot || !selectedTeacher || !selectedStudent || !selectedEnrollment) return;
    setBooking(true);
    try {
      await apiFetch('/family/lessons', {
        method: 'POST', token: tok(),
        body: JSON.stringify({
          teacherId: selectedTeacher,
          studentId: selectedStudent,
          enrollmentId: selectedEnrollment,
          startsAt: selectedSlot,
          duration,
          isTrialLesson: isTrial,
        }),
      });
      setDone(true);
    } catch (e) { alert('Booking failed — this slot may no longer be available.'); }
    finally { setBooking(false); }
  }

  if (done) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-full bg-[var(--sage-lt)] flex items-center justify-center mb-4">
        <Check size={32} className="text-[var(--sage-dk)]" />
      </div>
      <h2 className="text-xl font-black mb-2" style={{ color: 'var(--txt)' }}>Lesson booked!</h2>
      <p className="text-sm mb-6" style={{ color: 'var(--txt3)' }}>A confirmation email has been sent to you and the teacher.</p>
      <div className="flex gap-3">
        <button onClick={() => { setDone(false); setSelectedSlot(''); }}
          className="px-4 py-2 rounded-xl border border-[var(--bd2)] text-sm font-medium hover:bg-[var(--surf)]">
          Book another
        </button>
        <button onClick={() => router.push('/app/family/dashboard')}
          className="px-4 py-2 rounded-xl bg-[var(--sage)] text-white text-sm font-bold hover:bg-[var(--sage-dk)]">
          Go to dashboard
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Book a lesson
            <InfoTooltip text="You'll only ever see times the teacher is genuinely free — we hide slots that clash with another lesson or fall outside their working hours. Pick a slot and the studio confirms it shortly after." />
          </span>
        }
        subtitle="Choose the student and instrument, then pick a slot"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Step 1: Details ── */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--txt3)' }}>1. Lesson details</p>

            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>Student</label>
            {/* One option is not a choice — a student logging in was made to
                pick themselves out of a dropdown of one. */}
            {students.length === 1 ? (
              <p className="mb-3 rounded-xl border px-3 py-2 text-sm font-medium"
                style={{ borderColor: 'var(--bd2)', background: 'var(--surf)', color: 'var(--txt)' }}>
                {students[0]!.firstName} {students[0]!.lastName}
              </p>
            ) : (
              <div className="mb-3">
                <SearchableSelect
                  options={students.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
                  value={selectedStudent} onChange={v => { setSelectedStudent(v); setSelectedEnrollment(''); }}
                  placeholder="Select student…"
                />
              </div>
            )}

            {student && (() => {
              const bookable = (student.enrollments ?? []).filter(e => e.status === 'active' || e.status === 'trial');
              return (
                <>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>Instrument / Class</label>
                  {bookable.length === 0 ? (
                    <p className="text-xs mb-3 rounded-xl border border-[var(--bd2)] bg-[var(--surf)] px-3 py-2" style={{ color: 'var(--txt3)' }}>
                      This student isn&apos;t signed up for any instrument or class yet. Please contact the studio to get set up.
                    </p>
                  ) : (
                    <select value={selectedEnrollment} onChange={e => setSelectedEnrollment(e.target.value)}
                      className="w-full border border-[var(--bd2)] rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:border-[var(--sage)]">
                      <option value="">Select instrument / class…</option>
                      {bookable.map(e => (
                        <option key={e.id} value={e.id}>
                          {e.instrument.charAt(0).toUpperCase() + e.instrument.slice(1)}
                          {e.lessonType === 'group' ? ' (group class)' : ''} — {formatMoney(e.rate)} / {e.defaultDuration} min
                        </option>
                      ))}
                    </select>
                  )}

                  {enrollment && (
                    <>
                      {/* The teacher follows from the instrument — it is not a
                          free choice. Picking them separately let a family book
                          a piano lesson with the cello teacher; the API now
                          rejects that outright, so don't offer it. */}
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>Teacher</label>
                      {enrollment.teacherId ? (
                        <p className="mb-3 rounded-xl border px-3 py-2 text-sm font-medium"
                          style={{ borderColor: 'var(--bd2)', background: 'var(--surf)', color: 'var(--txt)' }}>
                          {teacher ? `${teacher.firstName} ${teacher.lastName}` : 'Your teacher'}
                          <span className="block text-xs font-normal" style={{ color: 'var(--txt3)' }}>
                            Set by this enrolment
                          </span>
                        </p>
                      ) : (
                        <div className="mb-3">
                          <SearchableSelect
                            options={teachers.map(t => ({ value: t.id, label: `${t.firstName} ${t.lastName} — ${t.instruments.join(', ')}` }))}
                            value={selectedTeacher} onChange={setSelectedTeacher} placeholder="Select teacher…"
                          />
                        </div>
                      )}

                      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>
                        Lesson length
                      </label>
                      <div className="flex gap-2 mb-3">
                        {[30, 45, 60].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setDurationChoice(m)}
                            className="flex-1 rounded-xl border px-2 py-2 text-xs font-semibold transition"
                            style={
                              duration === m
                                ? { borderColor: 'var(--sage)', background: 'var(--sage-lt)', color: 'var(--sage-dk)' }
                                : { borderColor: 'var(--bd2)', color: 'var(--txt3)' }
                            }
                          >
                            {m} min
                            <span className="block font-bold" style={{ color: 'var(--txt)' }}>
                              {formatMoney(priceFor(m))}
                            </span>
                            {m === contracted && (
                              <span className="block text-[10px] font-medium" style={{ color: 'var(--txt4)' }}>usual</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              );
            })()}

            <label className="flex items-center gap-2.5 text-sm cursor-pointer mt-1">
              <input type="checkbox" checked={isTrial} onChange={e => setIsTrial(e.target.checked)}
                className="rounded border-[var(--bd2)]" />
              <span style={{ color: 'var(--txt)' }}>This is a trial lesson</span>
            </label>
          </div>

          {selectedSlot && (
            <div className="bg-[var(--sage-lt)] rounded-2xl border border-[var(--sage-md)] p-4">
              <p className="text-xs font-bold uppercase tracking-widest mb-2 text-[var(--sage-dk)]">Selected slot</p>
              <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
                {fmtDate(selectedSlot, { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <p className="text-sm" style={{ color: 'var(--txt3)' }}>
                {fmtTime(selectedSlot)} · {duration} min
                {enrollment ? ` · ${formatMoney(priceFor(duration))}` : ''}
              </p>
              <button onClick={book} disabled={booking || !selectedEnrollment || !selectedStudent}
                className="mt-3 w-full bg-[var(--sage)] text-white font-bold text-sm py-2.5 rounded-xl hover:bg-[var(--sage-dk)] disabled:opacity-50 flex items-center justify-center gap-2">
                {booking ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                Confirm booking
              </button>
            </div>
          )}
        </div>

        {/* ── Step 2: Slots ── */}
        <div className="lg:col-span-2">
          {!selectedTeacher ? (
            <div className="bg-white rounded-2xl border border-[var(--bd)] p-12 text-center">
              <p className="text-sm" style={{ color: 'var(--txt3)' }}>Choose a student and instrument to see available slots.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
              {/* Week nav */}
              <div className="flex items-center justify-between mb-5">
                <button onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}
                  className="p-2 rounded-xl border border-[var(--bd2)] hover:bg-[var(--surf)]">
                  <ChevronLeft size={16} />
                </button>
                <p className="font-bold text-sm" style={{ color: 'var(--txt)' }}>
                  {weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} –{' '}
                  {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <button onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}
                  className="p-2 rounded-xl border border-[var(--bd2)] hover:bg-[var(--surf)]">
                  <ChevronRight size={16} />
                </button>
              </div>

              {loadingSlots ? (
                <div className="py-12 text-center text-[var(--txt3)] text-sm flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> Loading slots…
                </div>
              ) : Object.keys(slotsByDay).length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm" style={{ color: 'var(--txt3)' }}>No available slots this week.</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--txt4)' }}>Try the next week →</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {Object.entries(slotsByDay).map(([day, daySlots]) => (
                    <div key={day}>
                      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--txt3)' }}>{day}</p>
                      <div className="flex flex-wrap gap-2">
                        {daySlots.map(slot => {
                          const active = selectedSlot === slot.startsAt;
                          return (
                            <button key={slot.startsAt}
                              onClick={() => setSelectedSlot(slot.startsAt)}
                              className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition-all
                                ${active
                                  ? 'bg-[var(--sage)] text-white border-[var(--sage)]'
                                  : 'border-[var(--bd2)] hover:border-[var(--sage-md)] hover:bg-[var(--sage-lt)]'
                                }`}
                              style={{ color: active ? undefined : 'var(--txt)' }}>
                              {fmtTime(slot.startsAt)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
