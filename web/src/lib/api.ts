import type { AuthUser, LoginResponse } from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
const STORAGE_KEY = 'biggys.auth';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

export function setTokens(tokens: Tokens | null) {
  try {
    if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

let refreshing: Promise<Tokens | null> | null = null;

/** Rotate the refresh token; concurrent callers share one in-flight request. */
async function refreshTokens(): Promise<Tokens | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const current = getTokens();
    if (!current) return null;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!res.ok) {
        setTokens(null);
        return null;
      }
      const data = (await res.json()) as LoginResponse;
      const next = { accessToken: data.accessToken, refreshToken: data.refreshToken };
      setTokens(next);
      return next;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  formData?: FormData;
}

export async function api<T>(path: string, opts: Options = {}, _retry = true): Promise<T> {
  const { method = 'GET', body, auth = true, formData } = opts;
  const headers: Record<string, string> = {};
  if (!formData) headers['content-type'] = 'application/json';
  if (auth) {
    const t = getTokens();
    if (t) headers.authorization = `Bearer ${t.accessToken}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    cache: 'no-store',
  });

  if (res.status === 401 && auth && _retry) {
    const next = await refreshTokens();
    if (next) return api<T>(path, opts, false);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  if (!res.ok) {
    throw new ApiError(
      (json?.message as string | undefined) ?? res.statusText ?? 'Request failed',
      res.status,
      json?.details,
    );
  }
  return json as T;
}

export const authApi = {
  async login(email: string, password: string): Promise<AuthUser> {
    const data = await api<LoginResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return data.user;
  },
  async logout() {
    const t = getTokens();
    setTokens(null);
    if (t) {
      try {
        await api('/auth/logout', { method: 'POST', body: { refreshToken: t.refreshToken }, auth: false });
      } catch {
        /* already gone */
      }
    }
  },
  me: () => api<AuthUser>('/auth/me'),
};

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === 'all') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
