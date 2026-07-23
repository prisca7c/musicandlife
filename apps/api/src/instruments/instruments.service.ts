import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { instruments, organizations } from '@music-life/db';
import { PRIVATE_INSTRUMENTS, GROUP_INSTRUMENTS, ALL_INSTRUMENTS } from '@music-life/types';
import { DbService } from '../db/db.service';
import type { CreateInstrumentDto, UpdateInstrumentDto } from './dto/instrument.dto';

@Injectable()
export class InstrumentsService {
  constructor(private readonly db: DbService) {}

  /**
   * The instrument list used to live in code as two hardcoded arrays. Rather
   * than ship a data migration, an org with no rows yet is seeded from those
   * same defaults the first time its list is read, so behaviour is identical
   * until someone actually edits it. onConflictDoNothing keeps two concurrent
   * first-reads from racing each other on the (org, name) unique index.
   */
  private async ensureSeeded(orgId: string) {
    const existing = await this.db.db.query.instruments.findFirst({
      where: eq(instruments.organizationId, orgId),
      columns: { id: true },
    });
    if (existing) return;

    const rows = ALL_INSTRUMENTS.map((name, i) => ({
      organizationId: orgId,
      name,
      availablePrivate: (PRIVATE_INSTRUMENTS as readonly string[]).includes(name),
      availableGroup: (GROUP_INSTRUMENTS as readonly string[]).includes(name),
      sortOrder: i,
    }));
    await this.db.db.insert(instruments).values(rows).onConflictDoNothing();
  }

  /** Full list for the Settings editor — includes retired (inactive) rows. */
  async list(orgId: string) {
    await this.ensureSeeded(orgId);
    return this.db.db.query.instruments.findMany({
      where: eq(instruments.organizationId, orgId),
      orderBy: [asc(instruments.sortOrder), asc(instruments.name)],
    });
  }

  /**
   * What the public registration form renders. Shaped as the two lists the form
   * already expects, so the page keeps working unchanged. Only active rows.
   */
  async publicList(slug: string) {
    const org = await this.db.db.query.organizations.findFirst({
      where: eq(organizations.slug, slug),
      columns: { id: true },
    });
    // Unauthenticated callers get the built-in defaults rather than an error if
    // the org can't be resolved — the form must always have something to show.
    if (!org) return { private: [...PRIVATE_INSTRUMENTS], group: [...GROUP_INSTRUMENTS] };

    const rows = await this.list(org.id);
    const active = rows.filter((r) => r.active);
    return {
      private: active.filter((r) => r.availablePrivate).map((r) => r.name),
      group: active.filter((r) => r.availableGroup).map((r) => r.name),
    };
  }

  async create(orgId: string, dto: CreateInstrumentDto) {
    await this.ensureSeeded(orgId);
    const name = dto.name.trim();
    if (!name) throw new ConflictException('Name is required');

    const clash = await this.db.db.query.instruments.findFirst({
      where: and(eq(instruments.organizationId, orgId), eq(instruments.name, name)),
      columns: { id: true },
    });
    if (clash) throw new ConflictException('That instrument already exists');

    const [created] = await this.db.db
      .insert(instruments)
      .values({
        organizationId: orgId,
        name,
        availablePrivate: dto.availablePrivate ?? true,
        availableGroup: dto.availableGroup ?? false,
        sortOrder: dto.sortOrder ?? 100,
      })
      .returning();
    return created!;
  }

  async update(orgId: string, id: string, dto: UpdateInstrumentDto) {
    const existing = await this.db.db.query.instruments.findFirst({
      where: and(eq(instruments.id, id), eq(instruments.organizationId, orgId)),
    });
    if (!existing) throw new NotFoundException('Instrument not found');

    const name = dto.name?.trim();
    if (name && name !== existing.name) {
      const clash = await this.db.db.query.instruments.findFirst({
        where: and(eq(instruments.organizationId, orgId), eq(instruments.name, name)),
        columns: { id: true },
      });
      if (clash) throw new ConflictException('That instrument already exists');
    }

    const [updated] = await this.db.db
      .update(instruments)
      .set({ ...dto, ...(name ? { name } : {}), updatedAt: new Date() })
      .where(and(eq(instruments.id, id), eq(instruments.organizationId, orgId)))
      .returning();
    return updated!;
  }

  /**
   * Hard delete. Safe because enrollments store the instrument as free text, so
   * removing a row never orphans an existing enrollment — it only stops new
   * registrants picking it. Use `active: false` to retire one but keep the row.
   */
  async remove(orgId: string, id: string) {
    const existing = await this.db.db.query.instruments.findFirst({
      where: and(eq(instruments.id, id), eq(instruments.organizationId, orgId)),
      columns: { id: true },
    });
    if (!existing) throw new NotFoundException('Instrument not found');

    await this.db.db
      .delete(instruments)
      .where(and(eq(instruments.id, id), eq(instruments.organizationId, orgId)));
    return { deleted: true };
  }
}
