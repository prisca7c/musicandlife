import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { organizations } from '@music-life/db';
import { ROLE_LEVEL, type BaseRole } from '@music-life/types';
import { DbService } from '../db/db.service';

// Fields inside org.settings that are financial/sensitive — visible to
// receptionist+ (who legitimately see them on invoice/billing pages) but not
// to a teacher, whose only reason to call GET /organizations/me is the
// `automation` flags used by pages they DO have (attendance, students).
const RESTRICTED_SETTINGS_KEYS = new Set([
  'bankAccountName', 'bankSortCode', 'bankAccountNumber', 'invoiceNotes',
]);

@Injectable()
export class OrganizationsService {
  constructor(private readonly db: DbService) {}

  async findById(id: string, callerRole?: BaseRole) {
    const org = await this.db.db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org) throw new NotFoundException('Organization not found');
    const settings = (org.settings as Record<string, unknown>) ?? {};
    // GET /organizations/me is @Roles('teacher') because automated-hint.tsx
    // (rendered on attendance/students, both teacher-visible pages) needs the
    // `automation` flags below — but that floor also let any teacher-level
    // JWT read the studio's bank account name/sort code/number straight off
    // this endpoint, whether or not any UI page ever showed it to them. Strip
    // those fields for anyone below admin; the billing pages that legitimately
    // display them are admin-only.
    const isFinanceRole = !callerRole || ROLE_LEVEL[callerRole] >= ROLE_LEVEL['admin'];
    const visibleSettings = isFinanceRole
      ? settings
      : Object.fromEntries(Object.entries(settings).filter(([k]) => !RESTRICTED_SETTINGS_KEYS.has(k)));
    // Spread settings fields (address, bank details, etc.) onto the top level too,
    // so flat consumers (e.g. invoice PDF generation) can read org.address directly
    // while the settings page keeps using the nested org.settings shape.
    return { ...org, ...visibleSettings, automation: this.automation() };
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
      // Raises (and optionally emails) invoices for auto-invoice families on
      // their billing anchor day. Writes real money movements, hence opt-in.
      autoInvoicing: process.env.INVOICE_SCHEDULER_ENABLED === 'true',
    };
  }

  async findBySlug(slug: string) {
    const org = await this.db.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(id: string, data: { name?: string; settings?: Record<string, unknown> }) {
    // Merge into the existing settings rather than replacing the jsonb blob
    // outright. The web settings page always spreads the current settings
    // before submitting, so this is currently unreachable through the app —
    // but the DTO takes an open, arbitrary settings object by design (see its
    // comment), and a full-replace silently wipes every OTHER field (bank
    // details used on real invoices, invoice notes) the moment any future
    // caller sends a partial settings object without first reading the
    // current one. Merging is the safe default for a PATCH.
    const existing = data.settings
      ? await this.db.db.query.organizations.findFirst({ where: eq(organizations.id, id), columns: { settings: true } })
      : undefined;
    const mergedSettings = data.settings && existing
      ? { ...(existing.settings as Record<string, unknown> ?? {}), ...data.settings }
      : data.settings;

    const [updated] = await this.db.db
      .update(organizations)
      .set({ ...data, ...(mergedSettings ? { settings: mergedSettings } : {}), updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    if (!updated) throw new NotFoundException('Organization not found');
    return updated;
  }
}
