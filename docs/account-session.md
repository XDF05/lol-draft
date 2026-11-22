# Account & Session Behavior

This document describes how users register, authenticate, and maintain sessions in the LoL 1v1 Draft Strategy Board API. It is written to match the implemented backend routes under `backend/src/auth/`.

## Base URL

All endpoints are served by the `api` service (NestJS) on port `4000`:

```
http://localhost:4000/auth/...
```

## Endpoints

### Register a new account

**`POST /auth/register`**

Body:

| Field | Type | Constraints | Description |
|---|---|---|---|
| `username` | string | 3–32 chars, `^[a-zA-Z0-9_]+$` | Unique username |
| `email` | string | valid email | Unique email address |
| `password` | string | 8–128 chars | Plaintext password (hashed with bcrypt, cost 12) |

Success (`201`): returns the public user identity **without** the password hash:

```json
{
  "id": 1,
  "username": "alice",
  "email": "alice@example.com",
  "createdAt": "2026-11-22T..."
}
```

Failure:

| Status | Condition |
|---|---|
| `409` | Username or email already registered |
| `400` | Invalid request body (validation pipe) |

### Log in

**`POST /auth/login`** (rate-limited)

Body:

| Field | Type | Description |
|---|---|---|
| `username` | string | Registered username |
| `password` | string | Account password |

Success (`201`): returns a short-lived access token and a single-use refresh token:

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<opaque>",
  "expiresIn": 900
}
```

- Access token is a JWT signed with `JWT_SECRET`, expires after **15 minutes (900s)**.
- Refresh token is an opaque random value stored in Redis with a default **7-day TTL**; it is single-use and rotated on every refresh.
- Invalid username/password → `401` (no distinction is made, to avoid username enumeration).
- Rate limit: **5 attempts per 60-second window per client IP** → `429` ("Too many login attempts").

### Refresh an access token

**`POST /auth/refresh`**

Body:

| Field | Type | Description |
|---|---|---|
| `refresh_token` | string | Previously issued refresh token |

Success (`201`): invalidates the presented refresh token and returns a new access/refresh pair (rotation).

Failure:

| Status | Condition |
|---|---|
| `401` | Unknown, expired, or already-used refresh token |

### Get the current user

**`GET /auth/me`** (authenticated, bearer JWT)

Headers: `Authorization: Bearer <access_token>`

Success (`200`):

```json
{
  "id": 1,
  "username": "alice"
}
```

Failure:

| Status | Condition |
|---|---|
| `401` | Missing bearer token, malformed token, or expired token |

## Session lifecycle

1. A visitor registers via `POST /auth/register`; the password is stored only as a bcrypt hash (cost factor 12).
2. The visitor logs in via `POST /auth/login`; on success they receive an access token (15 min TTL) and a refresh token (7-day Redis TTL, single-use).
3. Authenticated participant routes (`GET /auth/me`, draft creation, draft actions) require a valid `Authorization: Bearer <jwt>` header.
4. When the access token expires, the client presents the refresh token to `POST /auth/refresh`, which rotates it: the old token is deleted from Redis and a new access/refresh pair is issued.
5. A reused or unknown refresh token is rejected with `401`.

## Verification against the API routes

The documented flows were verified against the implemented backend:

| Documented flow | Implemented route | Match |
|---|---|---|
| Register new account | `POST /auth/register` (`RegisterDto`) | ✓ |
| Duplicate identity rejection | `AuthService.register` throws `ConflictException` | ✓ |
| Login with password validation | `POST /auth/login` (`LoginDto`, `LoginRateLimitGuard`) | ✓ |
| 5-attempt/60s login rate limit | `LoginRateLimitGuard`, Redis `rate_limit:login:{ip}` | ✓ |
| JWT access token (15 min) | `AuthService.issueTokens`, `ACCESS_TOKEN_TTL_SECONDS = 900` | ✓ |
| Refresh token rotation (single-use) | `AuthService.refresh`, Redis `del` before reissue | ✓ |
| Public identity without hash | `toPublicUser` omits `passwordHash` | ✓ |
| Bearer-token participant guard | `JwtAuthGuard`, `GET /auth/me` | ✓ |
| Expired/malformed token rejection | `AuthService.verifyAccessToken` throws `UnauthorizedException` | ✓ |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | (required) | Secret used to sign/verify access tokens |
| `REFRESH_TOKEN_TTL_SECONDS` | `604800` (7 days) | Redis TTL for refresh tokens |
| `DATABASE_URL` | (required) | PostgreSQL connection string (Prisma) |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | Redis for refresh tokens and rate limits |
