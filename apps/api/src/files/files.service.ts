import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { files } from '@music-life/db';
import { randomUUID } from 'crypto';
import { DbService } from '../db/db.service';
import { FileStoragePort } from './ports/file-storage.port';

@Injectable()
export class FilesService {
  constructor(
    private readonly db: DbService,
    private readonly storage: FileStoragePort,
  ) {}

  async signUpload(opts: {
    orgId: string; ownerId: string; mime: string; size: number;
    originalName?: string; tier?: 'active' | 'archive';
  }) {
    const result = await this.storage.signUpload(opts);

    // Pre-register file metadata (virus_scan_status = pending)
    const [file] = await this.db.db.insert(files).values({
      organizationId: opts.orgId,
      key: result.fileKey,
      mime: opts.mime,
      size: opts.size,
      originalName: opts.originalName,
      ownerId: opts.ownerId,
      scope: 'private',
      virusScanStatus: 'pending',
    }).returning();

    return { ...result, fileId: file!.id };
  }

  async signDownload(fileId: string) {
    const file = await this.db.db.query.files.findFirst({ where: eq(files.id, fileId) });
    if (!file) throw new Error('File not found');
    return this.storage.signDownload({ fileKey: file.key });
  }

  async markClean(fileId: string) {
    await this.db.db.update(files).set({ virusScanStatus: 'clean' }).where(eq(files.id, fileId));
  }
}
