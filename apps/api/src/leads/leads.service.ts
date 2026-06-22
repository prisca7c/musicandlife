import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { leads } from '@music-life/db';
import { DbService } from '../db/db.service';

@Injectable()
export class LeadsService {
  constructor(private readonly db: DbService) {}

  async findAll(orgId: string) {
    return this.db.db.query.leads.findMany({
      where: eq(leads.organizationId, orgId),
      orderBy: (l, { desc }) => [desc(l.createdAt)],
    });
  }

  async create(orgId: string, data: { name: string; contact?: string; instrumentInterest?: string; source?: string; notes?: string }) {
    const [lead] = await this.db.db.insert(leads).values({ ...data, organizationId: orgId }).returning();
    return lead!;
  }

  async update(orgId: string, id: string, data: Partial<{ status: 'new' | 'contacted' | 'converted' | 'lost'; notes: string; contact: string }>) {
    const [updated] = await this.db.db.update(leads)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(leads.id, id), eq(leads.organizationId, orgId)))
      .returning();
    if (!updated) throw new NotFoundException('Lead not found');
    return updated;
  }
}
