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
    return { ...org, ...(org.settings as Record<string, unknown> ?? {}) };
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
