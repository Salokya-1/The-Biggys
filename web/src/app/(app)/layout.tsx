'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Armchair, BookOpen, Building2, CalendarDays, ClipboardCheck, GraduationCap, LayoutDashboard, LogOut, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ROLE_LABEL, useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'MODULE_LEADER'] },
  { href: '/students', label: 'Students', icon: Users, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { href: '/modules', label: 'Modules', icon: BookOpen, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { href: '/marksheets', label: 'Mark sheets', icon: ClipboardCheck, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { href: '/exams', label: 'Exams', icon: CalendarDays, roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { href: '/venues', label: 'Venues', icon: Building2, roles: ['ADMIN'] },
  { href: '/me', label: 'My results', icon: GraduationCap, roles: ['STUDENT'] },
  { href: '/me/exams', label: 'My exam seats', icon: Armchair, roles: ['STUDENT'] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen">
        <aside className="hidden w-60 border-r p-4 md:block">
          <Skeleton className="mb-6 h-6 w-32" />
          <Skeleton className="mb-2 h-8 w-full" />
          <Skeleton className="mb-2 h-8 w-full" />
        </aside>
        <main className="flex-1 p-6">
          <Skeleton className="mb-4 h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </main>
      </div>
    );
  }

  const items = NAV.filter((n) => n.roles.includes(user.role));

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
        <div className="border-b px-5 py-4">
          <Link href="/" className="block text-sm font-semibold tracking-tight">
            RTE IMS
          </Link>
          <p className="text-xs text-muted-foreground">Islington College</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {items.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + '/');
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
                )}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-4">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <Badge variant="secondary" className="mt-1">{ROLE_LABEL[user.role]}</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full justify-start"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-background px-4 py-3 md:hidden">
          <span className="text-sm font-semibold">RTE IMS</span>
          <div className="flex gap-2">
            {items.map((n) => (
              <Link key={n.href} href={n.href} className="text-sm underline-offset-4 hover:underline">
                {n.label}
              </Link>
            ))}
            <button className="text-sm text-muted-foreground" onClick={() => logout().then(() => router.replace('/login'))}>
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
