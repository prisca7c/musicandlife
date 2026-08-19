import { notFound, redirect } from 'next/navigation';
import { serverApiFetch } from '@/lib/server-api';

// Nav entry point for a teacher's "My students" link — resolves their own
// staffId via /staff/me (id + name only) and hands off to the shared detail
// page, which renders the compact read-only self-view for a teacher role.
export default async function MyStaffProfilePage() {
  const me = await serverApiFetch<{ id: string } | null>('/staff/me').catch(() => null);
  if (!me) notFound();
  redirect(`/app/staff/${me.id}`);
}
