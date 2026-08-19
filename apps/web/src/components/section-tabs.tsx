'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// A small tab strip for pages that share a sidebar "section" (Calendar +
// Attendance + Requests; Billing + Payments + Payroll) but no longer each get
// their own sidebar entry — this is how you get from one to another.
export function SectionTabs({ items }: { items: { label: string; href: string; badge?: number }[] }) {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b mb-4" style={{ borderColor: 'var(--bd)' }}>
      {items.map(item => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="px-3.5 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors flex items-center gap-1.5"
            style={active
              ? { borderColor: 'var(--sage)', color: 'var(--sage-dk)' }
              : { borderColor: 'transparent', color: 'var(--txt3)' }}
          >
            {item.label}
            {!!item.badge && (
              <span className="text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center"
                style={{ background: 'var(--coral)', color: '#fff' }}>
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
