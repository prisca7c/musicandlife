import { newsPublishedCutoff } from '../src/news/news.controller';
import type { BaseRole } from '@music-life/types';

// A future-dated news post must not appear in a family/student/teacher feed
// until its publish time arrives, but management needs to see the scheduled
// queue to manage it. newsPublishedCutoff encodes that gate: readers get "now"
// (query bounds publishedAt <= now), management gets null (no bound).

describe('newsPublishedCutoff — who sees scheduled posts', () => {
  const now = new Date('2026-08-02T12:00:00Z');

  it('bounds every non-management reader to already-published posts', () => {
    for (const role of ['teacher', 'guardian', 'student', 'receptionist', 'technician'] as BaseRole[]) {
      expect(newsPublishedCutoff(role, now)).toEqual(now);
    }
  });

  it('lets management see the full queue (no cutoff)', () => {
    for (const role of ['manager', 'admin', 'system_admin'] as BaseRole[]) {
      expect(newsPublishedCutoff(role, now)).toBeNull();
    }
  });
});
