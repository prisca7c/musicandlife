import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { files } from '@music-life/db';
import { randomUUID } from 'crypto';
import type { BaseRole } from '@music-life/types';
import { DbService } from '../db/db.service';
import { FileStoragePort } from './ports/file-storage.port';

// Roles allowed to download any file in their org (e.g. admins approving
// expense receipts). Everyone else can only download files they own.
const MANAGEMENT_ROLES: BaseRole[] = ['admin'];

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

    // Pre-register file metadata. `virusScanStatus` defaults to 'pending' but
    // NOTE (#190): there is no scanning pipeline wired up anywhere in this
    // codebase — no ClamAV/VirusTotal/etc. integration, no worker or webhook
    // that ever transitions this column, and no caller sets it to 'clean' or
    // 'infected'. It exists as an aspirational/unused field only. Do NOT gate
    // downloads on this column (see signDownload/signDownloadForOrg below) —
    // doing so would lock out every download forever, since nothing will ever
    // flip it away from 'pending'. Wiring a real AV scanner is a product
    // decision (which vendor, whose API key/budget) and is intentionally left
    // out of scope here; this comment documents the gap so it isn't mistaken
    // for working malware protection.
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

  // Sign a download for any file in the given org, WITHOUT the per-file owner
  // check. The CALLER is responsible for authorising access first (e.g. the
  // family portal, which verifies the file is an attachment on a family-visible
  // note belonging to one of the caller's own students). Never expose this
  // directly on a controller — always gate it behind a domain check.
  async signDownloadForOrg(
    fileId: string, orgId: string,
    opts: { disposition?: 'inline' | 'attachment' } = {},
  ) {
    const file = await this.db.db.query.files.findFirst({
      where: and(eq(files.id, fileId), eq(files.organizationId, orgId)),
    });
    if (!file) throw new NotFoundException('File not found');
    return {
      ...(await this.storage.signDownload({
        fileKey: file.key,
        disposition: opts.disposition,
        fileName: opts.disposition === 'attachment' ? (file.originalName ?? undefined) : undefined,
      })),
      mime: file.mime,
      originalName: file.originalName,
    };
  }
}
