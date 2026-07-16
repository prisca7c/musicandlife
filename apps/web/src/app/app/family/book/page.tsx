'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { fmtTime, fmtDate } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { ChevronLeft, ChevronRight, Check, Loader2 } from 'lucide-react';

interface Teacher { id: string; firstName: string; lastName: string; instruments: string[]; defaultDuration: number; }
interface Enrollment { id: string; instrument: string; rate: number; teacherId: string | null; lessonType: string; status: string; }
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
  const duration = teacher?.defaultDuration ?? 60;

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
        subtitle="Pick a teacher, then choose a slot"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Step 1: Details ── */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--txt3)' }}>1. Lesson details</p>

            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>Teacher</label>
            <select value={selectedTeacher} onChange={e => setSelectedTeacher(e.target.value)}
              className="w-full border border-[var(--bd2)] rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:border-[var(--sage)]">
              <option value="">Select teacher…</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.firstName} {t.lastName} — {t.instruments.join(', ')}</option>
              ))}
            </select>

            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>Student</label>
            <select value={selectedStudent} onChange={e => { setSelectedStudent(e.target.value); setSelectedEnrollment(''); }}
              className="w-full border border-[var(--bd2)] rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:border-[var(--sage)]">
              <option value="">Select student…</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
            </select>

            {student && (
              <>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>Enrollment</label>
                <select value={selectedEnrollment} onChange={e => setSelectedEnrollment(e.target.value)}
                  className="w-full border border-[var(--bd2)] rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:border-[var(--sage)]">
                  <option value="">Select enrollment…</option>
                  {(student as unknown as { enrollments?: Enrollment[] }).enrollments?.filter(e => e.status === 'active' || e.status === 'trial').map(e => (
                    <option key={e.id} value={e.id}>
                      {e.instrument} ({e.lessonType}) — £{(e.rate / 100).toFixed(2)}/lesson
                    </option>
                  ))}
                </select>
              </>
            )}

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
              <p className="text-sm" style={{ color: 'var(--txt3)' }}>Select a teacher to see available slots.</p>
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
