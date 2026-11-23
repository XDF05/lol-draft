# Security Model and Deployment Assumptions

This document defines the trust boundary, secret handling, and deployment assumptions for the local League of Legends 1v1 Draft Strategy Board. It applies to the four Compose services in `docker-compose.yml` and the HTTP/Socket.IO API implemented under `backend/src/`.

## Scope and threat model

The application is designed for a **trusted local machine or private, operator-controlled host**. It is not a public multi-tenant service.

The Compose file publishes these ports on the loopback interface only:

| Service | Host binding | Purpose |
|---|---|---|
| `web` | `127.0.0.1:3000` | Next.js browser application |
| `api` | `127.0.0.1:4000` | NestJS HTTP and Socket.IO API |
| `db` | `127.0.0.1:5432` | PostgreSQL development access |
| `redis` | `127.0.0.1:6379` | Redis development access |

Containers communicate over the private `app-network`. CORS is an additional browser boundary, not a network firewall: non-browser clients can call the API directly. Do not expose these ports on `0.0.0.0`, a public interface, or an untrusted LAN without first applying TLS, authentication, network policy, and a revised threat model.

## Browser and API boundary

The HTTP API and Socket.IO gateway use the same exact browser-origin allowlist from `backend/src/common/config/cors.ts`:

- `http://localhost:3000`
- `http://127.0.0.1:3000`

A request from another origin receives no `Access-Control-Allow-Origin` header, so browser JavaScript cannot read the participant response. The policy is not a wildcard and does not use `null` or reflected origins.

### Public routes

These routes intentionally do not require an account:

| Route | Public data |
|---|---|
| `GET /health` | Service health |
| `GET /champions` | Public Data Dragon champion metadata |
| `GET /public/draft/:code` | Sanitized public draft state |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` | Authentication operations |

The champion pool contains no user data. A public draft snapshot contains the draft code, status, participants, locked bans/picks, and current turn, but never a staged/pending selection.

### Participant routes

Creating, joining, and looking up a participant draft requires `Authorization: Bearer <access_token>`. Socket.IO participant rooms additionally require a valid, non-revoked JWT during the handshake and require the authenticated user to be assigned to one of the two sides. Anonymous sockets can join only the separate read-only spectator room.

A draft code is the spectator capability. Treat it as sensitive even though it is intentionally visible to an invited spectator. The server redacts draft-code path segments from normal error responses and logs, and does not log staged selections.

## Secrets and environment configuration

### Required secrets

| Variable | Where it is used | Handling |
|---|---|---|
| `JWT_SECRET` | NestJS access-token signing/verification | Required. Use at least 32 random bytes, for example `openssl rand -hex 32`. Never commit it or bake it into an image. |
| `POSTGRES_PASSWORD` | PostgreSQL container and API `DATABASE_URL` | Use a URL-safe random string outside disposable local development. The Compose default `postgres` is development-only. |
| `DATABASE_URL` | Prisma/PostgreSQL | May contain the database password. Treat the whole value as secret and inject it at runtime. |

The root `.env.example` is a template only. The real `.env`, `backend/.env`, `frontend/.env.local`, and `*.env.*.local` files are ignored by Git and Docker build contexts.

No Riot developer API key is required. `DATA_DRAGON_BASE_URL` points to Riot's public Data Dragon CDN and is not a secret. `NEXT_PUBLIC_API_URL` is compiled into browser-visible configuration and must never contain a credential.

### Secret rules

1. Generate `JWT_SECRET` and `POSTGRES_PASSWORD` outside Git and store them in the untracked root `.env` file or a deployment secret manager.
2. Do not pass secrets as Docker build arguments or `ENV` instructions; Compose injects runtime environment values only.
3. Do not print tokens or request bodies in logs. Error paths drop query strings and redact draft-code segments.
4. Rotate `JWT_SECRET` by restarting the API and deleting Redis authentication keys. Rotation invalidates existing access tokens; deleting `auth:refresh:*` and `auth:revoked:*` also invalidates refresh sessions and logout revocations.
5. Back up the PostgreSQL volume before destructive maintenance. Passwords and tokens in it must remain protected.

## Session and abuse controls

- Passwords are hashed with bcrypt cost 12 and are never returned by the API.
- Access tokens expire after 15 minutes.
- Refresh tokens are opaque, Redis-backed, single-use values. Rotation uses atomic Redis `GETDEL`, so only one of two concurrent refresh requests succeeds.
- `POST /auth/logout` deletes the refresh token and blacklists the current access token until its natural expiry. The blacklist is checked by both HTTP and Socket.IO authentication.
- Login is limited to five attempts per client IP in a 60-second Redis window.
- DTO validation strips unknown fields and rejects malformed values. Database access is through Prisma's parameterized query API.
- The server, not the browser, validates room membership, side ownership, turn ownership, and champion availability.

## Logging and response minimization

Normal logs contain operational identifiers such as draft and user numeric IDs, but not:

- passwords or password hashes;
- access or refresh tokens;
- `JWT_SECRET` or database credentials;
- raw draft-code path segments;
- staged ban/pick selections.

Expected 4xx errors are logged as one-line warnings without stack traces. Unexpected 5xx errors retain a stack for local diagnosis. HTTP error bodies use the structured `{ statusCode, code, message, timestamp, path }` shape and never include a request body or token.

## Deployment assumptions

The current deployment has these deliberate constraints:

1. **One API replica.** Turn deadlines, action claims, and reconnection grace timers are process-local. Running multiple API replicas requires shared timer ownership and distributed coordination.
2. **Trusted host and browser origin.** Tokens are stored in browser `localStorage`; an XSS vulnerability in a trusted origin could expose them. Do not serve untrusted content from the same origin.
3. **PostgreSQL and Redis are trusted internal services.** They share the Compose network and have no application-level TLS/authentication inside that private network. Their host ports are loopback-only.
4. **TLS is terminated outside the Compose stack when needed.** A private-host deployment should use a trusted reverse proxy and only then broaden the CORS allowlist deliberately.
5. **Data Dragon is the only external data dependency.** Its outage makes the champion pool unavailable but does not expose internal state or bypass authentication.
6. **No secrets are embedded in frontend bundles.** Public environment variables are configuration, not credentials.

## Security verification

Run the same checks used during implementation:

```bash
cd backend
npm audit
npm run test:security
npm test -- --runInBand

cd ../frontend
npm audit
npm test -- --runInBand
npm run build

cd ..
docker compose config --quiet
```

The security suite covers the local-origin CORS boundary, public/participant route separation, JWT expiry and revocation, refresh replay/races, login rate limiting, logout, malformed input, SQL-injection-shaped input, HTTP and Socket.IO authentication bypass, state preservation after rejected requests, and log/response redaction.

## Reporting or rotating a compromised session

1. Ask the user to log out; this revokes the refresh token and current access token.
2. If the browser or host may be compromised, delete the affected browser storage and all `auth:refresh:*` / `auth:revoked:*` Redis keys.
3. Rotate `JWT_SECRET` to invalidate every outstanding access token.
4. Rotate `POSTGRES_PASSWORD` and update `DATABASE_URL` together when database credentials may have leaked.
5. Review application logs for unexpected authentication failures, but do not copy tokens or raw draft codes into an issue report.
