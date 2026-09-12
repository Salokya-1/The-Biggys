'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Light ⇄ dark switch. The first visit follows the device setting; a click pins the choice
 * (persisted by next-themes in localStorage). Icons are swapped by CSS so server and client
 * render the same markup and there is no hydration mismatch.
 */
export function ThemeToggle({ className, inverse }: { className?: string; inverse?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const toggle = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label="Switch between light and dark mode"
      title="Switch light / dark"
      className={cn(inverse && 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground', className)}
      onClick={toggle}
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
      <span className="ml-2 text-xs">
        <span className="dark:hidden">Dark mode</span>
        <span className="hidden dark:inline">Light mode</span>
      </span>
    </Button>
  );
}
