import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { files } from '@music-life/db';
import { randomUUID } from 'crypto';
import type { BaseRole } from '@music-life/types';
import { DbService } from '../db/db.service';
import { FileStoragePort } from './ports/file-storage.port';

// Roles allowed to download any file in their org (e.g. admins approving
// expense receipts). Everyone else can only download files they own.
const MANAGEMENT_ROLES: BaseRole[] = ['system_admin', 'admin', 'manager'];

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

  async signDownload(fileId: string, caller: { userId: string; orgId: string; role: BaseRole }) {
    // Scope the lookup to the caller's org so a file id from one org can never be
    // signed by another, then enforce per-file access within the org (BUG-012):
    // only the file's owner or a management role may download it. This closes the
    // IDOR where any authenticated org user could pull another user's file (e.g. an
    // expense receipt) by guessing its id. We return 404 rather than 403 so an
    // unauthorised caller can't even confirm the file exists.
    const file = await this.db.db.query.files.findFirst({
      where: and(eq(files.id, fileId), eq(files.organizationId, caller.orgId)),
    });
    if (!file) throw new NotFoundException('File not found');

    const isOwner = file.ownerId === caller.userId;
    const isManagement = MANAGEMENT_ROLES.includes(caller.role);
    if (!isOwner && !isManagement) throw new NotFoundException('File not found');

    return this.storage.signDownload({ fileKey: file.key });
  }

  async markClean(fileId: string) {
    await this.db.db.update(files).set({ virusScanStatus: 'clean' }).where(eq(files.id, fileId));
  }
}
