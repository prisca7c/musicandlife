'use client';

import { useState, useEffect, FormEvent, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  UserCircle, Users, ArrowLeft, ArrowRight,
  ClipboardCheck, Mail, Phone, MapPin, Search,
  CircleCheck, AlertCircle, Info, Send,
  Plus, MailCheck, Clock, CalendarPlus, Bell,
  UserPlus, Music,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { PRIVATE_INSTRUMENTS, GROUP_INSTRUMENTS } from '@music-life/types';
import { InstrumentIcon } from '@/components/instrument-icons';

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 1 | 2 | 3 | 4 | 'success';
interface InstrumentSelection { instrument: string; lessonType: 'private' | 'group'; }
interface FormData {
  studentFirstName: string; studentLastName: string; studentEmail: string; studentPhone: string;
  familyType: 'new' | 'existing';
  guardianFirstName: string; guardianLastName: string;
  contactEmail: string; contactPhone: string; address: string;
  instruments: InstrumentSelection[];
  emailReminders: boolean;
  notes: string;
}

const EMPTY: FormData = {
  studentFirstName: '', studentLastName: '', studentEmail: '', studentPhone: '',
  familyType: 'new',
  guardianFirstName: '', guardianLastName: '',
  contactEmail: '', contactPhone: '', address: '',
  instruments: [],
  emailReminders: true,
  notes: '',
};


// ─── Field component ──────────────────────────────────────────────────────────
function Field({ label, required, optional, helper, error, children }: {
  label: string; required?: boolean; optional?: boolean; helper?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--txt2)] mb-1.5 tracking-wide">
        {label}
        {required && <span className="text-[var(--coral)] text-sm leading-none">*</span>}
        {optional && <span className="text-[var(--txt4)] font-normal text-[11px] ml-0.5">(optional)</span>}
      </label>
      {children}
      {error && (
        <div className="flex items-center gap-1 mt-1 text-[11px] text-[var(--coral)]">
          <AlertCircle size={13} />{error}
        </div>
      )}
      {helper && !error && (
        <div className="flex items-start gap-1 mt-1.5 text-[11px] text-[var(--txt3)] leading-relaxed">
          <Info size={13} className="shrink-0 mt-px" />{helper}
        </div>
      )}
    </div>
  );
}

const inputCls = (err?: boolean) =>
  `w-full border-[1.5px] rounded-[10px] px-3.5 py-2.5 text-sm font-[family-name:var(--ff)] text-[var(--txt)] bg-white
   transition-all outline-none
   ${err
     ? 'border-[var(--coral)] shadow-[0_0_0_3px_var(--coral-lt)]'
     : 'border-[var(--bd2)] focus:border-[var(--sage)] focus:shadow-[0_0_0_3px_var(--sage-lt)]'}`;

function InputWithIcon({ icon, error, digitsOnly, onChange, ...props }: {
  icon: React.ReactNode; error?: boolean; digitsOnly?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--txt4)] pointer-events-none">{icon}</span>
      <input
        className={`${inputCls(error)} pl-9`}
        inputMode={digitsOnly ? 'numeric' : props.inputMode}
        onChange={digitsOnly
          ? (e) => {
              e.target.value = e.target.value.replace(/\D/g, '');
              onChange?.(e);
            }
          : onChange}
        {...props}
      />
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepBar({ current }: { current: number }) {
  const steps = ['Student', 'Family', 'Instruments', 'Review'];
  return (
    <div className="flex items-center w-full max-w-[500px] mb-7">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <div key={n} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1.5 z-10">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold transition-all border-2
                ${done ? 'bg-[var(--sage-lt)] border-[var(--sage-md)] text-[var(--sage)]' :
                  active ? 'bg-[var(--sage)] border-[var(--sage)] text-white' :
                  'bg-white border-[var(--bd2)] text-[var(--txt4)]'}`}>
                {done ? '✓' : n}
              </div>
              <span className={`text-[11px] font-semibold leading-tight text-center
                ${active ? 'text-[var(--sage)]' : done ? 'text-[var(--txt3)]' : 'text-[var(--txt4)]'}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 -mt-5 mx-0 ${done ? 'bg-[var(--sage-md)]' : 'bg-[var(--bd2)]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function RegisterPage() {
  const [step, setStep] = useState<Step>(1);
  const [data, setData] = useState<FormData>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [tcAccepted, setTcAccepted] = useState(false);

  // Existing family search
  const [familySearch, setFamilySearch] = useState('');
  const [familyResults, setFamilyResults] = useState<{ email: string; name: string }[]>([]);
  const [selectedFamily, setSelectedFamily] = useState<{ email: string; name: string } | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!familySearch.trim() || data.familyType !== 'existing') { setFamilyResults([]); return; }
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await apiFetch<{ email: string; name: string }[]>(`/public/families/search?q=${encodeURIComponent(familySearch)}`);
        setFamilyResults(res);
      } catch { setFamilyResults([]); }
    }, 300);
  }, [familySearch, data.familyType]);

  function set(updates: Partial<FormData>) {
    setData(d => ({ ...d, ...updates }));
    setErrors({});
  }

  function validate(s: number): boolean {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (!data.studentFirstName.trim()) e.studentFirstName = 'Please enter first name';
      if (!data.studentLastName.trim()) e.studentLastName = 'Please enter last name';
    }
    if (s === 2 && data.familyType === 'new') {
      if (!data.guardianFirstName.trim()) e.guardianFirstName = 'Please enter first name';
      if (!data.guardianLastName.trim()) e.guardianLastName = 'Please enter last name';
      if (!data.contactEmail.trim() || !data.contactEmail.includes('@')) e.contactEmail = 'Please enter a valid email';
      if (!data.contactPhone.trim()) e.contactPhone = 'Please enter a phone number';
      if (!data.address.trim()) e.address = 'Please enter your address';
    }
    if (s === 2 && data.familyType === 'existing' && !selectedFamily) {
      e.familySearch = 'Please find and select your existing family account';
    }
    if (s === 3 && data.instruments.length === 0) {
      e.instruments = 'Please select at least one instrument or lesson';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next(to: number) {
    if (!validate(step as number)) return;
    setStep(to as Step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleInstrument(instrument: string, lessonType: 'private' | 'group') {
    const key = `${instrument}|${lessonType}`;
    const exists = data.instruments.some(i => `${i.instrument}|${i.lessonType}` === key);
    set({ instruments: exists
      ? data.instruments.filter(i => `${i.instrument}|${i.lessonType}` !== key)
      : [...data.instruments, { instrument, lessonType }] });
  }

  function isOn(instrument: string, lessonType: 'private' | 'group') {
    return data.instruments.some(i => i.instrument === instrument && i.lessonType === lessonType);
  }

  async function submit() {
    setSubmitting(true); setSubmitError('');
    try {
      const payload = {
        studentFirstName: data.studentFirstName,
        studentLastName: data.studentLastName,
        studentEmail: data.studentEmail || undefined,
        familyName: data.familyType === 'existing' && selectedFamily
          ? selectedFamily.name
          : `${data.guardianFirstName} ${data.guardianLastName}`,
        contactName: data.familyType === 'existing' && selectedFamily
          ? selectedFamily.name
          : `${data.guardianFirstName} ${data.guardianLastName}`,
        contactEmail: data.familyType === 'existing' && selectedFamily
          ? selectedFamily.email
          : data.contactEmail,
        contactPhone: data.contactPhone || undefined,
        address: data.address || undefined,
        instruments: data.instruments,
        emailReminders: data.emailReminders,
        notes: data.notes || undefined,
        idempotencyKey: `reg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
      await apiFetch('/public/registrations', { method: 'POST', body: JSON.stringify(payload) });
      setStep('success');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Section head ──────────────────────────────────────────────────────────
  const SectionHead = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-2 mb-3 mt-1">
      <span className="text-[11px] font-bold text-[var(--txt4)] uppercase tracking-[0.1em]">{children}</span>
      <div className="flex-1 h-px bg-[var(--bd)]" />
    </div>
  );

  // ── Chip ──────────────────────────────────────────────────────────────────
  const Chip = ({ instrument, lessonType, groupStyle }: { instrument: string; lessonType: 'private' | 'group'; groupStyle?: boolean }) => {
    const on = isOn(instrument, lessonType);
    return (
      <button type="button" onClick={() => toggleInstrument(instrument, lessonType)}
        className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-[10px] border-[1.5px] cursor-pointer transition-all text-[11px] font-medium text-center leading-tight select-none
          ${on
            ? groupStyle
              ? 'border-[var(--plum)] bg-[var(--plum-lt)] text-[var(--plum)] font-bold shadow-[0_2px_8px_rgba(91,63,158,.15)]'
              : 'border-[var(--sage)] bg-[var(--sage-lt)] text-[var(--sage)] font-bold shadow-[0_2px_8px_rgba(61,122,85,.15)]'
            : groupStyle
              ? 'border-[var(--bd2)] text-[var(--txt3)] hover:border-[var(--plum-md)] hover:bg-[var(--plum-lt)] hover:text-[var(--plum)] hover:-translate-y-px'
              : 'border-[var(--bd2)] text-[var(--txt3)] hover:border-[var(--sage-md)] hover:bg-[var(--sage-lt)] hover:text-[var(--sage)] hover:-translate-y-px'
          }`}>
        <InstrumentIcon name={instrument} size={22} />
        <span className="capitalize">{instrument}</span>
      </button>
    );
  };

  // ── Review row ────────────────────────────────────────────────────────────
  const ReviewRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-start gap-2 py-1.5 border-b border-[var(--bd)] last:border-0">
      <span className="text-xs text-[var(--txt3)] w-28 shrink-0 pt-px">{label}</span>
      <span className="text-[13px] font-medium flex-1 leading-relaxed">{value}</span>
    </div>
  );

  const contactName = `${data.guardianFirstName} ${data.guardianLastName}`.trim();

  // ─── Success ──────────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-start pt-10 pb-12 px-4"
        style={{ background: 'linear-gradient(160deg,#EBF5EE 0%,#EBF4FF 45%,#EDE9FE 100%)' }}>
        <div className="w-full max-w-[560px] bg-white rounded-[20px] shadow-[0_4px_32px_rgba(0,0,0,.09)]">
          <div className="flex flex-col items-center gap-4 text-center px-8 py-12">
            <div className="w-[72px] h-[72px] rounded-full bg-[var(--sage-lt)] border-2 border-[var(--sage-md)] flex items-center justify-center mb-1">
              <CircleCheck size={38} color="var(--sage)" />
            </div>
            <h2 className="text-[22px] font-bold text-[var(--sage-dk)] tracking-tight">Registration submitted!</h2>
            <p className="text-sm text-[var(--txt3)] max-w-[360px] leading-relaxed">
              Thank you, {data.guardianFirstName || contactName}! We&apos;ve received {data.studentFirstName}&apos;s registration and will review it within 2–3 business days.
            </p>
            <div className="bg-[var(--sage-lt)] border border-[var(--sage-md)] rounded-xl p-4 w-full max-w-sm text-left mt-1">
              {([
                { icon: <MailCheck size={16} />, text: "You'll receive a confirmation email at the address you provided." },
                { icon: <Clock size={16} />, text: "Our team will review and approve your registration within 2–3 business days." },
                { icon: <CalendarPlus size={16} />, text: "Once approved, you'll get a welcome email with portal login details." },
              ] as { icon: React.ReactNode; text: string }[]).map((item, i) => (
                <div key={i} className="flex gap-2.5 py-1.5 text-[13px] text-[var(--sage-dk)]">
                  <span className="mt-px shrink-0">{item.icon}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
            <button onClick={() => { setStep(1); setData(EMPTY); setTcAccepted(false); }}
              className="mt-2 flex items-center gap-2 bg-[var(--sage)] text-white rounded-[10px] px-6 py-2.5 text-sm font-bold hover:bg-[var(--sage-dk)] transition-colors">
              <Plus size={16} /> Register another student
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-8 pb-12 px-4"
      style={{ background: 'linear-gradient(160deg,#EBF5EE 0%,#EBF4FF 45%,#EDE9FE 100%)' }}>

      {/* Header */}
      <div className="flex flex-col items-center gap-3 mb-7 text-center">
        <Image src="/logo-full-transparent.png" alt="Music & Life London"
          width={300} height={130}
          className="w-[240px] h-auto object-contain" priority />
        <p className="text-sm text-[var(--txt3)] max-w-[360px] leading-relaxed">
          Register your student below. Takes about 2 minutes — we&apos;ll review your application and reach out within 2–3 business days.
        </p>
      </div>

      {/* Step bar */}
      <StepBar current={step as number} />

      {/* Card */}
      <div className="w-full max-w-[560px] bg-white rounded-[20px] shadow-[0_4px_32px_rgba(0,0,0,.09)] overflow-hidden">

        {/* ── Step 1: Student ── */}
        {step === 1 && (
          <>
            <div className="px-7 py-6 border-b border-[var(--bd)] bg-gradient-to-br from-[var(--sage-lt)] to-transparent">
              <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
                <UserCircle size={20} color="var(--sage)" /> Student Information
              </div>
              <p className="text-[13px] text-[var(--txt3)] mt-1.5 leading-snug">Tell us about the student who will be taking lessons.</p>
            </div>
            <div className="px-7 py-6">
              <SectionHead>Full name</SectionHead>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Field label="First name" required error={errors.studentFirstName}>
                  <input className={inputCls(!!errors.studentFirstName)} placeholder="e.g. Emma" autoFocus
                    value={data.studentFirstName} onChange={e => set({ studentFirstName: e.target.value })} />
                </Field>
                <Field label="Last name" required error={errors.studentLastName}>
                  <input className={inputCls(!!errors.studentLastName)} placeholder="e.g. Smith"
                    value={data.studentLastName} onChange={e => set({ studentLastName: e.target.value })} />
                </Field>
              </div>
              <div className="h-px bg-[var(--bd)] my-5" />
              <SectionHead>Student contact <span className="normal-case tracking-normal text-[11px] font-normal">(optional — for students 16+)</span></SectionHead>
              <Field label="Email" optional>
                <InputWithIcon icon={<Mail size={16} />}
                  type="email" placeholder="student@email.com" autoComplete="email"
                  value={data.studentEmail} onChange={e => set({ studentEmail: e.target.value })} />
              </Field>
              <Field label="Phone" optional>
                <InputWithIcon icon={<Phone size={16} />}
                  type="tel" placeholder="07700900000" autoComplete="tel" digitsOnly
                  value={data.studentPhone} onChange={e => set({ studentPhone: e.target.value })} />
              </Field>
            </div>
            <div className="px-7 py-4 border-t border-[var(--bd)] flex items-center justify-between">
              <span className="text-xs text-[var(--txt4)] font-medium">Step 1 of 4</span>
              <button onClick={() => next(2)} className="flex items-center gap-1.5 bg-[var(--sage)] text-white rounded-[10px] px-6 py-2.5 text-sm font-bold hover:bg-[var(--sage-dk)] transition-colors ml-auto">
                Next — Family info <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Family ── */}
        {step === 2 && (
          <>
            <div className="px-7 py-6 border-b border-[var(--bd)] bg-gradient-to-br from-[var(--sage-lt)] to-transparent">
              <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
                <Users size={20} color="var(--sage)" /> Family / Guardian
              </div>
              <p className="text-[13px] text-[var(--txt3)] mt-1.5">Primary contact for scheduling, billing, and communication.</p>
            </div>
            <div className="px-7 py-6">
              {/* New vs existing */}
              <div className="mb-5">
                <p className="text-xs font-semibold text-[var(--txt2)] mb-2">Is this student part of an existing family in our system?</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: 'new', icon: <UserPlus size={22} color="var(--sage)" />, label: 'New Family', sub: 'First student from this family', activeClass: 'border-[var(--sage)] bg-[var(--sage-lt)] shadow-[0_0_0_3px_rgba(61,122,85,.1)]' },
                    { key: 'existing', icon: <Users size={22} color="var(--sky)" />, label: 'Existing Family', sub: 'Adding to an existing account', activeClass: 'border-[var(--sky)] bg-[var(--sky-lt)] shadow-[0_0_0_3px_rgba(43,108,176,.1)]' },
                  ].map(opt => (
                    <button key={opt.key} type="button" onClick={() => { set({ familyType: opt.key as 'new'|'existing' }); setSelectedFamily(null); setFamilySearch(''); }}
                      className={`border-[1.5px] rounded-xl p-4 text-center cursor-pointer transition-all bg-white
                        ${data.familyType === opt.key ? opt.activeClass : 'border-[var(--bd2)] hover:border-[var(--sage-md)] hover:bg-[var(--sage-lt)]'}`}>
                      <div className="flex justify-center mb-1.5">{opt.icon}</div>
                      <p className="text-[13px] font-bold">{opt.label}</p>
                      <p className="text-[11px] text-[var(--txt3)] mt-0.5">{opt.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Existing family search */}
              {data.familyType === 'existing' && (
                <div className="mb-5">
                  <Field label="Search by email address" error={errors.familySearch}>
                    <InputWithIcon icon={<Search size={16} />}
                      type="email" placeholder="guardian@email.com"
                      value={familySearch} onChange={e => setFamilySearch(e.target.value)} />
                  </Field>
                  {familyResults.length > 0 && !selectedFamily && (
                    <div className="border-[1.5px] border-[var(--bd2)] rounded-xl overflow-hidden mt-1">
                      {familyResults.map(f => (
                        <button key={f.email} type="button" onClick={() => { setSelectedFamily(f); setFamilyResults([]); }}
                          className="w-full text-left px-4 py-3 text-sm hover:bg-[var(--sage-lt)] border-b border-[var(--bd)] last:border-0 transition-colors">
                          <p className="font-semibold">{f.name}</p>
                          <p className="text-xs text-[var(--txt3)] mt-0.5">{f.email}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedFamily && (
                    <div className="flex items-center gap-2 bg-[var(--sage-lt)] border border-[var(--sage-md)] rounded-xl px-4 py-2.5 mt-1 text-[13px] text-[var(--sage-dk)]">
                      <CircleCheck size={16} />
                      <span className="flex-1">{selectedFamily.name} · {selectedFamily.email}</span>
                      <button onClick={() => { setSelectedFamily(null); setFamilySearch(''); }} className="text-[11px] font-semibold text-[var(--sage)] hover:underline">Change</button>
                    </div>
                  )}
                </div>
              )}

              {/* New family fields */}
              {data.familyType === 'new' && (
                <>
                  <SectionHead>Guardian name</SectionHead>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <Field label="First name" required error={errors.guardianFirstName}>
                      <input className={inputCls(!!errors.guardianFirstName)} placeholder="e.g. Jane"
                        value={data.guardianFirstName} onChange={e => set({ guardianFirstName: e.target.value })} />
                    </Field>
                    <Field label="Last name" required error={errors.guardianLastName}>
                      <input className={inputCls(!!errors.guardianLastName)} placeholder="e.g. Smith"
                        value={data.guardianLastName} onChange={e => set({ guardianLastName: e.target.value })} />
                    </Field>
                  </div>
                  <div className="h-px bg-[var(--bd)] my-5" />
                  <SectionHead>Contact details</SectionHead>
                  <Field label="Email" required error={errors.contactEmail}
                    helper="Used for invoices, lesson reminders, and important notices.">
                    <InputWithIcon icon={<Mail size={16} />} type="email" placeholder="jane.smith@email.com"
                      error={!!errors.contactEmail} autoComplete="email"
                      value={data.contactEmail} onChange={e => set({ contactEmail: e.target.value })} />
                  </Field>
                  <Field label="Phone" required error={errors.contactPhone}>
                    <InputWithIcon icon={<Phone size={16} />} type="tel" placeholder="07700900000"
                      error={!!errors.contactPhone} autoComplete="tel" digitsOnly
                      value={data.contactPhone} onChange={e => set({ contactPhone: e.target.value })} />
                  </Field>
                  <Field label="Home address" required error={errors.address}>
                    <InputWithIcon icon={<MapPin size={16} />} type="text" placeholder="123 High Street, Pinner, HA5 5PJ"
                      error={!!errors.address} autoComplete="street-address"
                      value={data.address} onChange={e => set({ address: e.target.value })} />
                  </Field>
                </>
              )}
            </div>
            <div className="px-7 py-4 border-t border-[var(--bd)] flex items-center justify-between">
              <button onClick={() => setStep(1)} className="flex items-center gap-1.5 border-[1.5px] border-[var(--bd2)] rounded-[10px] px-5 py-2.5 text-sm font-semibold text-[var(--txt2)] hover:bg-[var(--surf)] transition-colors">
                <ArrowLeft size={16} /> Back
              </button>
              <span className="text-xs text-[var(--txt4)] font-medium">Step 2 of 4</span>
              <button onClick={() => next(3)} className="flex items-center gap-1.5 bg-[var(--sage)] text-white rounded-[10px] px-6 py-2.5 text-sm font-bold hover:bg-[var(--sage-dk)] transition-colors">
                Next — Instruments <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Instruments ── */}
        {step === 3 && (
          <>
            <div className="px-7 py-6 border-b border-[var(--bd)] bg-gradient-to-br from-[var(--sage-lt)] to-transparent">
              <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
                <Music size={20} color="var(--sage)" /> Instruments &amp; Lessons
              </div>
              <p className="text-[13px] text-[var(--txt3)] mt-1.5">
                Select all the lessons you&apos;re interested in. You can always change these later. Not sure which instrument to pick?{' '}
                <a href="https://www.musicandlife.co.uk/music-lessons" target="_blank" rel="noopener noreferrer"
                  className="font-semibold hover:underline" style={{ color: 'var(--sage)' }}>
                  Learn more about our lessons
                </a>.
              </p>
            </div>
            <div className="px-7 py-6">
              {/* Private */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <SectionHead>One-on-one lessons</SectionHead>
                  <span className="text-[10px] bg-[var(--sage-lt)] text-[var(--sage)] px-2 py-0.5 rounded-full font-semibold -mt-3">Private</span>
                </div>
                <p className="text-[11px] text-[var(--txt3)] mb-3">Individual lessons tailored to your student&apos;s pace and goals.</p>
                <div className="grid grid-cols-4 gap-2">
                  {PRIVATE_INSTRUMENTS.map(inst => <Chip key={inst} instrument={inst} lessonType="private" />)}
                </div>
                {data.instruments.filter(i=>i.lessonType==='private').length > 0 && (
                  <p className="text-[11px] text-[var(--sage)] font-bold mt-2">
                    {data.instruments.filter(i=>i.lessonType==='private').length} selected: {data.instruments.filter(i=>i.lessonType==='private').map(i=>i.instrument).join(', ')}
                  </p>
                )}
              </div>

              {/* Group */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <SectionHead>Group lessons</SectionHead>
                  <span className="text-[10px] bg-[var(--plum-lt)] text-[var(--plum)] px-2 py-0.5 rounded-full font-semibold -mt-3">Group</span>
                </div>
                <p className="text-[11px] text-[var(--txt3)] mb-3">Learn alongside other students in a fun, collaborative setting.</p>
                <div className="grid grid-cols-2 gap-2">
                  {GROUP_INSTRUMENTS.map(inst => <Chip key={inst} instrument={inst} lessonType="group" groupStyle />)}
                </div>
                {data.instruments.filter(i=>i.lessonType==='group').length > 0 && (
                  <p className="text-[11px] text-[var(--plum)] font-bold mt-2">
                    {data.instruments.filter(i=>i.lessonType==='group').length} selected: {data.instruments.filter(i=>i.lessonType==='group').map(i=>i.instrument).join(', ')}
                  </p>
                )}
              </div>

              {errors.instruments && (
                <div className="flex items-center gap-1 mb-4 text-[11px] text-[var(--coral)]">
                  <AlertCircle size={13} />{errors.instruments}
                </div>
              )}

              <div className="h-px bg-[var(--bd)] my-4" />
              <Field label="Additional notes" optional>
                <textarea className={`${inputCls()} resize-y min-h-[80px] leading-relaxed`} rows={3}
                  placeholder="Tell us about your goals, scheduling preferences, experience level, or anything else we should know…"
                  value={data.notes} onChange={e => set({ notes: e.target.value })} />
              </Field>

              <div className="h-px bg-[var(--bd)] my-4" />
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--txt2)] mb-3">
                <Bell size={14} color="var(--sage)" /> Lesson Reminder Preferences
              </p>
              <div className="space-y-2">
                {[
                  { id: 'email', key: 'emailReminders' as const, icon: <Mail size={16} />, title: 'Email lesson reminders', desc: 'Sent 24 hours before each lesson.', defaultOn: true },
                ].map(pref => (
                  <label key={pref.id} onClick={() => set({ [pref.key]: !data[pref.key] } as Partial<FormData>)}
                    className={`flex items-start gap-3 p-3 border-[1.5px] rounded-[10px] cursor-pointer transition-all
                      ${data[pref.key] ? 'border-[var(--sage)]' : 'border-[var(--bd2)]'}`}>
                    <input type="checkbox" checked={data[pref.key]} readOnly
                      className="w-4 h-4 mt-px shrink-0 accent-[var(--sage)]" style={{ accentColor: 'var(--sage)' }} />
                    <div>
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                        <span className="text-[var(--sage)]">{pref.icon}</span>{pref.title}
                      </div>
                      <p className="text-[11px] text-[var(--txt3)] mt-0.5">{pref.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="px-7 py-4 border-t border-[var(--bd)] flex items-center justify-between">
              <button onClick={() => setStep(2)} className="flex items-center gap-1.5 border-[1.5px] border-[var(--bd2)] rounded-[10px] px-5 py-2.5 text-sm font-semibold text-[var(--txt2)] hover:bg-[var(--surf)] transition-colors">
                <ArrowLeft size={16} /> Back
              </button>
              <span className="text-xs text-[var(--txt4)] font-medium">Step 3 of 4</span>
              <button onClick={() => next(4)} className="flex items-center gap-1.5 bg-[var(--sage)] text-white rounded-[10px] px-6 py-2.5 text-sm font-bold hover:bg-[var(--sage-dk)] transition-colors">
                Review &amp; Submit <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}

        {/* ── Step 4: Review ── */}
        {step === 4 && (
          <>
            <div className="px-7 py-6 border-b border-[var(--bd)] bg-gradient-to-br from-[var(--sage-lt)] to-transparent">
              <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
                <ClipboardCheck size={20} color="var(--sage)" /> Review Your Registration
              </div>
              <p className="text-[13px] text-[var(--txt3)] mt-1.5">Please double-check everything before submitting. Click any &quot;Edit&quot; link to make changes.</p>
            </div>
            <div className="px-7 py-6 space-y-5">
              {submitError && (
                <div className="flex items-center gap-2 bg-[var(--coral-lt)] border border-[var(--coral)] rounded-xl px-4 py-3 text-sm text-[var(--coral)]">
                  <AlertCircle size={16} />{submitError}
                </div>
              )}

              {/* Student */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold text-[var(--txt4)] uppercase tracking-[0.09em]">
                    <UserCircle size={12} className="inline mr-1 mb-px" />Student
                  </p>
                  <button onClick={() => setStep(1)} className="text-[11px] font-semibold text-[var(--sky)] hover:underline">Edit</button>
                </div>
                <ReviewRow label="Name" value={`${data.studentFirstName} ${data.studentLastName}`} />
                <ReviewRow label="Email" value={data.studentEmail || <em className="text-[var(--txt4)]">Not provided</em>} />
                <ReviewRow label="Phone" value={data.studentPhone || <em className="text-[var(--txt4)]">Not provided</em>} />
              </div>

              <div className="h-px bg-[var(--bd)]" />

              {/* Family */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold text-[var(--txt4)] uppercase tracking-[0.09em]">
                    <Users size={12} className="inline mr-1 mb-px" />Family / Guardian
                  </p>
                  <button onClick={() => setStep(2)} className="text-[11px] font-semibold text-[var(--sky)] hover:underline">Edit</button>
                </div>
                {data.familyType === 'existing' && selectedFamily ? (
                  <>
                    <ReviewRow label="Type" value="Existing family" />
                    <ReviewRow label="Account" value={`${selectedFamily.name} · ${selectedFamily.email}`} />
                  </>
                ) : (
                  <>
                    <ReviewRow label="Name" value={contactName || '—'} />
                    <ReviewRow label="Email" value={data.contactEmail || '—'} />
                    <ReviewRow label="Phone" value={data.contactPhone || '—'} />
                    <ReviewRow label="Address" value={data.address || '—'} />
                  </>
                )}
              </div>

              <div className="h-px bg-[var(--bd)]" />

              {/* Instruments */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold text-[var(--txt4)] uppercase tracking-[0.09em]">
                    <Music size={12} className="inline mr-1 mb-px" />Instruments
                  </p>
                  <button onClick={() => setStep(3)} className="text-[11px] font-semibold text-[var(--sky)] hover:underline">Edit</button>
                </div>
                <ReviewRow label="One-on-one" value={
                  data.instruments.filter(i=>i.lessonType==='private').length > 0
                    ? <div className="flex flex-wrap gap-1">{data.instruments.filter(i=>i.lessonType==='private').map(i=><span key={i.instrument} className="text-[11px] bg-[var(--sage-lt)] text-[var(--sage)] border border-[var(--sage-md)] px-2.5 py-0.5 rounded-full font-semibold capitalize">{i.instrument}</span>)}</div>
                    : <em className="text-[var(--txt4)]">None</em>
                } />
                <ReviewRow label="Group" value={
                  data.instruments.filter(i=>i.lessonType==='group').length > 0
                    ? <div className="flex flex-wrap gap-1">{data.instruments.filter(i=>i.lessonType==='group').map(i=><span key={i.instrument} className="text-[11px] bg-[var(--plum-lt)] text-[var(--plum)] border border-[var(--plum-md)] px-2.5 py-0.5 rounded-full font-semibold capitalize">{i.instrument}</span>)}</div>
                    : <em className="text-[var(--txt4)]">None</em>
                } />
                {data.notes && <ReviewRow label="Notes" value={data.notes} />}
                <ReviewRow label="Reminders" value={data.emailReminders ? 'Email' : 'None'} />
              </div>

              <div className="h-px bg-[var(--bd)]" />

              {/* T&Cs */}
              <label className="flex items-start gap-3 cursor-pointer" onClick={() => setTcAccepted(v => !v)}>
                <input type="checkbox" checked={tcAccepted} readOnly className="mt-px h-4 w-4 rounded shrink-0" style={{ accentColor: 'var(--sage)' }} />
                <span className="text-sm text-[var(--txt2)] leading-relaxed">
                  I have read and agree to the{' '}
                  <Link href="/terms" target="_blank" className="text-[var(--sky)] font-semibold hover:underline">Terms &amp; Conditions</Link>,
                  including the fees, cancellation policy, and make-up lesson policy.
                </span>
              </label>
            </div>

            <div className="px-7 py-4 border-t-2 border-[var(--sage-md)] bg-[var(--sage-lt)] flex items-center justify-between">
              <button onClick={() => setStep(3)} className="flex items-center gap-1.5 border-[1.5px] border-[var(--bd2)] bg-white rounded-[10px] px-5 py-2.5 text-sm font-semibold text-[var(--txt2)] hover:bg-[var(--surf)] transition-colors">
                <ArrowLeft size={16} /> Back
              </button>
              <button onClick={submit} disabled={submitting || !tcAccepted}
                className="flex items-center gap-2 bg-[var(--sage)] text-white rounded-[10px] px-7 py-2.5 text-[15px] font-bold hover:bg-[var(--sage-dk)] transition-all hover:shadow-[0_4px_16px_rgba(61,122,85,.3)] disabled:opacity-50 disabled:cursor-not-allowed tracking-tight">
                <Send size={16} />{submitting ? 'Submitting…' : 'Submit registration'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <p className="text-xs text-[var(--txt4)] mt-6 text-center">
        Already have an account?{' '}
        <Link href="/login" className="text-[var(--sage)] font-semibold hover:underline">Sign in →</Link>
        &nbsp;·&nbsp; Questions?{' '}
        <a href="mailto:office@musicandlife.co.uk" className="text-[var(--sage)] font-semibold hover:underline">office@musicandlife.co.uk</a>
      </p>
    </div>
  );
}
