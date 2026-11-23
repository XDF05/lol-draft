/**
 * Browser origins allowed to call the local application.
 *
 * The API and Socket.IO gateway deliberately share this allowlist so the
 * HTTP and real-time trust boundaries cannot drift apart. The deployment is
 * local/private-only; exposing it publicly requires an explicit threat-model
 * change rather than an accidental wildcard origin.
 */
export const LOCAL_WEB_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
] as const;

/** CORS policy for HTTP participant and public endpoints. */
export const HTTP_CORS_OPTIONS = {
  origin: [...LOCAL_WEB_ORIGINS],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
} as const;

/** CORS policy for the Socket.IO transport. */
export const SOCKET_CORS_OPTIONS = {
  origin: [...LOCAL_WEB_ORIGINS],
  credentials: true,
  methods: ['GET', 'POST'],
} as const;
