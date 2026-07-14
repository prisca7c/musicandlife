import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverApiFetch } from '@/lib/server-api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { PrivilegeMatrix } from '@/components/privilege-matrix';
import { StaffAvailability } from '@/components/staff-availability';
import { StaffInstruments } from '@/components/staff-instruments';
import { AssignStudentsButton } from '@/components/assign-students-button';
import { BackButton } from '@/components/back-button';

interface StaffDetail {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  instruments: string[];
  defaultDuration: number;
  payrollType: string;
  hourlyRate: number;
  status: string;
  user: { id: string; email: string } | null;
  privileges: { privileges: Record<string, boolean> } | null;
  assignments: {
    id: string;
    role: string;
    student: { id: string; firstName: string; lastName: string; status: string };
  }[];
}

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await serverApiFetch<StaffDetail>(`/staff/${id}`).catch(() => null);
  if (!member) notFound();

  return (
    <div>
      <div className="mb-5">
        <BackButton label="Staff" fallbackHref="/app/staff" />
      </div>
      <PageHeader
        title={`${member.firstName} ${member.lastName}`}
        subtitle={member.title ?? member.user?.email}
        action={<Badge variant={member.status}>{member.status}</Badge>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <h2 className="font-bold mb-4 text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Contact</h2>
            <dl className="space-y-3 text-sm">
              {member.user?.email && (
                <div className="flex justify-between gap-3">
                  <dt style={{ color: 'var(--txt3)' }}>Email</dt>
                  <dd className="font-medium text-right">{member.user.email}</dd>
                </div>
              )}
              {member.title && (
                <div className="flex justify-between gap-3">
                  <dt style={{ color: 'var(--txt3)' }}>Title</dt>
                  <dd className="font-medium">{member.title}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <h2 className="font-bold mb-4 text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Payroll</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Type</dt>
                <dd className="font-medium capitalize">{member.payrollType}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Rate</dt>
                <dd className="font-medium">£{(member.hourlyRate / 100).toFixed(2)}/hr</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Default duration</dt>
                <dd className="font-medium">{member.defaultDuration} min</dd>
              </div>
            </dl>
          </div>

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
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {member.assignments.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                    No assigned students.
                  </td></tr>
                )}
                {member.assignments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/app/students/${a.student.id}`}
                        className="font-semibold hover:underline"
                        style={{ color: 'var(--sage-dk)' }}>
                        {a.student.firstName} {a.student.lastName}
                      </Link>
                    </td>
                    <td className="capitalize" style={{ color: 'var(--txt3)' }}>{a.role}</td>
                    <td><Badge variant={a.student.status}>{a.student.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
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
