'use client';

import { useParams } from 'next/navigation';
import { StaffDetailView } from '@/components/staff-detail-view';

export default function StaffDetailPage() {
  const params = useParams<{ id: string }>();
  return <StaffDetailView id={params.id} />;
}
