'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
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
import { EditEnrollmentModal } from '@/components/edit-enrollment-modal';
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
    enrollmentId: string | null;
    unpaidBilled: number;
  }[];
}

// Shared by both the admin view (any teacher) and a teacher's own self-view —
// enriched with the SAME per-student columns the family profile page shows
// (instruments, status, billed-unpaid), scoped to this teacher's own
// enrolments rather than the student's unrelated overall status (which can
// legitimately disagree — a studio-wide "active" student can still have a
// specific, paused enrolment with this one teacher).
function AssignedStudentsTable({ assignments, readOnly, onEdit, onUnassign }: {
  assignments: StaffDetail['assignments'];
  readOnly: boolean;
  onEdit?: (enrollmentId: string) => void;
  onUnassign?: (assignmentId: string, studentId: string, studentName: string) => void;
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
                <div className="flex items-center gap-2">
                  {a.enrollmentId ? (
                    <button onClick={() => onEdit?.(a.enrollmentId!)}
                      className="text-xs font-semibold hover:underline" style={{ color: 'var(--sage-dk)' }}>
                      Edit
                    </button>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--txt4)' }} title="No enrolment yet — add one from the student's profile">
                      —
                    </span>
                  )}
                  <button onClick={() => onUnassign?.(a.id, a.student.id, `${a.student.firstName} ${a.student.lastName}`)}
                    className="hover:opacity-70" title="Unassign" aria-label={`Unassign ${a.student.firstName} ${a.student.lastName}`}
                    style={{ color: 'var(--coral)' }}>
                    <TrashIcon />
                  </button>
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function StaffDetailView({ id }: { id: string }) {
  const role = useRole();
  const [editingEnrollmentId, setEditingEnrollmentId] = useState<string | null>(null);
  const { data: member, error, mutate } = useApi<StaffDetail>(`/staff/${id}`);
  const load = () => mutate();
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function unassign(assignmentId: string, studentId: string, studentName: string) {
    // A row sourced purely from an enrolment (no real teacherAssignments row)
    // has a synthetic id ("enrollment-<studentId>") — there's nothing to
    // unassign via the assignments endpoint; the connection lives on the
    // enrolment itself, so send them there instead of erroring.
    if (assignmentId.startsWith('enrollment-')) {
      alert(`${studentName} is linked to ${member?.firstName ?? 'this teacher'} through an enrolment, not a direct assignment — edit the enrolment on the student's profile to change it.`);
      return;
    }
    if (!confirm(`Unassign ${studentName} from ${member?.firstName ?? 'this teacher'}? This only removes the assignment link — it doesn't touch any enrolment or lesson history.`)) return;
    try {
      await apiFetch(`/staff/${id}/assignments/${studentId}`, { method: 'DELETE', token: tok() });
      load();
    } catch (e) { alert(e instanceof Error ? e.message : 'Could not unassign this student'); }
  }

  if (error) return <div className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>Staff member not found.</div>;
  if (!member) return <div className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>Loading…</div>;

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
      <EditEnrollmentModal open={!!editingEnrollmentId} onClose={() => setEditingEnrollmentId(null)} enrollmentId={editingEnrollmentId} onSaved={load} />

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
            <AssignedStudentsTable assignments={member.assignments} readOnly={false} onEdit={setEditingEnrollmentId} onUnassign={unassign} />
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
