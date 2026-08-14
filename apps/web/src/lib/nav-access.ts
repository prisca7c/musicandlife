import type { BaseRole } from '@music-life/types';

/**
 * Single source of truth for which roles may reach each /app route.
 *
 * Used in two places so nav visibility and route access can never drift apart:
 *   - middleware.ts gates the request before the page renders (a teacher can no
 *     longer open /app/staff by typing the URL and land on an empty admin page);
 *   - app-shell.tsx filters the sidebar to the links a role is allowed to use.
 *
 * Membership is EXACT, not hierarchical — admin and teacher are the only two
 * staff-side roles now, and which pages a teacher can reach isn't just "below
 * admin," so a plain ROLE_LEVEL threshold would be wrong here. The API
 * (RolesGuard) remains the real security boundary; this map is about not
 * showing people doors that only open onto a 403.
 *
 * Edge-safe: pure data + string helpers, no JSX or Node APIs, so middleware
 * (edge runtime) can import it.
 */
export interface RouteAccess { href: string; roles: BaseRole[]; }

export const ROUTE_ACCESS: RouteAccess[] = [
  { href: '/app/dashboard',             roles: ['admin', 'teacher'] },
  { href: '/app/family/dashboard',      roles: ['guardian', 'student'] },
  { href: '/app/family/book',           roles: ['guardian', 'student'] },
  { href: '/app/family/history',        roles: ['guardian', 'student'] },
  { href: '/app/family/notes',          roles: ['guardian', 'student'] },
  { href: '/app/family/calendar',       roles: ['guardian', 'student'] },
  { href: '/app/calendar',              roles: ['admin', 'teacher'] },
  { href: '/app/attendance',            roles: ['admin', 'teacher'] },
  { href: '/app/lesson-requests',       roles: ['admin', 'teacher'] },
  { href: '/app/availability',          roles: ['teacher'] },
  { href: '/app/notes',                 roles: ['admin', 'teacher'] },
  { href: '/app/students',              roles: ['admin', 'teacher'] },
  { href: '/app/families',              roles: ['admin'] },
  { href: '/app/staff/payroll',         roles: ['admin'] },
  // One page, two views: admins get the full staff record, teachers get the
  // read-only colleagues directory (StaffPage branches by role).
  { href: '/app/staff',                 roles: ['admin', 'teacher'] },
  { href: '/app/my-pay',                roles: ['teacher'] },
  { href: '/app/billing/reconciliation', roles: ['admin'] },
  { href: '/app/billing',               roles: ['admin', 'guardian', 'student'] },
  { href: '/app/intake',                roles: ['admin'] },
  { href: '/app/messaging',             roles: ['admin', 'teacher', 'guardian', 'student'] },
  { href: '/app/resource-subscribers',  roles: ['admin'] },
  { href: '/app/resources',             roles: ['admin', 'teacher', 'guardian', 'student'] },
  { href: '/app/content',               roles: ['admin', 'teacher'] },
  { href: '/app/news',                  roles: ['admin'] },
  { href: '/app/broadcasts',            roles: ['admin'] },
  { href: '/app/reports',               roles: ['admin'] },
  { href: '/app/settings',              roles: ['admin'] },
];

/**
 * Roles allowed on the route serving `pathname`, by longest matching href
 * prefix so /app/staff/payroll resolves to the payroll rule, not /app/staff,
 * and /app/billing/<invoiceId> falls back to /app/billing. Returns null when no
 * rule matches (an unmapped /app route) so callers can decide the default.
 */
export function rolesForPath(pathname: string): BaseRole[] | null {
  let best: RouteAccess | null = null;
  for (const r of ROUTE_ACCESS) {
    if (pathname === r.href || pathname.startsWith(r.href + '/')) {
      if (!best || r.href.length > best.href.length) best = r;
    }
  }
  return best ? best.roles : null;
}

/** Fails OPEN for unmapped /app routes, matching the pre-existing behaviour. */
export function canAccess(role: BaseRole, pathname: string): boolean {
  const roles = rolesForPath(pathname);
  return roles ? roles.includes(role) : true;
}

/** Where to send someone who lands on a route their role can't use. */
export function homeFor(role: BaseRole): string {
  return role === 'guardian' || role === 'student' ? '/app/family/dashboard' : '/app/dashboard';
}
