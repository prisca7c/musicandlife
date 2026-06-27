import type { ReactNode } from 'react';

const VARIANTS: Record<string, string> = {
  active:                  'bg-[var(--sage-lt)] text-[var(--sage-dk)] border border-[var(--sage-md)]',
  trial:                   'bg-[var(--sky-lt)] text-[var(--sky)] border border-[var(--sky-md)]',
  paused:                  'bg-[var(--amber-lt)] text-[var(--amber)] border border-[var(--amber-md)]',
  withdrawn:               'bg-[var(--surf)] text-[var(--txt4)] border border-[var(--bd2)]',
  inactive:                'bg-[var(--surf)] text-[var(--txt4)] border border-[var(--bd2)]',
  planned:                 'bg-[var(--plum-lt)] text-[var(--plum)] border border-[var(--plum-md)]',
  closed:                  'bg-[var(--surf)] text-[var(--txt4)] border border-[var(--bd2)]',
  pending:                 'bg-[var(--amber-lt)] text-[var(--amber)] border border-[var(--amber-md)]',
  approved:                'bg-[var(--sage-lt)] text-[var(--sage-dk)] border border-[var(--sage-md)]',
  denied:                  'bg-[var(--coral-lt)] text-[var(--coral)] border border-[var(--coral)]',
  cancelled_no_makeup:     'bg-[var(--coral-lt)] text-[var(--coral)] border border-[var(--coral)]',
  cancelled_no_pay:        'bg-[var(--amber-lt)] text-[var(--amber)] border border-[var(--amber-md)]',
  cancelled_makeup:        'bg-[var(--plum-lt)] text-[var(--plum)] border border-[var(--plum-md)]',
  cancelled_teacher:       'bg-[var(--amber-lt)] text-[var(--amber)] border border-[var(--amber-md)]',
  present:                 'bg-[var(--sage-lt)] text-[var(--sage-dk)] border border-[var(--sage-md)]',
  absent_makeup:           'bg-[var(--amber-lt)] text-[var(--amber)] border border-[var(--amber-md)]',
  absent_no_makeup:        'bg-[var(--coral-lt)] text-[var(--coral)] border border-[var(--coral)]',
  absent_no_pay:           'bg-[var(--sky-lt)] text-[var(--sky)] border border-[var(--sky-md)]',
  scheduled:               'bg-[var(--sky-lt)] text-[var(--sky)] border border-[var(--sky-md)]',
  completed:               'bg-[var(--sage-lt)] text-[var(--sage-dk)] border border-[var(--sage-md)]',
  makeup:                  'bg-[var(--plum-lt)] text-[var(--plum)] border border-[var(--plum-md)]',
  sent:                    'bg-[var(--sky-lt)] text-[var(--sky)] border border-[var(--sky-md)]',
  paid:                    'bg-[var(--sage-lt)] text-[var(--sage-dk)] border border-[var(--sage-md)]',
  void:                    'bg-[var(--surf)] text-[var(--txt4)] border border-[var(--bd2)]',
  draft:                   'bg-[var(--surf)] text-[var(--txt3)] border border-[var(--bd2)]',
  family:                  'bg-[var(--sage-lt)] text-[var(--sage-dk)] border border-[var(--sage-md)]',
  internal:                'bg-[var(--amber-lt)] text-[var(--amber)] border border-[var(--amber-md)]',
  default:                 'bg-[var(--surf)] text-[var(--txt3)] border border-[var(--bd2)]',
};

export function Badge({ children, variant }: { children: ReactNode; variant?: string }) {
  const cls = VARIANTS[variant ?? 'default'] ?? VARIANTS.default;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${cls}`}>
      {children}
    </span>
  );
}
