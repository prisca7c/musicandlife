'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApi } from '@/lib/swr';
import { formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { PrivilegeMatrix } from '@/components/privilege-matrix';
import { StaffAvailability } from '@/components/staff-availability';
import { StaffInstruments } from '@/components/staff-instruments';
import { StaffPayrollEditor } from '@/components/staff-payroll-editor';
import { StaffAdminDetails } from '@/components/staff-admin-details';
import { AssignStudentsButton } from '@/components/assign-students-button';
import { BackButton } from '@/components/back-button';
import { StaffStatusToggle } from '@/components/staff-status-toggle';
import { EditStudentModal } from '@/components/edit-student-modal';
import { useRole } from '@/lib/use-role';

interface StaffDetail {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  groupTags: string[];
  instruments: string[];
  defaultDuration: number;
  payrollType: string;
  hourlyRate: number | null;
  payrollBalance: number | null;
  status: string;
  user: { id: string; email: string } | null;
  privileges: { privileges: Record<string, boolean> } | null;
  assignments: {
    id: string;
    role: string;
    student: { id: string; firstName: string; lastName: string; status: string };
    instruments: string[];
    enrollmentStatus: string | null;
    unpaidBilled: number;
  }[];
}

// Shared by both the admin view (any teacher) and a teacher's own self-view —
// enriched with the SAME per-student columns the family profile page shows
// (instruments, status, billed-unpaid), scoped to this teacher's own
// enrolments rather than the student's unrelated overall status (which can
// legitimately disagree — a studio-wide "active" student can still have a
// specific, paused enrolment with this one teacher).
function AssignedStudentsTable({ assignments, readOnly, onEdit }: {
  assignments: StaffDetail['assignments'];
  readOnly: boolean;
  onEdit?: (studentId: string) => void;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Student</th>
          <th>Instruments</th>
          <th>Status</th>
          <th>Billed, unpaid</th>
          {!readOnly && <th>Actions</th>}
        </tr>
      </thead>
      <tbody>
        {assignments.length === 0 && (
          <tr><td colSpan={readOnly ? 4 : 5} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
            No assigned students.
          </td></tr>
        )}
        {[...assignments].sort((a, b) =>
          `${a.student.firstName} ${a.student.lastName}`.localeCompare(`${b.student.firstName} ${b.student.lastName}`),
        ).map((a) => (
          <tr key={a.id}>
            <td>
              <Link href={`/app/students/${a.student.id}`}
                className="font-semibold hover:underline"
                style={{ color: 'var(--sage-dk)' }}>
                {a.student.firstName} {a.student.lastName}
              </Link>
            </td>
            <td className="capitalize" style={{ color: 'var(--txt3)' }}>
              {a.instruments.length > 0 ? a.instruments.join(', ') : '—'}
            </td>
            <td>
              {/* enrollmentStatus is this teacher's own enrolment(s) with the
                  student; null means the link is a pure "Assign students"
                  connection with no enrolment behind it at all. */}
              {a.enrollmentStatus ? <Badge variant={a.enrollmentStatus}>{a.enrollmentStatus}</Badge>
                : <span style={{ color: 'var(--txt4)' }}>—</span>}
            </td>
            <td className="font-medium" style={a.unpaidBilled > 0 ? { color: 'var(--coral)' } : { color: 'var(--txt4)' }}>
              {a.unpaidBilled > 0 ? formatMoney(a.unpaidBilled) : '—'}
            </td>
            {!readOnly && (
              <td>
                <button onClick={() => onEdit?.(a.student.id)}
                  className="text-xs font-semibold hover:underline" style={{ color: 'var(--sage-dk)' }}>
                  Edit
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function StaffDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const role = useRole();
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const { data: member, error, mutate } = useApi<StaffDetail>(`/staff/${id}`);
  const load = () => mutate();

  // A teacher's own id 404s for anyone else — surface that plainly instead of
  // spinning forever (useApi/SWR never resolves `data` on an error response).
  if (error) return <div className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>Staff member not found.</div>;
  if (!member) return <div className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>Loading…</div>;

  // A teacher can only ever load their OWN id (the API 404s any other), so
  // once loaded here `role === 'teacher'` always means "this is me" — show a
  // compact, read-only self-view instead of the full admin record (pay rate,
  // deactivate, privileges) a teacher shouldn't see edit affordances for.
  if (role === 'teacher') {
    return (
      <div>
        <PageHeader title="My students" subtitle={`${member.firstName} ${member.lastName}${member.title ? ` · ${member.title}` : ''}`} />
        <div className="data-table-wrap overflow-hidden">
          <div className="px-5 py-3.5 border-b" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
            <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>
              Assigned Students ({member.assignments.length})
            </h2>
          </div>
          <AssignedStudentsTable assignments={member.assignments} readOnly />
        </div>
      </div>
    );
  }

  return (
    <div>
      <EditStudentModal open={!!editingStudentId} onClose={() => setEditingStudentId(null)} studentId={editingStudentId} onSaved={load} />

      <div className="mb-5">
        <BackButton label="Staff" fallbackHref="/app/staff" />
      </div>
      <PageHeader
        title={`${member.firstName} ${member.lastName}`}
        subtitle={member.title ?? member.user?.email}
        action={
          <StaffStatusToggle
            staffId={member.id}
            initialStatus={member.status}
            teacherName={`${member.firstName} ${member.lastName}`}
          />
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          {/* Email now lives in the editable Admin details card below, alongside
              phone/address — no separate read-only Contact card needed. */}
          <StaffPayrollEditor
            staffId={member.id}
            payrollType={member.payrollType}
            hourlyRate={member.hourlyRate}
            defaultDuration={member.defaultDuration}
          />

          <StaffAdminDetails
            staffId={member.id}
            firstName={member.firstName}
            lastName={member.lastName}
            title={member.title}
            email={member.user?.email ?? null}
            hasAccount={!!member.user}
            phone={member.phone}
            address={member.address}
            notes={member.notes}
            groupTags={member.groupTags}
            payrollBalance={member.payrollBalance}
          />

          <StaffInstruments staffId={member.id} instruments={member.instruments} />
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="data-table-wrap overflow-hidden">
            <div className="px-5 py-3.5 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
              <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>
                Assigned Students ({member.assignments.length})
              </h2>
              <AssignStudentsButton teacherId={member.id} teacherName={`${member.firstName} ${member.lastName}`} />
            </div>
            <AssignedStudentsTable assignments={member.assignments} readOnly={false} onEdit={setEditingStudentId} />
          </div>

          <StaffAvailability staffId={member.id} />

          <PrivilegeMatrix
            staffId={member.id}
            privileges={member.privileges?.privileges ?? {}}
          />
        </div>
      </div>
    </div>
  );
}
