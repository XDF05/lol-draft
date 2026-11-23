import axios, { AxiosError } from 'axios';

/**
 * Central HTTP client for the NestJS API.
 *
 * - Attaches the JWT access token (localStorage) to every request.
 * - On a 401 response, rotates the refresh token via POST /auth/refresh
 *   (single-flight: concurrent 401s share one rotation call) and retries
 *   the original request exactly once.
 * - If the session cannot be recovered, clears stored tokens and notifies
 *   the auth context through configureAuthApi().
 *
 * Base URL: NEXT_PUBLIC_API_URL, inlined at build time (Compose passes
 * http://localhost:4000), falling back to the local dev API port.
 */

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const AUTH_STORAGE_KEYS = {
  accessToken: 'auth_token',
  refreshToken: 'refresh_token',
} as const;

/** localStorage-backed token storage (browser-only, SSR-safe). */
export const authStorage = {
  getAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  },
  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken);
  },
  setTokens({ access_token, refresh_token }: AuthTokens): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, access_token);
    if (refresh_token) {
      window.localStorage.setItem(
        AUTH_STORAGE_KEYS.refreshToken,
        refresh_token,
      );
    }
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(AUTH_STORAGE_KEYS.accessToken);
    window.localStorage.removeItem(AUTH_STORAGE_KEYS.refreshToken);
  },
};

// Callbacks wired by AuthProvider so interceptor reactions can update state.
interface AuthCallbacks {
  onTokensRefreshed: ((tokens: AuthTokens) => void) | null;
  onAuthFailure: (() => void) | null;
}

let callbacks: AuthCallbacks = {
  onTokensRefreshed: null,
  onAuthFailure: null,
};

export function configureAuthApi(next: Partial<AuthCallbacks>): void {
  callbacks = { ...callbacks, ...next };
}

const api = axios.create({ baseURL: API_URL });

// --- Request interceptor: attach the current access token. ---
api.interceptors.request.use((config) => {
  const token = authStorage.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const AUTH_ENDPOINTS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
];

function isAuthEndpoint(url: string | undefined): boolean {
  return AUTH_ENDPOINTS.some((path) => (url ?? '').includes(path));
}

// Single-flight refresh: one /auth/refresh call per expired access token.
let refreshInFlight: Promise<AuthTokens> | null = null;

function rotateRefreshToken(): Promise<AuthTokens> {
  if (!refreshInFlight) {
    const refreshToken = authStorage.getRefreshToken();
    refreshInFlight = axios
      .post<AuthTokens>(`${API_URL}/auth/refresh`, {
        refresh_token: refreshToken,
      })
      .then((res) => {
        const tokens = res.data;
        authStorage.setTokens(tokens);
        if (callbacks.onTokensRefreshed) callbacks.onTokensRefreshed(tokens);
        return tokens;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

function handleAuthFailure(): void {
  authStorage.clear();
  if (callbacks.onAuthFailure) callbacks.onAuthFailure();
}

// --- Response interceptor: auto-refresh on 401, then retry once. ---
api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config;
  const status = error.response?.status;

  if (
    status === 401 &&
    original &&
    !original._retry &&
    !isAuthEndpoint(original.url)
  ) {
    original._retry = true;

    if (authStorage.getRefreshToken()) {
      try {
        await rotateRefreshToken();
        // The request interceptor re-attaches the fresh token on retry.
        return api.request(original);
      } catch (refreshError) {
        handleAuthFailure();
        throw refreshError;
      }
    }

    handleAuthFailure();
  }

  throw error;
});

export default api;
