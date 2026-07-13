import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
    originalName?: string; tier?: 'active' | 'archive'; expiring?: boolean;
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

  async signDownload(fileId: string, orgId: string) {
    // Scope the lookup to the caller's org so a file id from one org can never be
    // signed by another. NOTE: this does NOT yet enforce per-file ownership/scope
    // (resource visibility) — see BUG-012. Within an org any authenticated user can
    // still download any file by id; wiring the resource-scope ACL here is required
    // before launch but needs the product sharing rules and its own reviewed change.
    const file = await this.db.db.query.files.findFirst({
      where: and(eq(files.id, fileId), eq(files.organizationId, orgId)),
    });
    if (!file) throw new NotFoundException('File not found');
    return this.storage.signDownload({ fileKey: file.key });
  }

  async markClean(fileId: string) {
    await this.db.db.update(files).set({ virusScanStatus: 'clean' }).where(eq(files.id, fileId));
  }
}
