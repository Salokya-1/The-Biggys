'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Armchair, BookOpen, Building2, CalendarDays, CalendarClock, ClipboardCheck, GraduationCap, Inbox, LayoutDashboard, LogOut, Receipt, ShieldCheck, Sun, TriangleAlert, Users, Video } from 'lucide-react';
import { Assistant } from '@/components/assistant';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { NotificationsBell } from '@/components/notifications';
import { ThemeToggle } from '@/components/theme-toggle';
import { ROLE_LABEL, useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
  /** Extra capability gate: the entry is hidden when the account lacks it. */
  needs?: string;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'MODULE_LEADER'] },
  { href: '/students', label: 'Students', icon: Users, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { href: '/modules', label: 'Modules', icon: BookOpen, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { href: '/marksheets', label: 'Mark sheets', icon: ClipboardCheck, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { href: '/timetable', label: 'Timetable', icon: CalendarClock, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER', 'STUDENT'] },
  { href: '/exams', label: 'Exams', icon: CalendarDays, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { href: '/requests', label: 'Requests', icon: Inbox, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER', 'STUDENT'] },
  { href: '/alerts', label: 'Class alerts', icon: TriangleAlert, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'], needs: 'timetable.read' },
  { href: '/teachers', label: 'Teachers', icon: GraduationCap, roles: ['ADMIN', 'MODULE_LEADER'], needs: 'timetable.read' },
  { href: '/venues', label: 'Rooms', icon: Building2, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'], needs: 'seating.read' },
  { href: '/camera', label: 'Camera access', icon: Video, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'], needs: 'camera.read' },
  { href: '/fees', label: 'Fees', icon: Receipt, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'], needs: 'fees.read' },
  { href: '/retakes', label: 'Retakes', icon: Sun, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'], needs: 'module.read' },
  { href: '/admin/users', label: 'Users', icon: ShieldCheck, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'], needs: 'users.manage' },
  { href: '/me', label: 'My results', icon: GraduationCap, roles: ['STUDENT'] },
  { href: '/me/exams', label: 'My exam seats', icon: Armchair, roles: ['STUDENT'] },
  { href: '/me/fees', label: 'Fees & admit card', icon: Receipt, roles: ['STUDENT'] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen">
        <aside className="hidden w-60 bg-sidebar p-4 md:block">
          <Skeleton className="mb-6 h-8 w-36 bg-sidebar-accent" />
          <Skeleton className="mb-2 h-8 w-full bg-sidebar-accent" />
          <Skeleton className="mb-2 h-8 w-full bg-sidebar-accent" />
        </aside>
        <main className="flex-1 p-6">
          <Skeleton className="mb-4 h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </main>
      </div>
    );
  }

  const items = NAV.filter((n) => n.roles.includes(user.role) && (!n.needs || can(n.needs)));

  return (
    // The rail is fixed: only the content column scrolls, so navigation stays put on a long page.
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="border-b border-sidebar-border px-5 py-5">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/brand/islington-logo-white.svg" alt="Islington College" width={210} height={49} priority className="h-12 w-auto shrink-0" />
            <span className="h-9 w-px shrink-0 bg-sidebar-border" />
            <Image src="/brand/kramiq-square.png" alt="KramIQ by The Biggys" width={96} height={96} priority className="h-11 w-11 shrink-0" />
          </Link>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-widest text-sidebar-foreground/70">KramIQ · RTE Management System</p>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((n) => {
            const active = pathname === n.href || (n.href !== '/me' && pathname.startsWith(n.href + '/'));
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-1 [&_button]:text-sidebar-foreground [&_button:hover]:bg-sidebar-accent [&_button:hover]:text-sidebar-accent-foreground">
            <NotificationsBell isStudent={user.role === 'STUDENT'} />
          </div>
          <ThemeToggle inverse className="w-full justify-start" />
          <div className="mt-3 px-2">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <Badge variant="outline" className="mt-1 border-sidebar-border text-sidebar-foreground">{ROLE_LABEL[user.role]}</Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex shrink-0 items-center justify-between gap-3 bg-sidebar px-4 py-2 text-sidebar-foreground md:hidden">
          <span className="flex items-center gap-2">
            <Image src="/brand/islington-logo-white.svg" alt="Islington College" width={160} height={37} className="h-9 w-auto" />
            <Image src="/brand/kramiq-square.png" alt="KramIQ" width={72} height={72} className="h-8 w-8" />
          </span>
          {/* One scrollable row rather than a wrapping block: on a narrow screen the wrapped list
              pushed the page content most of the way down the viewport. */}
          <div className="flex min-w-0 items-center gap-2">
            <nav className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {items.map((n) => {
                const active = pathname === n.href || (n.href !== '/me' && pathname.startsWith(n.href + '/'));
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={cn('shrink-0 rounded px-2 py-1 text-xs', active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/85')}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>
            <ThemeToggle inverse className="h-7 shrink-0 px-1 [&_span]:hidden" />
            <button className="shrink-0 text-xs opacity-80" onClick={() => logout().then(() => router.replace('/login'))}>
              Sign out
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
      <Assistant />
    </div>
  );
}
