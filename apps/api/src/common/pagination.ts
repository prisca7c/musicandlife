/**
 * Opt-in, backwards-compatible pagination.
 *
 * List endpoints keep returning a plain array when no pagination params are
 * given (so existing callers are unaffected). When `limit`/`offset` are passed,
 * `parsePage` returns clamped values and the endpoint returns a `Paginated<T>`
 * envelope instead. This lets the frontend adopt pagination per-page without a
 * breaking, all-at-once API shape change.
 */
export interface PageParams {
  limit: number;
  offset: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Returns null when the request isn't paginated (no limit/offset present). */
export function parsePage(limit?: string, offset?: string): PageParams | null {
  if (limit === undefined && offset === undefined) return null;
  const l = Math.min(Math.max(parseInt(limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const o = Math.max(parseInt(offset ?? '0', 10) || 0, 0);
  return { limit: l, offset: o };
}
