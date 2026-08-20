'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Calendar, Users, Home,
  PoundSterling, ClipboardCheck, MessageSquare,
  FileText, BarChart3, Settings,
  Briefcase, CreditCard, UserCheck, BookOpen, Landmark,
  Clock, History, ChevronLeft, ChevronRight, ChevronDown,
  LogOut, PanelLeftClose, PanelLeftOpen, Megaphone, CalendarPlus, Send, Menu,
} from 'lucide-react';
import type { BaseRole } from '@music-life/types';
import { apiFetch } from '@/lib/api';
import { prefetchRoute, clearApiCache, useApi } from '@/lib/swr';
import { canAccess } from '@/lib/nav-access';
import { NotificationBell } from '@/components/notification-bell';

// Presentation only — which roles may see each link lives in nav-access.ts
// (shared with the middleware route guard) so the sidebar and the URL guard can
// never disagree about who is allowed where.
interface NavItem { label: string; href: string; icon: React.ReactNode; }

const NAV: NavItem[] = [
  { label: 'Dashboard',    href: '/app/dashboard',         icon: <LayoutDashboard size={16} /> },
  { label: 'My lessons',   href: '/app/family/dashboard',  icon: <LayoutDashboard size={16} /> },
  { label: 'My calendar',  href: '/app/family/schedule',   icon: <Calendar size={16} /> },
  { label: 'Book lesson',  href: '/app/family/book',       icon: <Clock size={16} /> },
  { label: 'History',      href: '/app/family/history',    icon: <History size={16} /> },
  { label: 'Lesson notes', href: '/app/family/notes',      icon: <BookOpen size={16} /> },
  { label: 'Add to calendar', href: '/app/family/calendar', icon: <CalendarPlus size={16} /> },
  { label: 'Calendar',     href: '/app/calendar',          icon: <Calendar size={16} /> },
  { label: 'Attendance',   href: '/app/attendance',        icon: <ClipboardCheck size={16} /> },
  { label: 'Requests',     href: '/app/lesson-requests',   icon: <CalendarPlus size={16} /> },
  { label: 'My availability', href: '/app/availability',    icon: <Clock size={16} /> },
  { label: 'Notes',        href: '/app/notes',             icon: <FileText size={16} /> },
  { label: 'Students',     href: '/app/students',          icon: <UserCheck size={16} /> },
  { label: 'Families',     href: '/app/families',          icon: <Home size={16} /> },
  { label: 'Staff',        href: '/app/staff',             icon: <Briefcase size={16} /> },
  { label: 'Payroll',      href: '/app/staff/payroll',     icon: <PoundSterling size={16} /> },
  // Separate from Payroll on purpose: "what am I owed" and "run the studio's
  // payroll" are different jobs, and the Payroll page is manager-only.
  { label: 'My pay',       href: '/app/my-pay',            icon: <PoundSterling size={16} /> },
  { label: 'Billing',      href: '/app/billing',           icon: <CreditCard size={16} /> },
  { label: 'Payments',     href: '/app/billing/reconciliation', icon: <Landmark size={16} /> },
  // No sidebar entry of its own — reached as a tab on the Students page
  // instead (same pattern as Attendance/Payments above). Route stays live.
  { label: 'New students', href: '/app/intake',            icon: <ClipboardCheck size={16} /> },
  { label: 'Messages',     href: '/app/messaging',         icon: <MessageSquare size={16} /> },
  { label: 'Resources',    href: '/app/resources',         icon: <FileText size={16} /> },
  { label: 'Library subscribers', href: '/app/resource-subscribers', icon: <Users size={16} /> },
  { label: 'Repertoire',   href: '/app/content',           icon: <BookOpen size={16} /> },
  { label: 'Studio News',  href: '/app/news',              icon: <Megaphone size={16} /> },
  { label: 'Email everyone', href: '/app/broadcasts',      icon: <Send size={16} /> },
  { label: 'Reports',      href: '/app/reports',           icon: <BarChart3 size={16} /> },
  { label: 'Settings',     href: '/app/settings',          icon: <Settings size={16} /> },
];

// Group nav sections
// Attendance/Requests and Payments/Payroll aren't listed here — they're
// reached from tabs on the Calendar and Billing pages (SectionTabs) instead
// of getting their own sidebar entries. Their NAV entries stay so the routes
// remain directly reachable (bookmarks, links from elsewhere).
const GROUPS = [
  { label: 'Overview', items: ['Dashboard','My lessons','My calendar','Book lesson','History','Lesson notes','Add to calendar'] },
  { label: 'Studio',   items: ['Calendar','My availability','Notes','Messages'] },
  { label: 'People',   items: ['Students','Families','Staff','My pay'] },
  { label: 'Finance',  items: ['Billing'] },
  { label: 'Content',  items: ['Resources','Library subscribers','Repertoire','Studio News','Email everyone'] },
  { label: 'Admin',    items: ['Reports','Settings'] },
];

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', teacher: 'Teacher', guardian: 'Parent / Guardian', student: 'Student',
};

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

function UserMenu({ collapsed, name, email }: { collapsed: boolean; name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function logout() {
    const token = document.cookie.match(/access_token=([^;]+)/)?.[1];
    try { await apiFetch('/auth/logout', { method: 'POST', token }); } catch { /* ignore */ }
    document.cookie = 'access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    // The SWR cache is keyed by path alone, so anything left here would be
    // served to whoever signs in next on this browser.
    await clearApiCache();
    // Hard navigation for the same reason as sign-in: Next's App Router cache
    // survives a router.push, so the next person to sign in on this browser can
    // be handed the pages this session already rendered.
    window.location.href = '/login';
  }

  return (
    <div ref={ref} className="relative px-3 py-3 border-t border-white/10">
      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-1.5 rounded-xl overflow-hidden shadow-xl"
          style={{ background: 'white' }}>
          <button onClick={logout}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--coral-lt)]"
            style={{ color: 'var(--coral)' }}>
            <LogOut size={15} /> Log out
          </button>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2.5 rounded-[9px] transition-colors hover:bg-white/10 ${collapsed ? 'justify-center px-1.5 py-2' : 'px-2 py-2'}`}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold"
          style={{ background: 'var(--sage-md)', color: 'var(--sage-dk)' }}>
          {initialsOf(name) || '?'}
        </div>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-[12.5px] font-semibold text-white truncate leading-tight">{name}</p>
              <p className="text-[10.5px] truncate leading-tight" style={{ color: 'rgba(255,255,255,0.45)' }}>{email}</p>
            </div>
            <ChevronDown size={13} style={{ color: 'rgba(255,255,255,0.45)' }} />
          </>
        )}
      </button>
    </div>
  );
}

export function AppShell({ role, children }: { role: BaseRole; children: React.ReactNode }) {
  const pathname = usePathname();
  const visible = NAV.filter(item => canAccess(role, item.href));
  const [collapsed, setCollapsed] = useState(false);
  // On phones the sidebar is an off-canvas drawer rather than a fixed column —
  // a 232px rail on a 375px screen leaves no room for the actual page.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [me, setMe] = useState<{ name: string; email: string } | null>(null);

  // Unread badge on Messages. Polled rather than fetched once, so a message
  // that arrives while someone is on another page still shows up — previously
  // there was no way to know you had mail without opening Messages and reading
  // every thread. Only asked for by roles that actually have the page.
  const canMessage = visible.some(item => item.href === '/app/messaging');
  const { data: unreadData } = useApi<{ unread: number }>(
    canMessage ? '/threads/unread-count' : null,
    { refreshInterval: 60_000, dedupingInterval: 15_000 },
  );
  const unread = unreadData?.unread ?? 0;

  useEffect(() => {
    const stored = localStorage.getItem('sidebar-collapsed');
    if (stored === '1') setCollapsed(true);
  }, []);

  // Navigating closes the mobile drawer so the page you tapped to isn't left
  // hidden behind it.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    const token = document.cookie.match(/access_token=([^;]+)/)?.[1];
    apiFetch<{ user: { name: string; email: string } }>('/auth/me', { token })
      .then(r => setMe({ name: r.user.name, email: r.user.email }))
      .catch(() => {});
  }, []);

  function toggleCollapsed() {
    setCollapsed(c => {
      localStorage.setItem('sidebar-collapsed', !c ? '1' : '0');
      return !c;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Backdrop — only on mobile when the drawer is open; tap to dismiss. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
      )}

      {/* Sidebar — a static column from md up, an off-canvas drawer below it. */}
      <aside className={`fixed md:static inset-y-0 left-0 z-40 w-[232px] flex flex-col shrink-0 border-r border-white/10 transition-[transform,width] duration-200
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        ${collapsed ? 'md:w-[68px]' : 'md:w-[232px]'}`}
        style={{ background: 'var(--sage-dk)' }}>

        {/* Logo */}
        <div className="px-4 pt-4 pb-3.5 border-b border-white/10">
          <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0 overflow-hidden p-1">
              <Image src="/logo-icon.png" alt="Music & Life" width={36} height={36}
                className="w-full h-full object-contain" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-white font-extrabold text-[15px] leading-tight tracking-tight">Music &amp; Life</p>
                <p className="text-[10px] font-semibold tracking-[0.14em] uppercase mt-px"
                  style={{ color: 'var(--sage-md)' }}>London</p>
              </div>
            )}
          </div>
        </div>

        {/* Role chip + collapse toggle */}
        <div className={`px-3 py-3 border-b border-white/10 flex items-center gap-2 ${collapsed ? 'flex-col' : 'justify-between px-5'}`}>
          {!collapsed && (
            <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
              {ROLE_LABELS[role] ?? role}
            </span>
          )}
          <button onClick={toggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden md:inline-flex shrink-0 p-1.5 rounded-lg transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.5)' }}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {GROUPS.map(group => {
            const items = group.items
              .map(l => visible.find(n => n.label === l))
              .filter(Boolean) as NavItem[];
            if (items.length === 0) return null;
            return (
              <div key={group.label}>
                {!collapsed && (
                  <p className="px-2.5 mb-2 text-[10px] font-bold uppercase tracking-[0.12em]"
                    style={{ color: 'rgba(255,255,255,0.28)' }}>
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {items.map(item => {
                    const active = pathname === item.href || (item.href !== '/app/dashboard' && pathname.startsWith(item.href));
                    return (
                      <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined}
                        onMouseEnter={() => prefetchRoute(item.href)}
                        className={`flex items-center gap-2.5 rounded-[9px] text-[13px] font-semibold transition-all
                          ${collapsed ? 'justify-center px-2 py-[9px]' : 'px-2.5 py-[7px]'}
                          ${active
                            ? 'text-white shadow-sm'
                            : 'hover:text-white hover:bg-white/10'
                          }`}
                        style={active ? { background: 'var(--sage)', color: 'white' } : { color: 'rgba(255,255,255,0.62)' }}>
                        <span className="shrink-0 relative">
                          {item.icon}
                          {item.href === '/app/messaging' && unread > 0 && collapsed && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[var(--sage)] ring-2 ring-[#2f3a34]" />
                          )}
                        </span>
                        {!collapsed && item.label}
                        {!collapsed && item.href === '/app/messaging' && unread > 0 && (
                          <span className="ml-auto min-w-[1.25rem] text-center text-[10.5px] font-bold rounded-full px-1.5 py-0.5"
                            style={{ background: active ? 'rgba(255,255,255,0.25)' : 'var(--sage)', color: 'white' }}>
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User menu / footer */}
        <UserMenu collapsed={collapsed} name={me?.name ?? '…'} email={me?.email ?? ''} />
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar — the only way to reach the drawer on a phone. */}
        <div className="md:hidden flex items-center gap-3 h-14 px-4 border-b border-white/10 shrink-0"
          style={{ background: 'var(--sage-dk)' }}>
          <button onClick={() => setMobileOpen(true)} aria-label="Open menu"
            className="-ml-1.5 p-1.5 rounded-lg text-white transition-colors hover:bg-white/10">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center shrink-0 overflow-hidden p-0.5">
              <Image src="/logo-icon.png" alt="Music & Life" width={24} height={24} className="w-full h-full object-contain" />
            </div>
            <span className="text-white font-extrabold text-sm truncate">Music &amp; Life</span>
          </div>
          <div className="ml-auto text-white">
            <NotificationBell />
          </div>
        </div>
        {/* Desktop top bar — just the bell, so it's reachable without a persistent header eating space. */}
        <div className="hidden md:flex items-center justify-end h-12 px-6 border-b shrink-0" style={{ borderColor: 'var(--bd)' }}>
          <NotificationBell />
        </div>
        {/* The calendar wants to fill the whole screen edge-to-edge with its own
            single scroll region, not sit padded inside another scrolling
            container — a scrollable card inside a scrollable page reads as a
            cramped "rectangle", not a real calendar. Every other page keeps the
            standard padded/scrolling frame. */}
        {pathname === '/app/calendar' ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {children}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 md:p-7">
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
