'use client';

import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';

interface Colleague {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  phone: string | null;
  user: { email: string } | null;
}

// Teacher-facing: every active teacher's name and contact info only — no
// notes, pay rate, payroll balance, or tags. Served by GET /staff/directory,
// which projects exactly these columns server-side.
export default function ColleaguesPage() {
  const { data: colleagues = [] } = useApi<Colleague[]>('/staff/directory');

  return (
    <div>
      <PageHeader title="Colleagues" subtitle={`${colleagues.length} teacher${colleagues.length !== 1 ? 's' : ''}`} />

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Title</th>
              <th>Email</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>
            {colleagues.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                No other teachers yet.
              </td></tr>
            )}
            {colleagues.map(c => (
              <tr key={c.id}>
                <td className="font-semibold" style={{ color: 'var(--sage-dk)' }}>{c.firstName} {c.lastName}</td>
                <td style={{ color: 'var(--txt3)' }}>{c.title ?? '—'}</td>
                <td style={{ color: 'var(--txt3)' }}>{c.user?.email ?? '—'}</td>
                <td style={{ color: 'var(--txt3)' }}>{c.phone ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
