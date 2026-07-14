'use client';

import { StaffAvailability } from '@/components/staff-availability';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';

export default function MyAvailabilityPage() {
  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            My availability
            <InfoTooltip text="Set the days and times you're free to teach. Families can only book you inside these windows. Add as many windows per day as you like — for example a morning and an evening slot on the same day." />
          </span>
        }
        subtitle="Set your weekly teaching hours — families can only book inside these windows"
      />
      <StaffAvailability self />
    </div>
  );
}
