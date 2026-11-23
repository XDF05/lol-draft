# HTTP and Socket.IO API Contracts

The API is a NestJS service on `http://localhost:4000` (Compose publishes it
on `127.0.0.1:4000`). Browser requests are limited to the local frontend
origins `http://localhost:3000` and `http://127.0.0.1:3000`. The Socket.IO
server uses the same origin policy and the default `/socket.io` path.

The canonical TypeScript definitions live in
`backend/src/draft-events/socket-events.ts` and
`backend/src/draft/draft.types.ts`; the browser mirror is
`frontend/lib/socket.ts`.

## Authentication

Participant HTTP routes require:

```http
Authorization: Bearer <access_token>
```

Access tokens are JWTs valid for 15 minutes. Refresh tokens are opaque,
single-use Redis values valid for seven days by default. Refresh rotates the
pair; the old refresh token cannot be reused.

Participant sockets pass the same access token in the Socket.IO handshake:

```js
io('http://localhost:4000', { auth: { token: accessToken } });
```

A token-less socket is accepted as a read-only spectator and can use
`public.join` / `public.leave` (plus `health.ping`). Participant events such as
`draft.join` and the ban/pick handlers require an authenticated socket. A
socket that presents a malformed or expired token receives `auth.error` and is
disconnected.

## HTTP endpoints

### `GET /health`

Public. Returns:

```json
{ "status": "ok", "uptime": 12.34 }
```

### `GET /champions`

Public. Returns the current Data Dragon catalog:

```json
{
  "count": 1,
  "data": [
    {
      "id": "Ahri",
      "name": "Ahri",
      "iconUrl": "https://ddragon.leagueoflegends.com/cdn/14.1.1/img/champion/Ahri.png"
    }
  ]
}
```

`503 CHAMPION_UNAVAILABLE` means neither Redis nor the CDN could serve the
catalog after retries.

### `POST /auth/register`

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "Password123!"
}
```

`201` returns `{ id, username, email, createdAt }` without the password hash.
`400 VALIDATION_ERROR` for invalid fields; `409 CONFLICT` for a duplicate
username or email.

### `POST /auth/login`

```json
{ "username": "alice", "password": "Password123!" }
```

`201`:

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<opaque>",
  "expiresIn": 900
}
```

`401 UNAUTHORIZED` for bad credentials; `429 RATE_LIMITED` after five attempts
from one client IP in 60 seconds.

### `POST /auth/refresh`

```json
{ "refresh_token": "<opaque>" }
```

`201` returns a new `{ access_token, refresh_token, expiresIn }` pair. The
presented refresh token is invalidated. `401 UNAUTHORIZED` for an unknown,
expired, or already-used token.

### `POST /auth/logout`

```json
{ "refresh_token": "<opaque>" }
```

`204 No Content`. The refresh token is deleted; when an `Authorization`
bearer token is also supplied, it is blacklisted until its natural expiry.

### `GET /auth/me`

Authenticated. Returns:

```json
{ "id": 1, "username": "alice" }
```

### `POST /draft/create`

Authenticated.

```json
{ "side": "BLUE" }
```

`side` is optional and defaults to `BLUE`. `201`:

```json
{
  "code": "K9M2P7Q",
  "status": "WAITING_FOR_PLAYERS",
  "message": "Draft created. Send this code to your opponent."
}
```

The creator is assigned to the chosen side. Codes are seven characters from
the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.

### `POST /draft/:code/join`

Authenticated. `side` is optional; the server defaults to the only free side.

```json
{ "side": "RED" }
```

`201`:

```json
{
  "draft": {
    "id": 1,
    "code": "K9M2P7Q",
    "status": "IN_PROGRESS",
    "currentTurn": 1,
    "bluePlayer": { "id": 1, "username": "alice" },
    "redPlayer": { "id": 2, "username": "bob" },
    "createdAt": "2026-11-23T12:00:00.000Z"
  },
  "team": "RED",
  "started": true
}
```

The side claim is an atomic conditional update. When both sides are filled,
the draft moves to `IN_PROGRESS` and turn 1 starts. Re-joining as an existing
participant is idempotent and returns `started: false`.

Errors: `404 DRAFT_NOT_FOUND` for an unknown/expired code; `409 CONFLICT` when
the side is taken, the draft is no longer waiting, or the caller lost a claim
race.

### `GET /draft/:code`

Authenticated participant view. Returns the same `DraftView` object shown
above (without the join wrapper). Staged selections are not included.

### `GET /public/draft/:code`

Public, no authentication. Returns the public snapshot:

```json
{
  "id": 1,
  "code": "K9M2P7Q",
  "status": "COMPLETE",
  "currentTurn": 21,
  "bluePlayer": { "id": 1, "username": "alice" },
  "redPlayer": { "id": 2, "username": "bob" },
  "createdAt": "2026-11-23T12:00:00.000Z",
  "completedAt": "2026-11-23T12:02:00.000Z",
  "bans": [
    { "championId": "Ahri", "team": "BLUE", "phase": 1, "locked": true }
  ],
  "picks": [
    { "id": 1, "championId": "Akali", "team": "BLUE", "locked": true }
  ],
  "turn": {
    "turnNumber": 21,
    "phase": "FINALIZATION",
    "actionType": "FINALIZATION",
    "expectedTeam": null,
    "timerSeconds": 60
  }
}
```

The response never contains a `pending` map or an unlocked selection. Unknown
or expired codes return `404 DRAFT_NOT_FOUND` without draft details.

## HTTP error shape

Every HTTP error is rendered by
`backend/src/common/filters/draft-http-exception.filter.ts`:

```json
{
  "statusCode": 409,
  "code": "CONFLICT",
  "message": "The RED side is already taken",
  "timestamp": "2026-11-23T12:00:00.000Z",
  "path": "/draft/K9M2P7Q/join"
}
```

| Code | Typical status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | DTO validation failed. |
| `UNAUTHORIZED` | 401 | Missing, malformed, expired, or revoked bearer token. |
| `FORBIDDEN` | 403 | Authenticated but not allowed. |
| `DRAFT_NOT_FOUND` | 404 | Unknown, expired, or cleaned-up draft code. |
| `NOT_FOUND` | 404 | Unknown route. |
| `CONFLICT` | 409 | Side already taken, draft not accepting players, duplicate identity. |
| `RATE_LIMITED` | 429 | Login attempt limit exceeded. |
| `CHAMPION_UNAVAILABLE` | 503 | Champion catalog unavailable. |
| `INTERNAL_ERROR` | 500 | Unexpected server failure. |

Draft-code path segments are redacted in error responses and logs.

## Socket.IO events

### Handshake and connection events

| Event | Direction | Payload |
|---|---|---|
| `connection.ready` | server → client | `{ authenticated: boolean }` |
| `auth.error` | server → client | `{ message: string }`; the socket is disconnected |
| `exception` | server → client | `{ status: 'error', message: string }` for handler failures |

Acknowledgements are returned only for successful handler calls. A failed
handler emits `exception` instead, so clients should use an acknowledgement
timeout and listen for `exception`.

### Participant room

| Event | Direction | Payload / acknowledgement |
|---|---|---|
| `draft.join` | client → server | `{ code: string, team?: 'BLUE' \| 'RED' }` → `{ ok: true, draftId, team, room }` |
| `draft.leave` | client → server | no payload → `{ ok: true }` |
| `ban.select` | client → server | `{ championId?: string \| null }` → `{ ok: true, championId }` |
| `ban.lock` | client → server | no payload → `{ ok: true, championId }` |
| `ban.skip` | client → server | `{}` → `{ ok: true }` |
| `pick.select` | client → server | `{ championId?: string \| null }` → `{ ok: true, championId }` |
| `pick.lock` | client → server | no payload → `{ ok: true, championId }` |
| `pick.skip` | client → server | `{}` → `{ ok: true }` |
| `pick.swap` | client → server | `{ fromPickId: number, toPickId: number }` → `{ ok: true, picks }` |
| `health.ping` | client → server | `{ sentAt?: number }` → `{ ok: true, serverTime, latencyMs }` |

`ban.select` / `pick.select` stage a private selection; `null` clears it.
The staged value is returned only on the targeted `draft.pending` event and
is never included in a room-wide `draft.update`. `lock` confirms the staged
champion. `skip` resolves the turn without a selection. `pick.swap` is valid
only during Finalization and only for two locked picks on the caller's own
side.

### Public spectator room

| Event | Direction | Payload / acknowledgement |
|---|---|---|
| `public.join` | client → server | `{ draftCode: string }` → `{ ok: true, draftId, code, status }` |
| `public.leave` | client → server | no payload → `{ ok: true }` |

The joining spectator immediately receives the current `turn.start` and
`draft.update`, plus `draft.completed` when the draft is already complete.

### Server broadcasts

| Event | Payload |
|---|---|
| `turn.start` | `{ turnNumber, phase, actionType, expectedTeam, timerSeconds, remainingSeconds? }` |
| `turn.end` | next turn number |
| `draft.update` | `{ draftId, code, status, currentTurn, bans, picks, pending, skips, updatedAt }`; `pending` is always `{}` in room-wide broadcasts |
| `draft.pending` | targeted to the owning participant: `{ draftId, team, pending }`; `pending` is the staged selection or `null` |
| `ban.confirmed` | `{ championId, team, phase, bans }` |
| `pick.confirmed` | `{ championId, team, picks }` |
| `pick.reordered` | `{ picks }` |
| `timer.warning` | `{ seconds: 5 \| 3 \| 1, turn }` |
| `timer.expired` | `{ autoLockedChampionId: string \| null }` |
| `phase.ban1.start`, `phase.pick1.start`, `phase.ban2.start`, `phase.pick2.start`, `phase.finalization.start` | `{}` |
| `draft.completed` | `{ draftId, code, completedAt, picks, bans }` |
| `draft.expired` | `{ reason }` |

Both participant and public `draft.update` broadcasts are sanitized: the
`pending` map is replaced with `{}` before the event reaches either room.
Staged state is delivered only through the targeted `draft.pending` event to
the participant socket that owns it, including when that participant
reconnects.

## Draft schedule

| Turns | Phase | Order | Timer |
|---|---|---|---|
| 1–6 | `BANNING_P1` | Blue, Red, Blue, Red, Blue, Red | 30s |
| 7–12 | `PICKING_P1` | Blue, Red, Red, Blue, Blue, Red | 30s |
| 13–16 | `BANNING_P2` | Red, Blue, Red, Blue | 30s |
| 17–20 | `PICKING_P2` | Red, Blue, Blue, Red | 30s |
| 21 | `FINALIZATION` | neither side acts | 60s |

Timeout resolution: a staged selection is locked; an unstaged pick locks the
first available champion in case-insensitive alphabetical order; an unstaged
ban is skipped; Finalization expiry completes the draft.

## Related documents

- [`docs/account-session.md`](account-session.md) — authentication flows.
- [`docs/draft-rooms.md`](draft-rooms.md) — draft creation and joining.
- [`docs/spectator-viewing.md`](spectator-viewing.md) — public viewing.
- [`docs/troubleshooting.md`](troubleshooting.md) — error remedies.
