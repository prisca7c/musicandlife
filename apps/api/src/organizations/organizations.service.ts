import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { organizations } from '@music-life/db';
import { DbService } from '../db/db.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly db: DbService) {}

  async findById(id: string) {
    const org = await this.db.db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org) throw new NotFoundException('Organization not found');
    // Spread settings fields (address, bank details, etc.) onto the top level too,
    // so flat consumers (e.g. invoice PDF generation) can read org.address directly
    // while the settings page keeps using the nested org.settings shape.
    return { ...org, ...(org.settings as Record<string, unknown> ?? {}), automation: this.automation() };
  }

  /**
   * Which background jobs are actually running.
   *
   * Two of the three are opt-in env flags, so "this happens automatically" is
   * only true when they're switched on. The UI uses this to decide whether to
   * tell staff a manual button is optional — or to warn them it is currently
   * the only thing doing the job. A tooltip that claims automation that isn't
   * running is worse than no tooltip.
   */
  private automation() {
    return {
      // Generates recurring lessons from enrolment schedules, 2am daily.
      recurringLessons: process.env.RECURRENCE_WORKER_ENABLED === 'true',
      // Marks overdue lessons present, 1am daily. Charges families and pays
      // teachers, hence opt-in.
      attendanceAutocomplete: process.env.ATTENDANCE_AUTOCOMPLETE_ENABLED === 'true',
      // 24h lesson reminders, hourly. Idempotent and read-only, always on.
      lessonReminders: true,
    };
  }

  async findBySlug(slug: string) {
    const org = await this.db.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(id: string, data: { name?: string; settings?: Record<string, unknown> }) {
    const [updated] = await this.db.db
      .update(organizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    if (!updated) throw new NotFoundException('Organization not found');
    return updated;
  }
}
