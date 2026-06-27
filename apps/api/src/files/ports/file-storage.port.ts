export interface SignedUploadResult {
  uploadUrl: string;
  fileKey: string;
  fileId?: string;
}

export interface SignedDownloadResult {
  downloadUrl: string;
  expiresAt: Date;
}

export abstract class FileStoragePort {
  /** Generate a pre-signed URL for PUT upload */
  abstract signUpload(opts: {
    orgId: string;
    ownerId: string;
    mime: string;
    size: number;
    originalName?: string;
    tier?: 'active' | 'archive';
    /** Student-related files (recordings, attachments) get auto-deleted after 30 days. Studio resources/logos do not. */
    expiring?: boolean;
  }): Promise<SignedUploadResult>;

  /** Generate a pre-signed URL for GET download */
  abstract signDownload(opts: {
    fileKey: string;
    expiresInSeconds?: number;
  }): Promise<SignedDownloadResult>;

  /** Move a file to the archive tier */
  abstract archive(fileKey: string): Promise<{ archiveKey: string }>;

  /** Delete a file permanently */
  abstract delete(fileKey: string): Promise<void>;
}
