import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { recordings, transcripts, lessonSummaries, aiJobs, lessons, students, files } from '@music-life/db';
import { randomUUID } from 'crypto';
import { DbService } from '../db/db.service';
import { FileStoragePort } from '../files/ports/file-storage.port';
import { StubTranscriber } from './providers/transcription.provider';
import { StubSummarizer } from './providers/summary.provider';

const RETAIN_MONTHS = 1; // §0.5 — recordings kept 1 month live before archival

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly transcriber = new StubTranscriber();
  private readonly summarizer = new StubSummarizer();

  constructor(
    private readonly db: DbService,
    private readonly storage: FileStoragePort,
  ) {}

  // ─── Recordings ───────────────────────────────────────────────────────────
  async createRecording(orgId: string, lessonId: string, userId: string, dto: {
    mediaType: 'audio' | 'video'; consent: boolean; mime: string; size: number; originalName?: string;
  }) {
    const lesson = await this.db.db.query.lessons.findFirst({
      where: and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)),
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (!dto.consent) throw new BadRequestException('Consent is required before uploading a recording');

    // Sign upload
    const upload = await this.storage.signUpload({
      orgId, ownerId: userId, mime: dto.mime, size: dto.size,
      originalName: dto.originalName, tier: 'active',
    });

    const retainUntil = new Date();
    retainUntil.setMonth(retainUntil.getMonth() + RETAIN_MONTHS);

    const [recording] = await this.db.db.insert(recordings).values({
      organizationId: orgId,
      lessonId,
      studentId: lesson.studentId,
      fileId: upload.fileId,
      mediaType: dto.mediaType,
      consent: dto.consent,
      consentBy: userId,
      consentAt: new Date(),
      uploadedBy: userId,
      status: 'uploaded',
      retainUntil,
    }).returning();

    return { recordingId: recording!.id, uploadUrl: upload.uploadUrl, status: 'uploaded' };
  }

  async getAiData(orgId: string, lessonId: string) {
    const recording = await this.db.db.query.recordings.findFirst({
      where: and(eq(recordings.lessonId, lessonId), eq(recordings.organizationId, orgId)),
      with: { transcripts: true, summaries: true },
    });

    const jobs = await this.db.db.query.aiJobs.findMany({
      where: and(eq(aiJobs.lessonId, lessonId), eq(aiJobs.organizationId, orgId)),
      orderBy: (j, { desc }) => [desc(j.createdAt)],
    });

    return { recording, jobs };
  }

  // ─── AI summary (manual trigger) ─────────────────────────────────────────
  async triggerSummary(orgId: string, lessonId: string, recordingId: string, userId: string) {
    const recording = await this.db.db.query.recordings.findFirst({
      where: and(eq(recordings.id, recordingId), eq(recordings.organizationId, orgId)),
    });
    if (!recording) throw new NotFoundException('Recording not found');

    const iKey = `summary-${recordingId}-${Date.now()}`;
    const [job] = await this.db.db.insert(aiJobs).values({
      organizationId: orgId,
      lessonId,
      recordingId,
      kind: 'summarize',
      provider: process.env.AI_SUMMARY_PROVIDER ?? 'stub',
      status: 'queued',
      idempotencyKey: iKey,
    }).returning();

    // Run asynchronously
    this.runPipeline(orgId, lessonId, recordingId, job!.id, userId).catch(err =>
      this.logger.warn(`AI pipeline failed: ${err}`),
    );

    return { jobId: job!.id, status: 'queued' };
  }

  private async runPipeline(orgId: string, lessonId: string, recordingId: string, jobId: string, userId: string) {
    try {
      await this.db.db.update(aiJobs).set({ status: 'running', updatedAt: new Date() }).where(eq(aiJobs.id, jobId));

      const recording = await this.db.db.query.recordings.findFirst({ where: eq(recordings.id, recordingId) });
      const lesson = await this.db.db.query.lessons.findFirst({
        where: eq(lessons.id, lessonId),
        with: { student: { columns: { firstName: true, lastName: true } } },
      });

      // Step 1: Transcribe
      const fileKey = recording?.fileId
        ? (await this.db.db.query.files.findFirst({ where: eq(files.id, recording.fileId) }))?.key ?? 'stub'
        : 'stub';

      const transcriptionResult = await this.transcriber.transcribe({
        fileKey,
        mediaType: recording?.mediaType ?? 'audio',
      });

      const retainUntil = new Date();
      retainUntil.setMonth(retainUntil.getMonth() + RETAIN_MONTHS);

      const [transcript] = await this.db.db.insert(transcripts).values({
        organizationId: orgId,
        recordingId,
        provider: transcriptionResult.modelMeta.provider as string ?? 'stub',
        language: transcriptionResult.language,
        text: transcriptionResult.text,
        segments: transcriptionResult.segments,
        modelMeta: transcriptionResult.modelMeta,
        status: 'completed',
        retainUntil,
      }).returning();

      // Step 2: Summarize
      const student = (lesson as { student?: { firstName: string; lastName: string } })?.student;
      const summaryResult = await this.summarizer.summarize({
        transcript: transcriptionResult.text,
        context: {
          studentName: student ? `${student.firstName} ${student.lastName}` : 'Student',
          date: lesson?.startsAt.toISOString().split('T')[0] ?? 'unknown',
        },
      });

      await this.db.db.insert(lessonSummaries).values({
        organizationId: orgId,
        lessonId,
        recordingId,
        transcriptId: transcript!.id,
        provider: summaryResult.modelMeta.provider as string ?? 'stub',
        summary: summaryResult.summary,
        modelMeta: summaryResult.modelMeta,
        generatedBy: userId,
        trigger: 'manual',
        retainUntil,
      });

      await this.db.db.update(aiJobs)
        .set({ status: 'succeeded', updatedAt: new Date() })
        .where(eq(aiJobs.id, jobId));

      await this.db.db.update(recordings)
        .set({ status: 'ready' })
        .where(eq(recordings.id, recordingId));

    } catch (err) {
      await this.db.db.update(aiJobs)
        .set({ status: 'failed', lastError: String(err), updatedAt: new Date() })
        .where(eq(aiJobs.id, jobId));
      throw err;
    }
  }

  // ─── Retention sweep (§0.5) ───────────────────────────────────────────────
  async runMediaArchiveSweep() {
    const now = new Date();
    const expired = await this.db.db.query.recordings.findMany({
      where: and(
        eq(recordings.status, 'ready'),
      ),
    });

    let archived = 0;
    for (const rec of expired) {
      if (!rec.retainUntil || rec.retainUntil > now) continue;
      const fileKey = rec.fileId
        ? (await this.db.db.query.files.findFirst({ where: eq(files.id, rec.fileId) }))?.key
        : null;

      const archiveKey = fileKey
        ? (await this.storage.archive(fileKey)).archiveKey
        : `archived/${rec.id}`;

      await this.db.db.update(recordings)
        .set({ status: 'archived', archivedAt: now, archiveFileKey: archiveKey })
        .where(eq(recordings.id, rec.id));

      archived++;
    }

    this.logger.log(`Media archive sweep: ${archived} recordings archived`);
    return { archived };
  }
}
