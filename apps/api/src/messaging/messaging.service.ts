import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import {
  threads, threadParticipants, messages, memberships,
  staffMembers, students, guardians,
} from '@music-life/db';
import type { BaseRole } from '@music-life/types';
import { DbService } from '../db/db.service';
import type { CreateThreadDto } from './dto/create-thread.dto';

const NON_STAFF_ROLES: BaseRole[] = ['guardian', 'student'];

const ROLE_LABEL: Record<string, string> = {
  system_admin: 'Admin', admin: 'Admin', manager: 'Manager',
  receptionist: 'Reception', technician: 'Technician', teacher: 'Teacher',
  guardian: 'Parent', student: 'Student',
};

@Injectable()
export class MessagingService {
  constructor(private readonly db: DbService) {}

  // ─── Recipients the caller is allowed to message ─────────────────────────
  // Powers the compose picker so a thread is never created with no addressee.
  // Staff can reach everyone in the org; a parent/student may only reach staff
  // (mirrors the guard in createThread). Names are resolved from the staff /
  // student / guardian records, falling back to the email prefix.
  async getRecipients(orgId: string, userId: string, role: BaseRole) {
    const creatorIsStaff = !NON_STAFF_ROLES.includes(role);

    const mems = await this.db.db.query.memberships.findMany({
      where: and(eq(memberships.organizationId, orgId), eq(memberships.status, 'active')),
      columns: { userId: true, baseRole: true },
      with: { user: { columns: { id: true, email: true } } },
    });

    const candidates = mems.filter(
      (m) =>
        m.userId !== userId &&
        (creatorIsStaff || !NON_STAFF_ROLES.includes(m.baseRole as BaseRole)),
    );
    const ids = candidates.map((m) => m.userId);
    if (ids.length === 0) return [];

    const [staff, studs, guards] = await Promise.all([
      this.db.db.query.staffMembers.findMany({
        where: and(eq(staffMembers.organizationId, orgId), inArray(staffMembers.userId, ids)),
        columns: { userId: true, firstName: true, lastName: true },
      }),
      this.db.db.query.students.findMany({
        where: and(eq(students.organizationId, orgId), inArray(students.studentUserId, ids)),
        columns: { studentUserId: true, firstName: true, lastName: true },
      }),
      this.db.db.query.guardians.findMany({
        where: and(eq(guardians.organizationId, orgId), inArray(guardians.userId, ids)),
        with: { family: { columns: { contactName: true, name: true } } },
      }),
    ]);

    const nameByUser = new Map<string, string>();
    for (const s of staff) if (s.userId) nameByUser.set(s.userId, `${s.firstName} ${s.lastName}`);
    for (const s of studs) if (s.studentUserId) nameByUser.set(s.studentUserId, `${s.firstName} ${s.lastName}`);
    for (const g of guards) nameByUser.set(g.userId, g.family?.contactName || g.family?.name || '');

    return candidates
      .map((m) => {
        const email = m.user?.email ?? '';
        const name = nameByUser.get(m.userId) || email.split('@')[0] || 'User';
        return {
          userId: m.userId,
          name,
          email,
          role: m.baseRole,
          roleLabel: ROLE_LABEL[m.baseRole] ?? m.baseRole,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getThreads(orgId: string, userId: string) {
    // Return threads the user participates in
    const participations = await this.db.db.query.threadParticipants.findMany({
      where: eq(threadParticipants.userId, userId),
      with: {
        thread: {
          with: {
            messages: {
              orderBy: (m, { desc }) => [desc(m.createdAt)],
              limit: 1,
            },
            participants: {
              with: { user: { columns: { id: true, email: true } } },
            },
          },
        },
      },
    });

    return participations
      .filter(p => p.thread.organizationId === orgId)
      .map(p => p.thread)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getThread(orgId: string, threadId: string, userId: string) {
    const thread = await this.db.db.query.threads.findFirst({
      where: and(eq(threads.id, threadId), eq(threads.organizationId, orgId)),
      with: {
        messages: {
          with: { sender: { columns: { id: true, email: true } } },
          orderBy: (m, { asc }) => [asc(m.createdAt)],
        },
        participants: {
          with: { user: { columns: { id: true, email: true } } },
        },
      },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    // Check participant
    const isParticipant = thread.participants.some(p => p.userId === userId);
    if (!isParticipant) throw new ForbiddenException('Not a participant in this thread');

    return thread;
  }

  async createThread(orgId: string, userId: string, creatorRole: BaseRole, dto: CreateThreadDto) {
    // ─── Safeguard participant list (BUG-014) ────────────────────────────────
    // Previously any userId could be dropped into participantIds and would be
    // added to the thread — enabling cross-org injection and unsolicited contact
    // (a real concern on a platform with minors). Validate before creating:
    //  1. every recipient must be a member of THIS org, and
    //  2. a non-staff creator (guardian/student) may only message staff, never
    //     other families/students directly.
    const recipientIds = [...new Set(dto.participantIds ?? [])].filter((id) => id !== userId);
    if (recipientIds.length) {
      const members = await this.db.db.query.memberships.findMany({
        where: and(eq(memberships.organizationId, orgId), inArray(memberships.userId, recipientIds)),
        columns: { userId: true, baseRole: true },
      });
      const roleByUser = new Map(members.map((m) => [m.userId, m.baseRole]));

      for (const id of recipientIds) {
        if (!roleByUser.has(id)) {
          throw new ForbiddenException('All recipients must belong to your organisation');
        }
      }

      const creatorIsStaff = !NON_STAFF_ROLES.includes(creatorRole);
      if (!creatorIsStaff) {
        for (const id of recipientIds) {
          if (NON_STAFF_ROLES.includes(roleByUser.get(id)!)) {
            throw new ForbiddenException('You can only start conversations with staff members');
          }
        }
      }
    }

    const [thread] = await this.db.db.insert(threads).values({
      organizationId: orgId, subject: dto.subject, createdBy: userId,
    }).returning();

    // Add creator + extra participants
    const participantIds = [...new Set([userId, ...recipientIds])];
    for (const pid of participantIds) {
      await this.db.db.insert(threadParticipants)
        .values({ threadId: thread!.id, userId: pid })
        .onConflictDoNothing();
    }

    // Post opening message
    await this.db.db.insert(messages).values({
      organizationId: orgId, threadId: thread!.id, senderId: userId,
      body: dto.body, readBy: [userId],
    });

    return thread!;
  }

  async sendMessage(orgId: string, threadId: string, userId: string, body: string) {
    await this.getThread(orgId, threadId, userId);

    const [msg] = await this.db.db.insert(messages).values({
      organizationId: orgId, threadId, senderId: userId, body, readBy: [userId],
    }).returning();

    await this.db.db.update(threads)
      .set({ updatedAt: new Date() })
      .where(eq(threads.id, threadId));

    return msg!;
  }
}
