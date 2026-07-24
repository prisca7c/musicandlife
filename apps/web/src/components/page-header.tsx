import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-7 gap-4">
      {/* min-w-0 lets a long title wrap instead of forcing the row wider than
          the page and shoving the action button off the right-hand edge. */}
      <div className="min-w-0">
        <h1 className="font-extrabold tracking-tight leading-tight"
          style={{ fontSize: '1.75rem', color: 'var(--txt)', letterSpacing: '-0.025em' }}>
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm font-medium" style={{ color: 'var(--txt3)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
