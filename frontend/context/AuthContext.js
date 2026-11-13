'use client';

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import api, { authStorage, configureAuthApi } from '../lib/api';

/**
 * Global authentication state for the app.
 *
 * status: 'loading' | 'authenticated' | 'unauthenticated'
 *   - 'loading': initial page load while stored tokens are validated.
 *
 * Mounted once in the root layout; token storage lives in localStorage
 * (see lib/api.js) so a hard refresh restores the session via GET /auth/me,
 * transparently rotating the refresh token if the access token expired.
 */
export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

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
        const res = await api.get('/auth/me');
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

  const login = useCallback(async ({ username, password }) => {
    const res = await api.post('/auth/login', { username, password });
    authStorage.setTokens(res.data);
    const me = await api.get('/auth/me');
    setUser(me.data);
    setStatus('authenticated');
    return me.data;
  }, []);

  const logout = useCallback(() => {
    authStorage.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo(
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
