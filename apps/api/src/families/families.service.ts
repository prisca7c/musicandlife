import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, ilike, or, inArray, sql, asc } from 'drizzle-orm';
import { families, guardians, students, invoices, ledgerEntries, payments, paymentClaims, bankTransactions } from '@music-life/db';
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
      // contactName is the parent's actual "First Last" — sort by that (falling
      // back to the auto-generated family name for the rare row without one) so
      // the default list order matches how families are shown: by first name.
      orderBy: (f) => [asc(sql`coalesce(${f.contactName}, ${f.name})`)],
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

  // Merge a duplicate family (`sourceId`) INTO the one to keep (`targetId`).
  // Everything family-scoped — students, guardians, invoices, ledger entries and
  // payments — is reassigned to the target, the two cached balances are summed,
  // and the now-empty source family is deleted. All in one transaction so a
  // failure leaves both families untouched. Students carry their own lessons,
  // enrollments and lesson credits (those key off studentId, not familyId).
  async mergeFamilies(orgId: string, targetId: string, sourceId: string) {
    if (targetId === sourceId) throw new BadRequestException('Choose two different families to merge.');

    return this.db.db.transaction(async (tx) => {
      const [target, source] = await Promise.all([
        tx.query.families.findFirst({ where: and(eq(families.id, targetId), eq(families.organizationId, orgId)) }),
        tx.query.families.findFirst({ where: and(eq(families.id, sourceId), eq(families.organizationId, orgId)) }),
      ]);
      if (!target || !source) throw new NotFoundException('Family not found');

      const movedStudents = await tx.update(students)
        .set({ familyId: targetId, updatedAt: new Date() })
        .where(and(eq(students.organizationId, orgId), eq(students.familyId, sourceId)))
        .returning({ id: students.id });

      // Guardians: the (familyId,userId) pair is unique, so if the same person
      // already guards the target we drop the duplicate link instead of moving it.
      const [srcGuardians, tgtGuardians] = await Promise.all([
        tx.query.guardians.findMany({ where: and(eq(guardians.organizationId, orgId), eq(guardians.familyId, sourceId)) }),
        tx.query.guardians.findMany({ where: and(eq(guardians.organizationId, orgId), eq(guardians.familyId, targetId)), columns: { userId: true } }),
      ]);
      const tgtUserIds = new Set(tgtGuardians.map((g) => g.userId));
      let movedGuardians = 0;
      for (const g of srcGuardians) {
        if (tgtUserIds.has(g.userId)) {
          await tx.delete(guardians).where(eq(guardians.id, g.id));
        } else {
          await tx.update(guardians).set({ familyId: targetId }).where(eq(guardians.id, g.id));
          movedGuardians++;
        }
      }

      const movedInvoices = await tx.update(invoices)
        .set({ familyId: targetId, updatedAt: new Date() })
        .where(and(eq(invoices.organizationId, orgId), eq(invoices.familyId, sourceId)))
        .returning({ id: invoices.id });
      await tx.update(ledgerEntries).set({ familyId: targetId })
        .where(and(eq(ledgerEntries.organizationId, orgId), eq(ledgerEntries.familyId, sourceId)));
      await tx.update(payments).set({ familyId: targetId })
        .where(and(eq(payments.organizationId, orgId), eq(payments.familyId, sourceId)));

      // paymentClaims (familyId NOT NULL) and bankTransactions (matchedFamilyId)
      // also point at the source. Both are auto-generated by the bank-transfer
      // pay flow and both FK families with ON DELETE NO ACTION, so without moving
      // them the delete below FK-violates and the whole merge rolls back — the
      // merge would silently fail for any family that ever used bank transfer.
      await tx.update(paymentClaims).set({ familyId: targetId })
        .where(and(eq(paymentClaims.organizationId, orgId), eq(paymentClaims.familyId, sourceId)));
      await tx.update(bankTransactions).set({ matchedFamilyId: targetId })
        .where(and(eq(bankTransactions.organizationId, orgId), eq(bankTransactions.matchedFamilyId, sourceId)));

      // Combine balances and keep the later resource-access expiry, if any.
      const dates = [target.resourceAccessPaidUntil, source.resourceAccessPaidUntil].filter(Boolean) as string[];
      const resourceAccessPaidUntil = dates.length ? dates.sort().at(-1)! : null;
      await tx.update(families)
        .set({ balanceCached: target.balanceCached + source.balanceCached, resourceAccessPaidUntil, updatedAt: new Date() })
        .where(eq(families.id, targetId));

      await tx.delete(families).where(eq(families.id, sourceId));

      return {
        targetId, sourceId,
        movedStudents: movedStudents.length,
        movedGuardians,
        movedInvoices: movedInvoices.length,
        newBalance: target.balanceCached + source.balanceCached,
      };
    });
  }
}
