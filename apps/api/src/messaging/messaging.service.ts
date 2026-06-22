import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { threads, threadParticipants, messages } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateThreadDto } from './dto/create-thread.dto';

@Injectable()
export class MessagingService {
  constructor(private readonly db: DbService) {}

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

  async createThread(orgId: string, userId: string, dto: CreateThreadDto) {
    const [thread] = await this.db.db.insert(threads).values({
      organizationId: orgId, subject: dto.subject, createdBy: userId,
    }).returning();

    // Add creator + extra participants
    const participantIds = [...new Set([userId, ...(dto.participantIds ?? [])])];
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
