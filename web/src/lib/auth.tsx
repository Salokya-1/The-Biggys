'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, getTokens, setTokens } from './api';
import type { AuthUser } from './types';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_KEY = ['session'] as const;

async function loadSession(): Promise<AuthUser | null> {
  if (!getTokens()) return null;
  try {
    return await authApi.me();
  } catch {
    setTokens(null);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: SESSION_KEY, queryFn: loadSession, staleTime: Infinity, retry: false });

  const login = useCallback(
    async (email: string, password: string) => {
      const u = await authApi.login(email, password);
      qc.setQueryData(SESSION_KEY, u);
      return u;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    qc.setQueryData(SESSION_KEY, null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
  }, [qc]);

  const value = useMemo<AuthContextValue>(
    () => ({ user: session.data ?? null, loading: session.isPending, login, logout }),
    [session.data, session.isPending, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export const ROLE_LABEL: Record<AuthUser['role'], string> = {
  ADMIN: 'RTE Admin',
  MODULE_LEADER: 'Module Leader',
  LECTURER: 'Lecturer',
  STUDENT: 'Student',
};

export function homeFor(role: AuthUser['role']): string {
  return role === 'STUDENT' ? '/me' : '/dashboard';
}
