'use client';

import { useApi } from '@/lib/swr';
import { StaffDetailView } from '@/components/staff-detail-view';

// Nav entry point for a teacher's "My students" link — resolves their own
// staffId via /staff/me and renders the shared detail view IN PLACE (no
// redirect to /app/staff/{id}) so the URL stays /app/staff/me. A redirect
// would change the pathname to the real id, which is indistinguishable from
// the generic "Staff" nav link's href prefix — the sidebar highlighted
// "Staff" (Colleagues) instead of "My students" the moment the page loaded.
export default function MyStaffProfilePage() {
  const { data: me } = useApi<{ id: string } | null>('/staff/me');
  if (!me) return <div className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>Loading…</div>;
  return <StaffDetailView id={me.id} />;
}
