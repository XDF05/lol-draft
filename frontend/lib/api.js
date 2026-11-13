import axios from 'axios';

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
 * Base URL: NEXT_PUBLIC_API_URL (set by docker-compose in production),
 * falling back to the local dev API port.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const AUTH_STORAGE_KEYS = {
  accessToken: 'auth_token',
  refreshToken: 'refresh_token',
};

/** localStorage-backed token storage (browser-only, SSR-safe). */
export const authStorage = {
  getAccessToken() {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  },
  getRefreshToken() {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken);
  },
  setTokens({ access_token, refresh_token }) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, access_token);
    if (refresh_token) {
      window.localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, refresh_token);
    }
  },
  clear() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(AUTH_STORAGE_KEYS.accessToken);
    window.localStorage.removeItem(AUTH_STORAGE_KEYS.refreshToken);
  },
};

// Callbacks wired by AuthProvider so interceptor reactions can update state.
let callbacks = {
  onTokensRefreshed: null,
  onAuthFailure: null,
};

export function configureAuthApi(next) {
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

const AUTH_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/refresh'];

function isAuthEndpoint(url) {
  return AUTH_ENDPOINTS.some((path) => (url || '').includes(path));
}

// Single-flight refresh: one /auth/refresh call per expired access token.
let refreshInFlight = null;

function rotateRefreshToken() {
  if (!refreshInFlight) {
    const refreshToken = authStorage.getRefreshToken();
    refreshInFlight = axios
      .post(`${API_URL}/auth/refresh`, { refresh_token: refreshToken })
      .then((res) => {
        authStorage.setTokens(res.data);
        if (callbacks.onTokensRefreshed) callbacks.onTokensRefreshed(res.data);
        return res.data;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

function handleAuthFailure() {
  authStorage.clear();
  if (callbacks.onAuthFailure) callbacks.onAuthFailure();
}

// --- Response interceptor: auto-refresh on 401, then retry once. ---
api.interceptors.response.use(
  null,
  async (error) => {
    const original = error.config;
    const status = error.response ? error.response.status : undefined;

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
          return Promise.reject(refreshError);
        }
      }

      handleAuthFailure();
    }

    return Promise.reject(error);
  },
);

export default api;
