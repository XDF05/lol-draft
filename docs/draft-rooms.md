# Draft Rooms

This document describes how draft rooms are created, joined, and shared in the LoL 1v1 Draft Strategy Board. It is written to match the implemented backend routes under `backend/src/draft/`.

## Base URL

All endpoints are served by the `api` service (NestJS) on port `4000`:

```
http://localhost:4000/draft/...
```

## Draft codes

A draft code is a **seven-character** identifier drawn from an unambiguous alphabet that excludes look-alike glyphs (`I`, `L`, `O`, `0`, `1`):

```
ABCDEFGHJKMNPQRSTUVWXYZ23456789
```

Codes are case-insensitive when shared and are normalized to uppercase on lookup. They are unguessable capability URLs — anyone with the code can view the draft publicly, so treat the code as sensitive and avoid logging it.

## Participant flow (authenticated)

All participant endpoints require a valid `Authorization: Bearer <access_token>` (see `docs/account-session.md` for authentication).

### Create a draft

**`POST /draft/create`**

Body:

| Field | Type | Constraints | Description |
|---|---|---|---|
| `side` | string | `BLUE` \| `RED`, optional (defaults to `BLUE`) | Side the creator claims for themselves |

Success (`201`):

```json
{
  "code": "K9M2P7Q",
  "status": "WAITING_FOR_PLAYERS",
  "message": "Draft created. Send this code to your opponent."
}
```

The creator is immediately assigned to the chosen side and the draft row is persisted as `WAITING_FOR_PLAYERS`. The creator should share the `code` with their opponent so the opponent can join.

Failure:

| Status | Condition |
|---|---|
| `401` | No or invalid bearer token |
| `400` | Invalid `side` value |

### Join a draft

**`POST /draft/:code/join`**

Body:

| Field | Type | Constraints | Description |
|---|---|---|---|
| `side` | string | `BLUE` \| `RED`, optional | Requested side; defaults to the only free side |

Success (`201`):

```json
{
  "draft": { "id": 1, "code": "K9M2P7Q", "status": "IN_PROGRESS", ... },
  "team": "RED",
  "started": true
}
```

- The caller claims the free side through a single atomic conditional `UPDATE`, so two simultaneous joiners can never both claim the same side — exactly one wins (`201`), the other receives `409`.
- When both sides are now occupied, the draft moves to `IN_PROGRESS` and turn 1 begins.
- If the caller already participates (page refresh / returning opponent), the re-join is idempotent: it returns their existing team with `started: false` and does not restart the draft.

Failure:

| Status | Condition |
|---|---|
| `401` | No or invalid bearer token |
| `404` | Draft code unknown or expired |
| `409` | Requested side already taken, draft not accepting players, or lost a side-claim race |

### Look up a draft (participant)

**`GET /draft/:code`** (authenticated)

Returns the draft view including both participants (or `null` for an unfilled side), status, and current turn. No pending (unlocked) selections are revealed to the opponent.

## Public spectator flow (no authentication)

**`GET /public/draft/:code`**

Any visitor with the draft code can open a read-only spectator view:

```json
{
  "code": "K9M2P7Q",
  "status": "COMPLETE",
  "completedAt": "2026-11-22T...",
  "bans": [ { "championId": "Ahri", "team": "BLUE", "phase": 1, "locked": true } ],
  "picks": [ { "id": 1, "championId": "Akali", "team": "BLUE", "locked": true } ],
  "turn": { ... }
}
```

- No authentication is required — the draft code in the URL is the only credential.
- Staged (pending) selections are stripped from public broadcasts, so spectators never see an in-progress selection before it is locked.
- Unknown or expired codes resolve to `404` without disclosing draft details.

## Code sharing

The draft code is the sharing mechanism:

1. The creator calls `POST /draft/create` and receives the `code`.
2. The creator sends the code to their opponent (any channel — the app only generates and returns it).
3. The opponent calls `POST /draft/<code>/join` and claims the remaining side.
4. Once both sides are occupied, the draft starts at turn 1 and both participants receive live updates over Socket.IO.

## Waiting draft cleanup

A draft that remains in `WAITING_FOR_PLAYERS` without a second participant for **five minutes** is removed (lazily on the next read, and by a background sweep). Stale codes then resolve to `404` (no information about the expired draft is leaked).

## Verification against the API routes

| Documented behavior | Implemented route / service | Match |
|---|---|---|
| Create a waiting draft, claim a side, 7-char code | `POST /draft/create`, `DraftService.create` | ✓ |
| Atomic free-side claim, no double-claim | `DraftService.join`, conditional `UPDATE` | ✓ |
| Draft starts at turn 1 when both sides filled | `DraftService.join` → `IN_PROGRESS`, `currentTurn: 1` | ✓ |
| Idempotent re-join | `DraftService.join` early-return for existing participants | ✓ |
| Side-claim race: exactly one winner | `DraftService.join` `updateMany` count check | ✓ |
| Participant draft lookup | `GET /draft/:code`, `DraftService.getByCode` | ✓ |
| Public spectator snapshot, no auth | `GET /public/draft/:code`, `PublicDraftController` | ✓ |
| Public state excludes pending selections | `publicBroadcastPayload` strips `pending` | ✓ |
| Unknown/expired code → 404 | `DraftNotFoundError` | ✓ |
| Waiting draft cleaned after 5 minutes | `WAITING_DRAFT_TTL_MS`, `DraftCleanupService`, lazy read cleanup | ✓ |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DRAFT_GRACE_PERIOD_MS` | `30000` | Reconnection grace period for in-progress drafts (ms) |
| `WAITING_DRAFT_TTL_MS` | `300000` (5 min) | Waiting draft cleanup TTL |
| `JWT_SECRET` | (required) | Access token secret, shared with authentication |

## Local verification

From a clean checkout, with Docker Compose running:

```bash
# 1. Register two participants
curl -X POST http://localhost:4000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"Password123!"}'

# 2. Alice logs in and creates a draft (claims BLUE)
ALICE_TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"Password123!"}' | jq -r '.access_token')
CODE=$(curl -s -X POST http://localhost:4000/draft/create \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d '{"side":"BLUE"}' | jq -r '.code')

# 3. Bob logs in and joins the remaining side (RED)
BOB_TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"bob","email":"bob@example.com","password":"Password123!"}' | jq -r '.access_token')
curl -s -X POST http://localhost:4000/draft/$CODE/join \
  -H "Authorization: Bearer $BOB_TOKEN" \
  -d '{"side":"RED"}'

# 4. Spectator views the draft without authenticating
curl -s http://localhost:4000/public/draft/$CODE | jq .
```
