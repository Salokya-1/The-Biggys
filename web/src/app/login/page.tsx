'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { homeFor, useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

const DEMO = [
  { label: 'RTE Admin', email: 'admin@demo' },
  { label: 'Module Leader', email: 'leader@demo' },
  { label: 'Lecturer', email: 'lecturer@demo' },
  { label: 'Student', email: 'student1@demo' },
];
const DEMO_PASSWORD = 'Demo1234!';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(email.trim(), password);
      router.replace(homeFor(user.role));
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Cannot reach the API. Is the server running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* A soft brand wash behind the card, so the page is not a form floating on flat grey. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-indigo/15 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-brand-blue/15 blur-3xl" />
      </div>

      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-3">
            <Image src="/brand/islington-logo.svg" alt="Islington College" width={170} height={40} priority className="h-10 w-auto dark:hidden" />
            <Image src="/brand/islington-logo-white.svg" alt="Islington College" width={170} height={40} priority className="hidden h-10 w-auto dark:block" />
            <span className="h-8 w-px shrink-0 bg-border" />
            <Image src="/brand/kramiq-square.png" alt="KramIQ by The Biggys" width={80} height={80} priority className="h-10 w-10 shrink-0" />
          </span>
          <ThemeToggle />
        </div>
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">Sign in to KramIQ</CardTitle>
            <CardDescription>Developed by The Biggys · Islington College</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Demo accounts</CardTitle>
            <CardDescription>Seeded, fictional data. Password for all: <code className="font-mono">{DEMO_PASSWORD}</code></CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {DEMO.map((d) => (
              <Button
                key={d.email}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEmail(d.email);
                  setPassword(DEMO_PASSWORD);
                  setError(null);
                }}
              >
                {d.label}
              </Button>
            ))}
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/" className="underline">Back to overview</Link>
        </p>
      </div>
    </main>
  );
}
