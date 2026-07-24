import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FileStoragePort, type SignedUploadResult, type SignedDownloadResult } from '../ports/file-storage.port';

/**
 * Cloudflare R2 adapter (S3-compatible). Files placed under the `students/`
 * prefix are auto-deleted after 30 days by an R2 lifecycle rule configured
 * on the bucket itself (Cloudflare dashboard or `wrangler` — not app code).
 */
@Injectable()
export class R2FileStorageAdapter extends FileStoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(R2FileStorageAdapter.name);

  constructor() {
    super();
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    this.bucket = process.env.R2_BUCKET ?? '';
    if (!accountId || !accessKeyId || !secretAccessKey || !this.bucket) {
      throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET are required');
    }

    this.client = new S3Client({
      region: 'auto',
      // R2_ENDPOINT override is for buckets created with an EU jurisdiction restriction
      // (https://<account-id>.eu.r2.cloudflarestorage.com) — defaults to the global endpoint.
      endpoint: process.env.R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async signUpload(opts: {
    orgId: string; ownerId: string; mime: string; size: number;
    originalName?: string; tier?: 'active' | 'archive'; expiring?: boolean;
  }): Promise<SignedUploadResult> {
    const prefix = opts.expiring ? 'students' : 'studio';
    const fileKey = `${opts.tier ?? 'active'}/${prefix}/org/${opts.orgId}/${randomUUID()}`;
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: fileKey, ContentType: opts.mime });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: 900 });
    this.logger.log(`signUpload key=${fileKey}`);
    return { uploadUrl, fileKey };
  }

  async signDownload(opts: {
    fileKey: string; expiresInSeconds?: number;
    disposition?: 'inline' | 'attachment'; fileName?: string;
  }): Promise<SignedDownloadResult> {
    // The disposition is baked into the pre-signed URL via a response-header
    // override, so R2 returns Content-Disposition accordingly: 'attachment'
    // makes the browser download the file, 'inline' streams it in place (how a
    // view-only video is served — there's no download link to hand out).
    const responseContentDisposition = opts.disposition
      ? (opts.disposition === 'attachment' && opts.fileName
          ? `attachment; filename="${opts.fileName.replace(/"/g, '')}"`
          : opts.disposition)
      : undefined;
    const command = new GetObjectCommand({
      Bucket: this.bucket, Key: opts.fileKey,
      ...(responseContentDisposition ? { ResponseContentDisposition: responseContentDisposition } : {}),
    });
    const expiresIn = opts.expiresInSeconds ?? 3600;
    const downloadUrl = await getSignedUrl(this.client, command, { expiresIn });
    return { downloadUrl, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  async archive(fileKey: string): Promise<{ archiveKey: string }> {
    const archiveKey = fileKey.replace(/^active\//, 'archive/');
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket, Key: archiveKey, CopySource: `${this.bucket}/${fileKey}`,
    }));
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: fileKey }));
    this.logger.log(`archive ${fileKey} -> ${archiveKey}`);
    return { archiveKey };
  }

  async delete(fileKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: fileKey }));
    this.logger.log(`delete ${fileKey}`);
  }
}
