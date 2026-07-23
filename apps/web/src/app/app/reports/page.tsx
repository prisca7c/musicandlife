'use client';

import { useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { apiFetch, apiFetchBlob } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { LoadState } from '@/components/load-state';
import { PageHeader } from '@/components/page-header';
import { InvoicePDF, type OrgPDFData } from '@/components/invoice-pdf';
import { PayrollPDF, type PayrollPDFData } from '@/components/payroll-pdf';
import { AttendancePDF, type AttendancePDFData } from '@/components/attendance-pdf';
import { Download, FileDown, Loader2 } from 'lucide-react';
import { SearchableSelect } from '@/components/searchable-select';

interface AttendanceReport { from: string; to: string; byStatus: { status: string; count: number }[]; }
interface RevenueReport { from: string; to: string; accountingMode: 'cash' | 'accrual'; total: number; byType: { type: string; total: string | null }[]; earnedFromLessons: number; completedLessons: number; }
interface EnrollmentReport { byInstrument: { instrument: string; lessonType: string; count: number }[]; }
interface RetentionReport { byMonth: { month: string; active: number; withdrawn: number }[]; }
interface StudentOption { id: string; firstName: string; lastName: string; }
interface StaffOption { id: string; firstName: string; lastName: string; }

function today() { return new Date().toISOString().split('T')[0]!; }
function monthStart() { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]!; }

async function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled', completed: 'Completed',
  cancelled_makeup: 'Lesson earned', cancelled_no_makeup: 'Late cancel',
  cancelled_no_pay: 'No charge', cancelled_teacher: 'Teacher cancelled', makeup: 'Makeup lesson',
};

export default function ReportsPage() {
  // Dropdown / PDF options — cached, so they populate instantly on revisit.
  const { data: students = [] } = useApi<StudentOption[]>('/students');
  const { data: staff = [] } = useApi<StaffOption[]>('/staff');
  const { data: org = null } = useApi<OrgPDFData>('/organizations/me');

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [pdfStudent, setPdfStudent] = useState('');
  const [pdfStaff, setPdfStaff] = useState('');
  const [generating, setGenerating] = useState<string | null>(null);

  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Report data — attendance/revenue re-key on the date range; all cached so
  // flipping back to a range you've already viewed is instant.
  const { data: attendance = null, error: attendanceErr, isLoading: attendanceLoading, mutate: reloadAttendance } = useApi<AttendanceReport>(`/reports/attendance?from=${from}&to=${to}`);
  const { data: revenue = null, error: revenueErr, isLoading: revenueLoading, mutate: reloadRevenue } = useApi<RevenueReport>(`/reports/revenue?from=${from}&to=${to}`);
  const { data: enrollments = null, error: enrollmentsErr, isLoading: enrollmentsLoading, mutate: reloadEnrollments } = useApi<EnrollmentReport>('/reports/enrollments');
  const { data: retention = null, error: retentionErr, isLoading: retentionLoading, mutate: reloadRetention } = useApi<RetentionReport>('/reports/retention');

  async function downloadCsv(path: string, filename: string) {
    setGenerating(filename);
    try {
      const blob = await apiFetchBlob(path, { token: tok() });
      await downloadBlob(blob, filename);
    } catch (e) { console.error(e); alert('Could not download CSV.'); }
    finally { setGenerating(null); }
  }

  async function downloadStudentInvoice() {
    if (!pdfStudent) return;
    setGenerating('invoice');
    try {
      const data = await apiFetch<Parameters<typeof InvoicePDF>[0]['invoice'] & { student: { name: string } }>(
        `/reports/student-invoice-pdf?studentId=${pdfStudent}&from=${from}&to=${to}`, { token: tok() }
      );
      // Build an InvoicePDF-compatible shape from the report data
      const invoiceData = {
        number: `${(data as unknown as { student: { name: string } }).student?.name ?? 'Student'} · ${from} – ${to}`,
        status: 'draft',
        total: (data as unknown as { total: number }).total ?? 0,
        issuedOn: today(),
        dueDate: today(),
        notes: null,
        family: (data as unknown as { student: { family: { name: string; email: string | null } | null } }).student?.family ?? null,
        lineItems: (data as unknown as { lineItems: { id: string; description: string; amount: number; date: string }[] }).lineItems ?? [],
      };
      const blob = await pdf(<InvoicePDF invoice={invoiceData} org={org} logoSrc="" />).toBlob();
      const studentName = students.find(s => s.id === pdfStudent);
      await downloadBlob(blob, `invoice-${studentName?.firstName ?? 'student'}-${from}.pdf`);
    } catch (e) { console.error(e); alert('Could not generate invoice PDF.'); }
    finally { setGenerating(null); }
  }

  async function downloadPayroll() {
    if (!pdfStaff) return;
    setGenerating('payroll');
    try {
      const data = await apiFetch<PayrollPDFData>(
        `/reports/teacher-payroll-pdf?staffId=${pdfStaff}&from=${from}&to=${to}`, { token: tok() }
      );
      const blob = await pdf(<PayrollPDF data={data} />).toBlob();
      await downloadBlob(blob, `payroll-${data.staff.name.replace(/ /g, '-')}-${from}.pdf`);
    } catch (e) { console.error(e); alert('Could not generate payroll PDF.'); }
    finally { setGenerating(null); }
  }

  async function downloadAttendance() {
    if (!pdfStudent) return;
    setGenerating('attendance');
    try {
      const data = await apiFetch<AttendancePDFData>(
        `/reports/student-attendance-pdf?studentId=${pdfStudent}&from=${from}&to=${to}`, { token: tok() }
      );
      const blob = await pdf(<AttendancePDF data={data} />).toBlob();
      await downloadBlob(blob, `attendance-${data.student.name.replace(/ /g, '-')}-${from}.pdf`);
    } catch (e) { console.error(e); alert('Could not generate attendance PDF.'); }
    finally { setGenerating(null); }
  }

  return (
    <div>
      <PageHeader title="Reports" />

      {/* Date range */}
      <div className="flex gap-3 items-center mb-6 flex-wrap">
        <label className="text-sm font-medium" style={{ color: 'var(--txt3)' }}>From</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="border border-[var(--bd2)] rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--sage)]" />
        <label className="text-sm font-medium" style={{ color: 'var(--txt3)' }}>to</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="border border-[var(--bd2)] rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--sage)]" />
      </div>

      {/* ── PDF exports ── */}
      <div className="bg-white rounded-2xl border mb-6 overflow-hidden" style={{ borderColor: 'var(--bd)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
          <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Export PDFs</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--txt4)' }}>Date range above applies to all exports</p>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">

          {/* Student invoice */}
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>Student invoice</p>
            <SearchableSelect
              options={students.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
              value={pdfStudent} onChange={setPdfStudent} placeholder="Select student…"
            />
            <button onClick={downloadStudentInvoice} disabled={!pdfStudent || generating === 'invoice'}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-[var(--bd2)] text-sm font-semibold hover:bg-[var(--surf)] disabled:opacity-50 transition-colors">
              {generating === 'invoice' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Download invoice
            </button>
          </div>

          {/* Teacher payroll */}
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>Teacher payroll</p>
            <SearchableSelect
              options={staff.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
              value={pdfStaff} onChange={setPdfStaff} placeholder="Select teacher…"
            />
            <button onClick={downloadPayroll} disabled={!pdfStaff || generating === 'payroll'}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-[var(--bd2)] text-sm font-semibold hover:bg-[var(--surf)] disabled:opacity-50 transition-colors">
              {generating === 'payroll' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Download payroll
            </button>
          </div>

          {/* Attendance history */}
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>Attendance history</p>
            <SearchableSelect
              options={students.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
              value={pdfStudent} onChange={setPdfStudent} placeholder="Select student…"
            />
            <button onClick={downloadAttendance} disabled={!pdfStudent || generating === 'attendance'}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-[var(--bd2)] text-sm font-semibold hover:bg-[var(--surf)] disabled:opacity-50 transition-colors">
              {generating === 'attendance' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Download attendance
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lesson attendance */}
        <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--bd)' }}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
            <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Lessons by status</h2>
            <button onClick={() => downloadCsv(`/reports/attendance?from=${from}&to=${to}&format=csv`, 'attendance.csv')}
              disabled={generating === 'attendance.csv'}
              className="flex items-center gap-1.5 text-xs font-semibold hover:underline disabled:opacity-50" style={{ color: 'var(--sage)' }}>
              <FileDown size={12} /> CSV
            </button>
          </div>
          <div className="p-5">
            {!attendance ? <LoadState error={attendanceErr} loading={attendanceLoading} onRetry={() => reloadAttendance()} /> : (
              <div className="space-y-3">
                {attendance.byStatus.length === 0 && <p className="text-sm" style={{ color: 'var(--txt4)' }}>No lessons in this period.</p>}
                {attendance.byStatus.map(row => (
                  <div key={row.status} className="flex items-center justify-between">
                    <span className="text-xs capitalize px-2 py-0.5 rounded-full bg-[var(--surf)]" style={{ color: 'var(--txt3)' }}>
                      {STATUS_LABELS[row.status] ?? row.status.replace(/_/g, ' ')}
                    </span>
                    <span className="font-bold" style={{ color: 'var(--txt)' }}>{row.count}</span>
                  </div>
                ))}
                <div className="border-t pt-3 flex justify-between text-sm font-semibold" style={{ borderColor: 'var(--bd)', color: 'var(--txt2)' }}>
                  <span>Total</span>
                  <span>{attendance.byStatus.reduce((s, r) => s + r.count, 0)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Revenue */}
        <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--bd)' }}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
            <div>
              <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Revenue by type</h2>
              {revenue && <p className="text-xs mt-0.5 capitalize" style={{ color: 'var(--txt4)' }}>{revenue.accountingMode} basis · £{(revenue.total / 100).toFixed(2)}</p>}
            </div>
            <button onClick={() => downloadCsv(`/reports/revenue?from=${from}&to=${to}&format=csv`, 'revenue.csv')}
              disabled={generating === 'revenue.csv'}
              className="flex items-center gap-1.5 text-xs font-semibold hover:underline disabled:opacity-50 shrink-0" style={{ color: 'var(--sage)' }}>
              <FileDown size={12} /> CSV
            </button>
          </div>
          <div className="p-5">
            {!revenue ? <LoadState error={revenueErr} loading={revenueLoading} onRetry={() => reloadRevenue()} /> : (
              <div className="space-y-3">
                {/* Earned from completed lessons — the figure that matches the
                    "lessons completed" count, so the two cards reconcile. */}
                <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--bd)' }}>
                  <span className="text-sm" style={{ color: 'var(--txt2)' }}>
                    Earned from completed lessons
                    <span className="block text-xs" style={{ color: 'var(--txt4)' }}>{revenue.completedLessons} lesson{revenue.completedLessons !== 1 ? 's' : ''} taught this period</span>
                  </span>
                  <span className="font-extrabold" style={{ color: 'var(--sage-dk)' }}>£{(revenue.earnedFromLessons / 100).toFixed(2)}</span>
                </div>
                <p className="text-xs" style={{ color: 'var(--txt4)' }}>Money movements ({revenue.accountingMode} basis):</p>
                {revenue.byType.length === 0 && <p className="text-sm" style={{ color: 'var(--txt4)' }}>No payments or charges recorded in this period.</p>}
                {revenue.byType.map(row => (
                  <div key={row.type} className="flex items-center justify-between">
                    <span className="text-sm capitalize" style={{ color: 'var(--txt3)' }}>{row.type}</span>
                    <span className="font-bold"
                      style={{ color: row.type === 'charge' ? 'var(--txt)' : row.type === 'payment' ? 'var(--sage)' : 'var(--txt3)' }}>
                      £{(Number(row.total ?? 0) / 100).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Enrollments */}
        <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--bd)' }}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
            <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Active enrollments by instrument</h2>
            <button onClick={() => downloadCsv('/reports/enrollments?format=csv', 'enrollments.csv')}
              disabled={generating === 'enrollments.csv'}
              className="flex items-center gap-1.5 text-xs font-semibold hover:underline disabled:opacity-50" style={{ color: 'var(--sage)' }}>
              <FileDown size={12} /> CSV
            </button>
          </div>
          <div className="p-5">
            {!enrollments ? <LoadState error={enrollmentsErr} loading={enrollmentsLoading} onRetry={() => reloadEnrollments()} /> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {enrollments.byInstrument.length === 0 && <p className="text-sm col-span-3" style={{ color: 'var(--txt4)' }}>No active enrollments.</p>}
                {enrollments.byInstrument.map(row => (
                  <div key={`${row.instrument}-${row.lessonType}`} className="rounded-xl p-4 text-center"
                    style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
                    <p className="text-2xl font-extrabold" style={{ color: 'var(--txt)' }}>{row.count}</p>
                    <p className="text-xs font-semibold capitalize mt-1" style={{ color: 'var(--txt2)' }}>{row.instrument}</p>
                    <p className="text-xs capitalize" style={{ color: 'var(--txt4)' }}>{row.lessonType}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Retention */}
        <div className="bg-white rounded-2xl border overflow-hidden lg:col-span-2" style={{ borderColor: 'var(--bd)' }}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
            <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Retention — active vs withdrawn by enrollment month</h2>
            <button onClick={() => downloadCsv('/reports/retention?format=csv', 'retention.csv')}
              disabled={generating === 'retention.csv'}
              className="flex items-center gap-1.5 text-xs font-semibold hover:underline disabled:opacity-50" style={{ color: 'var(--sage)' }}>
              <FileDown size={12} /> CSV
            </button>
          </div>
          <div className="p-5">
            {!retention ? <LoadState error={retentionErr} loading={retentionLoading} onRetry={() => reloadRetention()} /> : (
              <div className="overflow-x-auto">
                {retention.byMonth.length === 0 ? <p className="text-sm" style={{ color: 'var(--txt4)' }}>No enrollment history yet.</p> : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left" style={{ color: 'var(--txt3)' }}>
                        <th className="font-semibold pb-2">Month</th>
                        <th className="font-semibold pb-2 text-right">Active</th>
                        <th className="font-semibold pb-2 text-right">Withdrawn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: 'var(--bd)' }}>
                      {retention.byMonth.map(row => (
                        <tr key={row.month}>
                          <td className="py-2 font-medium" style={{ color: 'var(--txt)' }}>{row.month}</td>
                          <td className="py-2 text-right font-bold" style={{ color: 'var(--sage-dk)' }}>{row.active}</td>
                          <td className="py-2 text-right font-bold" style={{ color: 'var(--coral)' }}>{row.withdrawn}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
