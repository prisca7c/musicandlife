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
    return org;
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
