import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { resources } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateResourceDto } from './dto/create-resource.dto';
import type { BaseRole } from '@music-life/types';

const ROLE_SCOPES: Record<BaseRole, string[]> = {
  system_admin: ['studio', 'teacher', 'family', 'student'],
  admin: ['studio', 'teacher', 'family', 'student'],
  manager: ['studio', 'teacher', 'family', 'student'],
  receptionist: ['studio', 'family', 'student'],
  technician: ['studio'],
  teacher: ['studio', 'teacher'],
  guardian: ['studio', 'family'],
  student: ['studio', 'student'],
};

@Injectable()
export class ResourcesService {
  constructor(private readonly db: DbService) {}

  async findAll(orgId: string, role: BaseRole) {
    const allowedScopes = (ROLE_SCOPES[role] ?? ['studio']) as ('studio'|'teacher'|'family'|'student')[];
    return this.db.db.query.resources.findMany({
      where: and(
        eq(resources.organizationId, orgId),
        sql`${resources.scope} = ANY(ARRAY[${sql.join(allowedScopes.map(s => sql`${s}`), sql`, `)}])`,
      ),
      with: { file: { columns: { id: true, mime: true, originalName: true } } },
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
  }

  async create(orgId: string, ownerId: string, dto: CreateResourceDto) {
    const [resource] = await this.db.db.insert(resources)
      .values({ ...dto, organizationId: orgId, ownerId })
      .returning();
    return resource!;
  }

  async remove(orgId: string, id: string) {
    const [removed] = await this.db.db.delete(resources)
      .where(and(eq(resources.id, id), eq(resources.organizationId, orgId)))
      .returning();
    if (!removed) throw new NotFoundException('Resource not found');
    return { id };
  }
}
