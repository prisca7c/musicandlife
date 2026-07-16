'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Calendar, Users, Home,
  PoundSterling, ClipboardCheck, MessageSquare,
  FileText, BarChart3, Settings,
  Briefcase, CreditCard, UserCheck, BookOpen,
  Clock, History, ChevronLeft, ChevronRight, ChevronDown,
  LogOut, PanelLeftClose, PanelLeftOpen, Megaphone, CalendarClock,
} from 'lucide-react';
import type { BaseRole } from '@music-life/types';
import { apiFetch } from '@/lib/api';
import { prefetchRoute } from '@/lib/swr';

interface NavItem { label: string; href: string; roles: BaseRole[]; icon: React.ReactNode; }

const NAV: NavItem[] = [
  { label: 'Dashboard',    href: '/app/dashboard',         roles: ['system_admin','admin','manager','receptionist','teacher'], icon: <LayoutDashboard size={16} /> },
  { label: 'My lessons',   href: '/app/family/dashboard',  roles: ['guardian','student'],                                     icon: <LayoutDashboard size={16} /> },
  { label: 'Book lesson',  href: '/app/family/book',       roles: ['guardian','student'],                                     icon: <Clock size={16} /> },
  { label: 'History',      href: '/app/family/history',    roles: ['guardian','student'],                                     icon: <History size={16} /> },
  { label: 'Lesson notes', href: '/app/family/notes',      roles: ['guardian','student'],                                     icon: <BookOpen size={16} /> },
  { label: 'Calendar',     href: '/app/calendar',          roles: ['system_admin','admin','manager','receptionist','teacher'], icon: <Calendar size={16} /> },
  { label: 'Attendance',   href: '/app/attendance',        roles: ['system_admin','admin','manager','teacher'],               icon: <ClipboardCheck size={16} /> },
  { label: 'Reschedules',  href: '/app/reschedule-requests', roles: ['system_admin','admin','manager','receptionist','teacher'], icon: <CalendarClock size={16} /> },
  { label: 'My availability', href: '/app/availability',    roles: ['teacher'],                                                icon: <Clock size={16} /> },
  { label: 'Notes',        href: '/app/notes',             roles: ['system_admin','admin','manager','teacher'],               icon: <FileText size={16} /> },
  { label: 'Students',     href: '/app/students',          roles: ['system_admin','admin','manager','receptionist','teacher'], icon: <UserCheck size={16} /> },
  { label: 'Families',     href: '/app/families',          roles: ['system_admin','admin','manager','receptionist'],          icon: <Home size={16} /> },
  { label: 'Staff',        href: '/app/staff',             roles: ['system_admin','admin'],                                   icon: <Briefcase size={16} /> },
  { label: 'Payroll',      href: '/app/staff/payroll',     roles: ['system_admin','admin','manager'],                        icon: <PoundSterling size={16} /> },
  { label: 'Billing',      href: '/app/billing',           roles: ['system_admin','admin','manager','receptionist','guardian'], icon: <CreditCard size={16} /> },
  { label: 'Intake',       href: '/app/intake',            roles: ['system_admin','admin','manager','receptionist'],          icon: <ClipboardCheck size={16} /> },
  { label: 'Messages',     href: '/app/messaging',         roles: ['system_admin','admin','manager','teacher','guardian'],    icon: <MessageSquare size={16} /> },
  { label: 'Resources',    href: '/app/resources',         roles: ['system_admin','admin','manager','teacher','guardian','student'], icon: <FileText size={16} /> },
  { label: 'Content',      href: '/app/content',           roles: ['system_admin','admin','manager','teacher'],               icon: <BookOpen size={16} /> },
  { label: 'Studio News',  href: '/app/news',              roles: ['system_admin','admin'],                                   icon: <Megaphone size={16} /> },
  { label: 'Reports',      href: '/app/reports',           roles: ['system_admin','admin','manager'],                        icon: <BarChart3 size={16} /> },
  { label: 'Settings',     href: '/app/settings',          roles: ['system_admin','admin'],                                   icon: <Settings size={16} /> },
];

// Group nav sections
const GROUPS = [
  { label: 'Overview', items: ['Dashboard','My lessons','Book lesson','History','Lesson notes'] },
  { label: 'Studio',   items: ['Calendar','Attendance','Reschedules','My availability','Notes','Intake','Messages'] },
  { label: 'People',   items: ['Students','Families','Staff','Payroll'] },
  { label: 'Finance',  items: ['Billing'] },
  { label: 'Content',  items: ['Resources','Content','Studio News'] },
  { label: 'Admin',    items: ['Reports','Settings'] },
];

const ROLE_LABELS: Record<string, string> = {
  system_admin: 'System Admin', admin: 'Admin', manager: 'Manager',
  receptionist: 'Receptionist', teacher: 'Teacher', guardian: 'Parent / Guardian', student: 'Student',
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
  const router = useRouter();

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
    router.push('/login');
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
  const visible = NAV.filter(item => item.roles.includes(role));
  const [collapsed, setCollapsed] = useState(false);
  const [me, setMe] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('sidebar-collapsed');
    if (stored === '1') setCollapsed(true);
  }, []);

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
      {/* Sidebar */}
      <aside className={`flex flex-col shrink-0 border-r border-white/10 transition-[width] duration-200 ${collapsed ? 'w-[68px]' : 'w-[232px]'}`}
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
            className="shrink-0 p-1.5 rounded-lg transition-colors hover:bg-white/10"
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
                        <span className="shrink-0">{item.icon}</span>
                        {!collapsed && item.label}
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
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-7">
          {children}
        </div>
      </main>
    </div>
  );
}
