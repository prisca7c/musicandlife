import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { eq, and, ne, inArray, sql, count } from 'drizzle-orm';
import {
  threads, threadParticipants, messages, memberships,
  staffMembers, students, guardians, enrollments, teacherAssignments,
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

  // The set of guardian/student user-ids a teacher is allowed to message: the
  // families of students they actually teach (via enrollment or assignment) plus
  // those students' own logins. A teacher shouldn't be able to contact every
  // family in the school — only their own. Managers/admins/reception are not
  // limited this way. Returns an empty set for a teacher with no students.
  private async teacherFamilyUserIds(orgId: string, teacherUserId: string): Promise<Set<string>> {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, teacherUserId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true },
    });
    if (!staff) return new Set();

    const [enr, assigns] = await Promise.all([
      this.db.db.query.enrollments.findMany({
        where: and(eq(enrollments.organizationId, orgId), eq(enrollments.teacherId, staff.id)),
        columns: { studentId: true },
      }),
      this.db.db.query.teacherAssignments.findMany({
        where: and(eq(teacherAssignments.organizationId, orgId), eq(teacherAssignments.staffId, staff.id)),
        columns: { studentId: true },
      }),
    ]);
    const studentIds = [...new Set([...enr.map((e) => e.studentId), ...assigns.map((a) => a.studentId)])];
    if (studentIds.length === 0) return new Set();

    const studs = await this.db.db.query.students.findMany({
      where: and(eq(students.organizationId, orgId), inArray(students.id, studentIds)),
      columns: { familyId: true, studentUserId: true },
    });
    const familyIds = [...new Set(studs.map((s) => s.familyId))];
    const guards = familyIds.length
      ? await this.db.db.query.guardians.findMany({
          where: and(eq(guardians.organizationId, orgId), inArray(guardians.familyId, familyIds)),
          columns: { userId: true },
        })
      : [];

    const allowed = new Set<string>();
    for (const g of guards) if (g.userId) allowed.add(g.userId);
    for (const s of studs) if (s.studentUserId) allowed.add(s.studentUserId);
    return allowed;
  }

  /**
   * Human identity for a set of user ids: real name + role, resolved from the
   * staff / student / guardian records with the email prefix as a last resort.
   *
   * Threads used to be rendered from `email.split('@')[0]`, so a conversation
   * was labelled "prisca.meredith.chien" instead of "Prisca Chien · Admin".
   * With several similar-looking addresses on screen it was genuinely hard to
   * tell who you were writing to — which is how a message meant for the office
   * ends up in front of a parent.
   */
  private async describeUsers(orgId: string, ids: string[]) {
    const out = new Map<string, { userId: string; name: string; email: string; role: string; roleLabel: string }>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return out;

    const [mems, staff, studs, guards] = await Promise.all([
      this.db.db.query.memberships.findMany({
        where: and(eq(memberships.organizationId, orgId), inArray(memberships.userId, unique)),
        columns: { userId: true, baseRole: true },
        with: { user: { columns: { id: true, email: true } } },
      }),
      this.db.db.query.staffMembers.findMany({
        where: and(eq(staffMembers.organizationId, orgId), inArray(staffMembers.userId, unique)),
        columns: { userId: true, firstName: true, lastName: true },
      }),
      this.db.db.query.students.findMany({
        where: and(eq(students.organizationId, orgId), inArray(students.studentUserId, unique)),
        columns: { studentUserId: true, firstName: true, lastName: true },
      }),
      this.db.db.query.guardians.findMany({
        where: and(eq(guardians.organizationId, orgId), inArray(guardians.userId, unique)),
        with: { family: { columns: { contactName: true, name: true } } },
      }),
    ]);

    const nameByUser = new Map<string, string>();
    for (const s of staff) if (s.userId) nameByUser.set(s.userId, `${s.firstName} ${s.lastName}`.trim());
    for (const s of studs) if (s.studentUserId) nameByUser.set(s.studentUserId, `${s.firstName} ${s.lastName}`.trim());
    for (const g of guards) {
      const n = g.family?.contactName || g.family?.name || '';
      if (n) nameByUser.set(g.userId, n);
    }

    for (const m of mems) {
      const email = m.user?.email ?? '';
      out.set(m.userId, {
        userId: m.userId,
        name: nameByUser.get(m.userId) || email.split('@')[0] || 'User',
        email,
        role: m.baseRole,
        roleLabel: ROLE_LABEL[m.baseRole] ?? m.baseRole,
      });
    }
    return out;
  }

  // A message counts as unread when the caller isn't in its readBy list. Own
  // messages never count — you don't have unread mail from yourself.
  private unreadFilter(userId: string) {
    return sql`NOT (${messages.readBy} @> ${JSON.stringify([userId])}::jsonb)`;
  }

  // ─── Recipients the caller is allowed to message ─────────────────────────
  // Powers the compose picker so a thread is never created with no addressee.
  // Management staff can reach everyone in the org; a TEACHER reaches all staff
  // but only the families they teach; a parent/student may only reach staff
  // (mirrors the guard in createThread). Names are resolved from the staff /
  // student / guardian records, falling back to the email prefix.
  async getRecipients(orgId: string, userId: string, role: BaseRole) {
    const creatorIsStaff = !NON_STAFF_ROLES.includes(role);
    const isTeacher = role === 'teacher';
    const teacherScope = isTeacher ? await this.teacherFamilyUserIds(orgId, userId) : null;

    const mems = await this.db.db.query.memberships.findMany({
      where: and(eq(memberships.organizationId, orgId), eq(memberships.status, 'active')),
      columns: { userId: true, baseRole: true },
      with: { user: { columns: { id: true, email: true } } },
    });

    const candidates = mems.filter((m) => {
      if (m.userId === userId) return false;
      const recipientIsNonStaff = NON_STAFF_ROLES.includes(m.baseRole as BaseRole);
      if (!creatorIsStaff) return !recipientIsNonStaff;   // parent/student → staff only
      if (!recipientIsNonStaff) return true;              // any staff can reach other staff
      // recipient is a parent/student, creator is staff:
      return isTeacher ? teacherScope!.has(m.userId) : true; // teachers limited to their families
    });
    const ids = candidates.map((m) => m.userId);
    if (ids.length === 0) return [];

    const described = await this.describeUsers(orgId, ids);
    return ids
      .map((id) => described.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
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

    const mine = participations
      .filter(p => p.thread.organizationId === orgId)
      .map(p => p.thread)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    if (mine.length === 0) return [];

    // One lookup for every person across every thread, then one grouped count
    // for the unread badges — the list must not fan out per thread.
    const described = await this.describeUsers(
      orgId,
      mine.flatMap(t => t.participants.map(p => p.userId)),
    );
    const unreadRows = await this.db.db
      .select({ threadId: messages.threadId, n: count() })
      .from(messages)
      .where(and(
        inArray(messages.threadId, mine.map(t => t.id)),
        ne(messages.senderId, userId),
        this.unreadFilter(userId),
      ))
      .groupBy(messages.threadId);
    const unreadByThread = new Map(unreadRows.map(r => [r.threadId, Number(r.n)]));

    return mine.map(t => {
      const others = t.participants
        .filter(p => p.userId !== userId)
        .map(p => described.get(p.userId) ?? { userId: p.userId, name: p.user?.email?.split('@')[0] ?? 'User', email: p.user?.email ?? '', role: '', roleLabel: '' });
      return {
        ...t,
        // Who the conversation is WITH — the headline the list should lead on,
        // rather than the subject line of an email nobody thinks in terms of.
        withNames: others.map(o => o.name),
        people: others,
        unreadCount: unreadByThread.get(t.id) ?? 0,
      };
    });
  }

  private async loadThread(orgId: string, threadId: string, userId: string) {
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

  async getThread(orgId: string, threadId: string, userId: string) {
    const thread = await this.loadThread(orgId, threadId, userId);

    // Opening a thread reads it. Done before the response is built so the
    // unread badge the caller just cleared doesn't come back on the next poll.
    await this.markRead(orgId, threadId, userId);

    const described = await this.describeUsers(orgId, [
      ...thread.participants.map(p => p.userId),
      ...thread.messages.map(m => m.senderId),
    ]);
    const describe = (id: string, email?: string | null) =>
      described.get(id) ?? { userId: id, name: email?.split('@')[0] ?? 'User', email: email ?? '', role: '', roleLabel: '' };

    return {
      ...thread,
      people: thread.participants.map(p => describe(p.userId, p.user?.email)),
      messages: thread.messages.map(m => ({
        ...m,
        senderName: describe(m.senderId, m.sender?.email).name,
        senderRoleLabel: describe(m.senderId, m.sender?.email).roleLabel,
      })),
    };
  }

  // Adds the reader to readBy for every message they hadn't already read.
  // jsonb_insert-free: a concatenation is enough and is idempotent thanks to
  // the NOT-contains guard in the WHERE clause.
  async markRead(orgId: string, threadId: string, userId: string) {
    await this.db.db.update(messages)
      .set({ readBy: sql`${messages.readBy} || ${JSON.stringify([userId])}::jsonb` })
      .where(and(
        eq(messages.organizationId, orgId),
        eq(messages.threadId, threadId),
        this.unreadFilter(userId),
      ));
    return { ok: true };
  }

  // Total unread across every thread — powers the badge in the sidebar so a
  // message doesn't sit unseen until someone happens to open Messages.
  async getUnreadCount(orgId: string, userId: string) {
    const mine = await this.db.db.query.threadParticipants.findMany({
      where: eq(threadParticipants.userId, userId),
      columns: { threadId: true },
    });
    if (mine.length === 0) return { unread: 0 };
    const [row] = await this.db.db
      .select({ n: count() })
      .from(messages)
      .where(and(
        eq(messages.organizationId, orgId),
        inArray(messages.threadId, mine.map(m => m.threadId)),
        ne(messages.senderId, userId),
        this.unreadFilter(userId),
      ));
    return { unread: Number(row?.n ?? 0) };
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
      } else if (creatorRole === 'teacher') {
        // A teacher may message any staff, but only families they teach.
        const familyRecipients = recipientIds.filter((id) => NON_STAFF_ROLES.includes(roleByUser.get(id)!));
        if (familyRecipients.length) {
          const allowed = await this.teacherFamilyUserIds(orgId, userId);
          for (const id of familyRecipients) {
            if (!allowed.has(id)) {
              throw new ForbiddenException('You can only message families of students you teach');
            }
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
    await this.loadThread(orgId, threadId, userId);

    const [msg] = await this.db.db.insert(messages).values({
      organizationId: orgId, threadId, senderId: userId, body, readBy: [userId],
    }).returning();

    await this.db.db.update(threads)
      .set({ updatedAt: new Date() })
      .where(eq(threads.id, threadId));

    return msg!;
  }
}
