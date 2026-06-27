import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, ilike, or, inArray } from 'drizzle-orm';
import { families, guardians, students } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateFamilyDto } from './dto/create-family.dto';
import type { UpdateFamilyDto } from './dto/update-family.dto';
import type { InvoicingSettingsDto } from './dto/bulk-invoicing-settings.dto';

@Injectable()
export class FamiliesService {
  constructor(private readonly db: DbService) {}

  async findAll(orgId: string, search?: string) {
    const rows = await this.db.db.query.families.findMany({
      where: search
        ? and(
            eq(families.organizationId, orgId),
            or(
              ilike(families.name, `%${search}%`),
              ilike(families.contactName, `%${search}%`),
              ilike(families.email, `%${search}%`),
            ),
          )
        : eq(families.organizationId, orgId),
      with: { students: { columns: { id: true, firstName: true, lastName: true, status: true } } },
      orderBy: (f, { asc }) => [asc(f.name)],
    });
    return rows;
  }

  async findOne(orgId: string, id: string) {
    const family = await this.db.db.query.families.findFirst({
      where: and(eq(families.id, id), eq(families.organizationId, orgId)),
      with: {
        students: true,
        guardians: { with: { user: { columns: { id: true, email: true } } } },
      },
    });
    if (!family) throw new NotFoundException('Family not found');
    return family;
  }

  async create(orgId: string, dto: CreateFamilyDto) {
    const [family] = await this.db.db
      .insert(families)
      .values({ ...dto, organizationId: orgId })
      .returning();
    return family!;
  }

  async update(orgId: string, id: string, dto: UpdateFamilyDto) {
    const existing = await this.findOne(orgId, id);
    const [updated] = await this.db.db
      .update(families)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(families.id, existing.id), eq(families.organizationId, orgId)))
      .returning();
    return updated!;
  }

  async getLedger(orgId: string, id: string) {
    await this.findOne(orgId, id);
    // Phase 4 stub
    return { familyId: id, entries: [], balance: 0 };
  }

  async bulkApplyInvoicingSettings(orgId: string, familyIds: string[], settings: InvoicingSettingsDto) {
    if (familyIds.length === 0) return { updated: 0 };
    await this.db.db
      .update(families)
      .set({ ...settings, updatedAt: new Date() })
      .where(and(eq(families.organizationId, orgId), inArray(families.id, familyIds)));
    return { updated: familyIds.length };
  }
}
