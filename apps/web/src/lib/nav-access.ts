import type { BaseRole } from '@music-life/types';

/**
 * Single source of truth for which roles may reach each /app route.
 *
 * Used in two places so nav visibility and route access can never drift apart:
 *   - middleware.ts gates the request before the page renders (a teacher can no
 *     longer open /app/staff by typing the URL and land on an empty admin page);
 *   - app-shell.tsx filters the sidebar to the links a role is allowed to use.
 *
 * Membership is EXACT, not hierarchical — /app/attendance admits teachers but
 * not receptionists even though a receptionist outranks a teacher, so a plain
 * ROLE_LEVEL threshold would be wrong here. The API (RolesGuard) remains the
 * real security boundary; this map is about not showing people doors that only
 * open onto a 403.
 *
 * Edge-safe: pure data + string helpers, no JSX or Node APIs, so middleware
 * (edge runtime) can import it.
 */
export interface RouteAccess { href: string; roles: BaseRole[]; }

export const ROUTE_ACCESS: RouteAccess[] = [
  { href: '/app/dashboard',             roles: ['system_admin', 'admin', 'manager', 'receptionist', 'teacher'] },
  { href: '/app/family/dashboard',      roles: ['guardian', 'student'] },
  { href: '/app/family/book',           roles: ['guardian', 'student'] },
  { href: '/app/family/history',        roles: ['guardian', 'student'] },
  { href: '/app/family/notes',          roles: ['guardian', 'student'] },
  { href: '/app/family/calendar',       roles: ['guardian', 'student'] },
  { href: '/app/calendar',              roles: ['system_admin', 'admin', 'manager', 'receptionist', 'teacher'] },
  { href: '/app/attendance',            roles: ['system_admin', 'admin', 'manager', 'teacher'] },
  { href: '/app/lesson-requests',       roles: ['system_admin', 'admin', 'manager', 'receptionist', 'teacher'] },
  { href: '/app/reschedule-requests',   roles: ['system_admin', 'admin', 'manager', 'receptionist', 'teacher'] },
  { href: '/app/availability',          roles: ['teacher'] },
  { href: '/app/notes',                 roles: ['system_admin', 'admin', 'manager', 'teacher'] },
  { href: '/app/students',              roles: ['system_admin', 'admin', 'manager', 'receptionist', 'teacher'] },
  { href: '/app/families',              roles: ['system_admin', 'admin', 'manager', 'receptionist'] },
  { href: '/app/staff/payroll',         roles: ['system_admin', 'admin', 'manager'] },
  { href: '/app/staff',                 roles: ['system_admin', 'admin'] },
  { href: '/app/my-pay',                roles: ['teacher'] },
  { href: '/app/billing/reconciliation', roles: ['system_admin', 'admin', 'manager', 'receptionist'] },
  { href: '/app/billing',               roles: ['system_admin', 'admin', 'manager', 'receptionist', 'guardian', 'student'] },
  { href: '/app/intake',                roles: ['system_admin', 'admin', 'manager', 'receptionist'] },
  { href: '/app/messaging',             roles: ['system_admin', 'admin', 'manager', 'teacher', 'guardian', 'student'] },
  { href: '/app/resource-subscribers',  roles: ['system_admin', 'admin', 'manager', 'receptionist'] },
  { href: '/app/resources',             roles: ['system_admin', 'admin', 'manager', 'teacher', 'guardian', 'student'] },
  { href: '/app/content',               roles: ['system_admin', 'admin', 'manager', 'teacher'] },
  { href: '/app/news',                  roles: ['system_admin', 'admin'] },
  { href: '/app/broadcasts',            roles: ['system_admin', 'admin', 'manager'] },
  { href: '/app/reports',               roles: ['system_admin', 'admin', 'manager'] },
  { href: '/app/settings',              roles: ['system_admin', 'admin'] },
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
