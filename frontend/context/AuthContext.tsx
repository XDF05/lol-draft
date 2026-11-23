'use client';

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import api, {
  authStorage,
  configureAuthApi,
  type AuthTokens,
} from '../lib/api';
import { closeDraftSocket } from '../lib/socket';

export interface AuthUser {
  id: number;
  username: string;
  email?: string;
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

/**
 * Global authentication state for the app.
 *
 * status: 'loading' | 'authenticated' | 'unauthenticated'
 *   - 'loading': initial page load while stored tokens are validated.
 *
 * Mounted once in the root layout; token storage lives in localStorage
 * (see lib/api.ts) so a hard refresh restores the session via GET /auth/me,
 * transparently rotating the refresh token if the access token expired.
 */
export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // React to interceptor-driven auth changes (auto-refresh / hard failure).
  useEffect(() => {
    configureAuthApi({
      onAuthFailure: () => {
        setUser(null);
        setStatus('unauthenticated');
      },
    });
  }, []);

  // Validate any stored tokens on first load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!authStorage.getAccessToken()) {
        setStatus('unauthenticated');
        return;
      }
      try {
        const res = await api.get<AuthUser>('/auth/me');
        if (!cancelled) {
          setUser(res.data);
          setStatus('authenticated');
        }
      } catch {
        // Token unusable (and refresh failed): interceptor already cleared.
        if (!cancelled) {
          setUser(null);
          setStatus('unauthenticated');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    const res = await api.post<AuthTokens>('/auth/login', credentials);
    authStorage.setTokens(res.data);
    const me = await api.get<AuthUser>('/auth/me');
    setUser(me.data);
    setStatus('authenticated');
    return me.data;
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = authStorage.getRefreshToken();
    try {
      if (refreshToken) {
        // Revoke the server-side refresh token and the current access token.
        await api.post('/auth/logout', { refresh_token: refreshToken });
      }
    } finally {
      // Local state is cleared even if the API is temporarily unavailable.
      closeDraftSocket();
      authStorage.clear();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated',
      login,
      logout,
    }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
