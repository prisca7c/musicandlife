import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { users, memberships } from '@music-life/db';
import { DbService } from '../db/db.service';

@Injectable()
export class UsersService {
  constructor(private readonly db: DbService) {}

  async findById(id: string) {
    const user = await this.db.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getMembership(userId: string, orgId: string) {
    const m = await this.db.db.query.memberships.findFirst({
      where: and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, orgId),
        eq(memberships.status, 'active'),
      ),
    });
    if (!m) throw new NotFoundException('Membership not found');
    return m;
  }
}
