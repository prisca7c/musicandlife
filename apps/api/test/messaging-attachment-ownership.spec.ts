import { MessagingService } from '../src/messaging/messaging.service';
import { ForbiddenException } from '@nestjs/common';

/**
 * A thread attachment becomes downloadable by every participant via
 * signThreadAttachment, which signs through signDownloadForOrg — the org-scoped
 * signer that SKIPS the per-file owner check. So the attach path must authorise:
 * you may only attach a file you uploaded, or one already on the thread.
 *
 * Without this, any participant (a parent, a student's teacher) could pin an
 * arbitrary org file id — an expense receipt, another family's recording — onto
 * a message and then download it, re-opening the owner-or-management IDOR the
 * files service otherwise closes. Same class as the note-attachment fix (#174).
 */

type FileRow = { id: string; ownerId: string; originalName: string; mime: string; size: number };

function makeService(orgFiles: FileRow[]) {
  const db = {
    db: {
      query: {
        files: {
          findMany: async () => orgFiles,
        },
      },
    },
  };
  const svc = new MessagingService(db as never, {} as never, {} as never);
  return svc;
}

const resolve = (
  svc: MessagingService,
  callerUserId: string,
  input: { fileId: string }[],
  existing?: Set<string>,
) =>
  (svc as never as {
    resolveAttachments: (
      orgId: string,
      callerUserId: string,
      input?: { fileId: string }[],
      existingFileIds?: Set<string>,
    ) => Promise<{ fileId: string }[]>;
  }).resolveAttachments('org-1', callerUserId, input, existing);

describe('MessagingService.resolveAttachments — attachment ownership', () => {
  it('accepts a file the caller uploaded', async () => {
    const svc = makeService([
      { id: 'f-mine', ownerId: 'me', originalName: 'a.pdf', mime: 'application/pdf', size: 10 },
    ]);
    const out = await resolve(svc, 'me', [{ fileId: 'f-mine' }]);
    expect(out).toEqual([{ fileId: 'f-mine', name: 'a.pdf', mime: 'application/pdf', size: 10 }]);
  });

  it('rejects a file owned by someone else in the org (IDOR)', async () => {
    const svc = makeService([
      { id: 'f-theirs', ownerId: 'admin', originalName: 'receipt.pdf', mime: 'application/pdf', size: 99 },
    ]);
    await expect(resolve(svc, 'me', [{ fileId: 'f-theirs' }])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still allows a foreign file that is already on the thread (re-quoting)', async () => {
    const svc = makeService([
      { id: 'f-theirs', ownerId: 'teacher', originalName: 'video.mp4', mime: 'video/mp4', size: 500 },
    ]);
    const out = await resolve(svc, 'me', [{ fileId: 'f-theirs' }], new Set(['f-theirs']));
    expect(out).toEqual([{ fileId: 'f-theirs', name: 'video.mp4', mime: 'video/mp4', size: 500 }]);
  });

  it('rejects when any one attachment in a batch is not owned by the caller', async () => {
    const svc = makeService([
      { id: 'f-mine', ownerId: 'me', originalName: 'a.pdf', mime: 'application/pdf', size: 10 },
      { id: 'f-theirs', ownerId: 'admin', originalName: 'b.pdf', mime: 'application/pdf', size: 20 },
    ]);
    await expect(
      resolve(svc, 'me', [{ fileId: 'f-mine' }, { fileId: 'f-theirs' }]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
