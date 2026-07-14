import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-7">
      <div>
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
      {action && <div className="ml-4 shrink-0">{action}</div>}
    </div>
  );
}
