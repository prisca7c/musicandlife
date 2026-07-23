'use client';

/**
 * The difference between "still loading" and "this failed".
 *
 * Pages were written as `!data ? 'Loading…' : …`, which ignores the error SWR
 * hands back. SWR also retries on failure, and with no data every retry
 * re-enters the loading state — so a 403 or a 500 rendered as a spinner that
 * never resolved. That is what "Reschedules just says Loading" was (#77), and
 * the same shape existed on every section of Reports.
 *
 * Returns null once there is data to show.
 */
export function LoadState({
  error,
  loading,
  onRetry,
  label = 'Loading…',
  failedLabel = "Couldn't load this.",
}: {
  error?: unknown;
  loading?: boolean;
  onRetry?: () => void;
  label?: string;
  failedLabel?: string;
}) {
  if (error) {
    return (
      <div className="text-sm">
        <p style={{ color: 'var(--coral)' }}>{failedLabel}</p>
        {onRetry && (
          <button onClick={onRetry}
            className="mt-2 text-xs font-semibold rounded-lg border px-2.5 py-1.5 hover:bg-[var(--surf)]"
            style={{ borderColor: 'var(--bd2)', color: 'var(--txt)' }}>
            Try again
          </button>
        )}
      </div>
    );
  }
  if (loading) return <p className="text-sm" style={{ color: 'var(--txt4)' }}>{label}</p>;
  return null;
}
