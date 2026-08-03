import { ForbiddenException } from '@nestjs/common';
import { NotesController } from '../src/notes/notes.controller';

/**
 * The family-portal download endpoint gates a note attachment on the fileId
 * being listed on a family-visible note "never trusting the fileId alone" — but
 * that is only safe if the fileId reached the note legitimately. Nothing checked
 * the fileId at ATTACH time, so a staff member could reference ANY file in the
 * org (another child's lesson recording, a colleague's expense receipt) on their
 * own student's family-visible note and expose it to that family. A note may now
 * reference a file only if the caller uploaded it, or it is already on the note.
 */

type Row = Record<string, unknown>;

function makeController(opts: {
  files?: Row[];
  existingNote?: Row | null;
}) {
  const inserted: Row[] = [];
  const db = {
    db: {
      query: {
        students: { findFirst: async () => ({ id: 'stu-1' }) },
        lessons: { findFirst: async () => ({ id: 'les-1' }) },
        files: { findMany: async () => opts.files ?? [] },
        notes: { findFirst: async () => opts.existingNote ?? null },
      },
      insert: () => ({ values: (v: Row) => ({ returning: async () => { inserted.push(v); return [{ id: 'note-1', ...v }]; } }) }),
      update: () => ({ set: (v: Row) => ({ where: () => ({ returning: async () => [{ id: 'note-1', ...v }] }) }) }),
    },
  };
  return { ctrl: new NotesController(db as never), inserted };
}

const admin = { userId: 'user-1', orgId: 'org-1', role: 'admin' } as never;
const attach = (fileId: string) => ({ fileId, name: 'clip', mime: 'audio/mpeg' });

describe('NotesController — attachment ownership at attach time', () => {
  it('create: allows a file the caller uploaded', async () => {
    const { ctrl, inserted } = makeController({ files: [{ id: 'f1', ownerId: 'user-1' }] });
    await ctrl.create(admin, { studentId: 'stu-1', body: 'hi', attachments: [attach('f1')] } as never);
    expect((inserted[0]!.attachments as Row[])).toHaveLength(1);
  });

  it("create: rejects a file the caller does not own (another user's upload)", async () => {
    const { ctrl } = makeController({ files: [{ id: 'f1', ownerId: 'someone-else' }] });
    await expect(
      ctrl.create(admin, { studentId: 'stu-1', body: 'hi', attachments: [attach('f1')] } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('create: rejects a fileId that does not exist in the org', async () => {
    const { ctrl } = makeController({ files: [] });
    await expect(
      ctrl.create(admin, { studentId: 'stu-1', body: 'hi', attachments: [attach('ghost')] } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update: keeps an existing attachment even if the editor did not upload it, but blocks a new foreign one', async () => {
    // f1 is already on the note (uploaded by another teacher); f2 is a brand-new
    // foreign file the editor does not own.
    const { ctrl } = makeController({
      existingNote: { studentId: 'stu-1', attachments: [{ fileId: 'f1', name: 'x', mime: 'audio/mpeg' }] },
      files: [], // f2 is not owned by the caller
    });
    await expect(
      ctrl.update(admin, 'note-1', { attachments: [attach('f1'), attach('f2')] } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update: allows re-saving with only the existing (foreign) attachment', async () => {
    const { ctrl } = makeController({
      existingNote: { studentId: 'stu-1', attachments: [{ fileId: 'f1', name: 'x', mime: 'audio/mpeg' }] },
      files: [],
    });
    const res = await ctrl.update(admin, 'note-1', { attachments: [attach('f1')] } as never);
    expect(res).toBeTruthy();
  });
});
