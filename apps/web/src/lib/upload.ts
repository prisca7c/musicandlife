import { apiFetch } from '@/lib/api';

interface SignUploadResult { uploadUrl: string; fileKey: string; fileId: string }

/**
 * Two-step direct-to-R2 upload: ask the API for a pre-signed PUT URL (which also
 * pre-registers the file's metadata row), then PUT the bytes straight to storage
 * so they never pass through our API. Returns the `fileId` to attach elsewhere
 * (e.g. a lesson note). `expiring` files live under the auto-cleanup prefix.
 */
export async function uploadFile(
  file: File,
  token?: string,
  opts: { expiring?: boolean } = {},
): Promise<{ fileId: string; name: string; mime: string; size: number }> {
  const mime = file.type || 'application/octet-stream';
  const signed = await apiFetch<SignUploadResult>('/files/sign-upload', {
    method: 'POST',
    token,
    body: JSON.stringify({ mime, size: file.size, originalName: file.name, expiring: opts.expiring ?? true }),
  });

  const put = await fetch(signed.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': mime },
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);

  return { fileId: signed.fileId, name: file.name, mime, size: file.size };
}
