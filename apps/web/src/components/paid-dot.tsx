/**
 * Red/green payment-status dot used across every portal (admin, teacher,
 * parent/student). Green = paid up / in credit, red = money owed. It sits
 * *next to* the numbers — it never replaces them.
 */
export function PaidDot({ paid, size = 9, label, title }: {
  paid: boolean; size?: number; label?: boolean; title?: string;
}) {
  const tip = title ?? (paid ? 'Paid up' : 'Outstanding balance');
  return (
    <span className="inline-flex items-center gap-1.5 align-middle" title={tip}>
      <span
        className="inline-block rounded-full shrink-0"
        style={{
          width: size, height: size,
          background: paid ? 'var(--sage)' : 'var(--coral)',
          boxShadow: `0 0 0 3px ${paid ? 'rgba(61,122,85,0.15)' : 'rgba(224,122,95,0.15)'}`,
        }}
      />
      {label && (
        <span className="text-xs font-semibold" style={{ color: paid ? 'var(--sage-dk)' : 'var(--coral)' }}>
          {paid ? 'Paid' : 'Owes'}
        </span>
      )}
    </span>
  );
}
