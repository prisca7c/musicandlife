import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FileStoragePort, type SignedUploadResult, type SignedDownloadResult } from '../ports/file-storage.port';

/**
 * Stub adapter — used in development when AWS credentials aren't configured.
 * Returns placeholder URLs. Swap for S3FileStorageAdapter in production.
 */
@Injectable()
export class StubFileStorageAdapter extends FileStoragePort {
  private readonly logger = new Logger(StubFileStorageAdapter.name);

  async signUpload(opts: {
    orgId: string; ownerId: string; mime: string; size: number;
    originalName?: string; tier?: 'active' | 'archive';
  }): Promise<SignedUploadResult> {
    const fileKey = `${opts.tier ?? 'active'}/org/${opts.orgId}/${randomUUID()}`;
    this.logger.log(`[STUB] signUpload key=${fileKey}`);
    return {
      uploadUrl: `http://localhost:3001/api/v1/files/stub-upload/${encodeURIComponent(fileKey)}`,
      fileKey,
    };
  }

  async signDownload(opts: { fileKey: string; expiresInSeconds?: number }): Promise<SignedDownloadResult> {
    this.logger.log(`[STUB] signDownload key=${opts.fileKey}`);
    return {
      downloadUrl: `http://localhost:3001/api/v1/files/stub-download/${encodeURIComponent(opts.fileKey)}`,
      expiresAt: new Date(Date.now() + (opts.expiresInSeconds ?? 3600) * 1000),
    };
  }

  async archive(fileKey: string): Promise<{ archiveKey: string }> {
    const archiveKey = fileKey.replace(/^active\//, 'archive/');
    this.logger.log(`[STUB] archive ${fileKey} → ${archiveKey}`);
    return { archiveKey };
  }

  async delete(fileKey: string): Promise<void> {
    this.logger.log(`[STUB] delete ${fileKey}`);
  }
}
