import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { eq, and, ne, inArray, sql, count } from 'drizzle-orm';
import {
  threads, threadParticipants, messages, memberships, files, users,
  staffMembers, students, guardians, enrollments, teacherAssignments,
} from '@music-life/db';
import type { BaseRole } from '@music-life/types';
import { DbService } from '../db/db.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateThreadDto } from './dto/create-thread.dto';

const NON_STAFF_ROLES: BaseRole[] = ['guardian', 'student'];

const ROLE_LABEL: Record<string, string> = {
  system_admin: 'Admin', admin: 'Admin', manager: 'Manager',
  receptionist: 'Reception', technician: 'Technician', teacher: 'Teacher',
  guardian: 'Parent', student: 'Student',
};

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly db: DbService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Email everyone else on the thread that a message arrived.
   *
   * Portal messaging exists so teachers and families can talk without swapping
   * phone numbers, which only holds up if a message is actually noticed — an
   * unread badge nobody logs in to see is no better than no message at all. The
   * text is included so the email is useful on its own, but replying happens in
   * the portal, keeping the whole conversation in one place and the sender's
   * address private.
   *
   * Best-effort: a bad address must never fail the send itself.
   */
  private async notifyNewMessage(
    orgId: string,
    threadId: string,
    senderId: string,
    body: string,
    recipients: { userId: string; email: string | null | undefined }[],
  ) {
    const targets = recipients.filter(r => r.userId !== senderId && r.email);
    if (targets.length === 0) return;

    const described = await this.describeUsers(orgId, [senderId]);
    const sender = described.get(senderId);
    const senderName = sender
      ? `${sender.name}${sender.roleLabel ? ` (${sender.roleLabel})` : ''}`
      : 'Someone at Music & Life';

    // Escape before embedding — both the message AND the sender name are
    // user-typed (the name is the family's own contactName from the public
    // registration form) and land in an HTML email. Escaping the body but not
    // the name still let a family set contactName to markup (a phishing link, a
    // tracking pixel) that renders in their teacher's inbox. The subject is a
    // mail header, not HTML, so it keeps the raw name.
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const senderNameHtml = esc(senderName);
    const safe = esc(body).replace(/\r?\n/g, '<br>');
    const preview = safe.trim()
      ? `<strong>${senderNameHtml}</strong> wrote:<br><br>${safe}`
      : `<strong>${senderNameHtml}</strong> sent you an attachment.`;

    for (const t of targets) {
      try {
        await this.notifications.trigger('message.received', {
          orgId,
          email: t.email!,
          subject: `New message from ${senderName}`,
          body: preview,
        });
      } catch (e) {
        this.logger.warn(`message.received notify failed for thread ${threadId}: ${e}`);
      }
    }
  }

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
      // A parent/student is only ever messaging staff, and they don't need —
      // and shouldn't be handed — staff members' personal email addresses just
      // to pick someone from a list. Replying happens in-app. Staff callers are
      // internal and keep the email (it disambiguates two people with one name).
      .map((r) => (creatorIsStaff ? r : { ...r, email: '' }))
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

    const openingAttachments = await this.resolveAttachments(orgId, dto.attachments);

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
      body: dto.body, attachments: openingAttachments, readBy: [userId],
    });

    // Starting a conversation should notify just as a reply does — otherwise the
    // very first message, the one most likely to be missed, is the silent one.
    const recipientRows = await this.db.db.query.users.findMany({
      where: inArray(users.id, recipientIds),
      columns: { id: true, email: true },
    });
    await this.notifyNewMessage(
      orgId, thread!.id, userId, dto.body,
      recipientRows.map(u => ({ userId: u.id, email: u.email })),
    );

    return thread!;
  }

  // ─── Admin oversight ──────────────────────────────────────────────────────
  // A studio running lessons for minors has to be able to review what staff say
  // to families. Deliberately kept OUT of the admin's own inbox: mixing other
  // people's conversations into your unread list makes the inbox unusable and
  // hides the fact that you're reading someone else's mail. It is a separate,
  // read-only tab — an admin can look, but can't post into the thread and
  // doesn't mark anything read on the participants' behalf.
  //
  // Scope is exactly "staff ↔ family" threads the admin isn't already in.
  // Threads that are purely internal (staff only) or purely between families
  // are not oversight material and aren't listed.
  async getOversightThreads(orgId: string, userId: string) {
    const all = await this.db.db.query.threads.findMany({
      where: eq(threads.organizationId, orgId),
      with: {
        messages: { orderBy: (m, { desc }) => [desc(m.createdAt)], limit: 1 },
        participants: true,
      },
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
      limit: 200,
    });
    if (all.length === 0) return [];

    const described = await this.describeUsers(orgId, all.flatMap(t => t.participants.map(p => p.userId)));

    return all
      .filter(t => !t.participants.some(p => p.userId === userId))
      .map(t => {
        const people = t.participants
          .map(p => described.get(p.userId))
          .filter((p): p is NonNullable<typeof p> => Boolean(p));
        const family = people.filter(p => NON_STAFF_ROLES.includes(p.role as BaseRole));
        const staff = people.filter(p => !NON_STAFF_ROLES.includes(p.role as BaseRole));
        return { thread: t, people, family, staff };
      })
      .filter(t => t.family.length > 0 && t.staff.length > 0)
      .map(({ thread, people, family, staff }) => ({
        id: thread.id,
        subject: thread.subject,
        updatedAt: thread.updatedAt,
        messages: thread.messages,
        people,
        staffNames: staff.map(p => p.name),
        familyNames: family.map(p => p.name),
      }));
  }

  async getOversightThread(orgId: string, threadId: string) {
    const thread = await this.db.db.query.threads.findFirst({
      where: and(eq(threads.id, threadId), eq(threads.organizationId, orgId)),
      with: {
        messages: {
          with: { sender: { columns: { id: true, email: true } } },
          orderBy: (m, { asc }) => [asc(m.createdAt)],
        },
        participants: true,
      },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    const described = await this.describeUsers(orgId, [
      ...thread.participants.map(p => p.userId),
      ...thread.messages.map(m => m.senderId),
    ]);
    const describe = (id: string, email?: string | null) =>
      described.get(id) ?? { userId: id, name: email?.split('@')[0] ?? 'User', email: email ?? '', role: '', roleLabel: '' };

    const people = thread.participants.map(p => describe(p.userId));
    // Same guard as the list: oversight is for staff↔family conversations only,
    // so an admin can't reach an arbitrary thread id by typing it into the URL.
    const hasFamily = people.some(p => NON_STAFF_ROLES.includes(p.role as BaseRole));
    const hasStaff = people.some(p => p.role && !NON_STAFF_ROLES.includes(p.role as BaseRole));
    if (!hasFamily || !hasStaff) {
      throw new ForbiddenException('Only staff–family conversations can be reviewed here');
    }

    return {
      id: thread.id,
      subject: thread.subject,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      people,
      // No readBy write anywhere in this path: reviewing a conversation must not
      // tell the parent their message was "read" by someone who never replied.
      messages: thread.messages.map(m => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        senderId: m.senderId,
        senderName: describe(m.senderId, m.sender?.email).name,
        senderRoleLabel: describe(m.senderId, m.sender?.email).roleLabel,
      })),
    };
  }

  /**
   * Validate caller-supplied attachments against the files table.
   *
   * The client sends {fileId, name, mime, size}; only the id is trusted. A file
   * id from another studio would otherwise be pinned into this org's thread,
   * and a spoofed name/mime would be rendered to the recipient as fact.
   */
  private async resolveAttachments(orgId: string, input?: { fileId: string }[]) {
    if (!input?.length) return [];
    const ids = [...new Set(input.map(a => a.fileId))];
    const rows = await this.db.db.query.files.findMany({
      where: and(eq(files.organizationId, orgId), inArray(files.id, ids)),
      columns: { id: true, originalName: true, mime: true, size: true },
    });
    if (rows.length !== ids.length) {
      throw new NotFoundException('One or more attachments could not be found');
    }
    return rows.map(f => ({ fileId: f.id, name: f.originalName, mime: f.mime, size: f.size }));
  }

  /**
   * A signed download for a file attached to a thread the caller is in.
   *
   * Files are otherwise owner-or-management only (files.service enforces that,
   * closing an IDOR). A parent must be able to open a video their teacher sent
   * them without owning the file, so authorisation happens here instead: the
   * caller must be a participant, and the id must actually appear on a message
   * in that thread — not merely exist in the org.
   */
  async signThreadAttachment(orgId: string, threadId: string, userId: string, fileId: string) {
    const thread = await this.loadThread(orgId, threadId, userId);
    const attached = thread.messages.some(m =>
      ((m.attachments ?? []) as { fileId: string }[]).some(a => a.fileId === fileId),
    );
    if (!attached) throw new NotFoundException('Attachment not found');
    return this.files.signDownloadForOrg(fileId, orgId);
  }

  async sendMessage(
    orgId: string, threadId: string, userId: string, body: string,
    attachments?: { fileId: string }[],
  ) {
    const thread = await this.loadThread(orgId, threadId, userId);

    const resolved = await this.resolveAttachments(orgId, attachments);
    if (!body.trim() && resolved.length === 0) {
      throw new BadRequestException('Write a message or attach a file.');
    }

    const [msg] = await this.db.db.insert(messages).values({
      organizationId: orgId, threadId, senderId: userId, body,
      attachments: resolved, readBy: [userId],
    }).returning();

    await this.db.db.update(threads)
      .set({ updatedAt: new Date() })
      .where(eq(threads.id, threadId));

    await this.notifyNewMessage(
      orgId, threadId, userId, body,
      thread.participants.map(p => ({ userId: p.userId, email: p.user?.email })),
    );

    return msg!;
  }
}
