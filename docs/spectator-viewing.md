# Spectator Viewing

This document describes how drafts are shared and viewed publicly in the LoL 1v1 Draft Strategy Board. It is written to match the implemented backend routes under `backend/src/draft/` and the real-time events in `backend/src/draft-events/`.

## Sharing a draft link

A draft is shareable as soon as its creator calls `POST /draft/create`:

1. The creator calls `POST /draft/create` (authenticated) and receives a **seven-character draft code** (e.g. `K9M2P7Q`) in the response.
2. The creator sends that code to anyone they want to spectate — any channel works, since the code itself is the only credential required.
3. A spectator opens `http://localhost:3000/d/<code>` in the frontend, or calls `GET /public/draft/:code` on the API directly, without authenticating.

Because the draft code is unguessable and doubles as the access capability, treat it as sensitive: avoid logging it, and share it only with intended viewers.

## Public spectator access

### HTTP snapshot (no authentication)

**`GET /public/draft/:code`**

Any visitor with the draft code receives a read-only snapshot:

```json
{
  "id": 1,
  "code": "K9M2P7Q",
  "status": "COMPLETE",
  "currentTurn": 21,
  "bluePlayer": { "id": 10, "username": "alice" },
  "redPlayer": { "id": 11, "username": "bob" },
  "createdAt": "2026-11-22T...",
  "completedAt": "2026-11-22T...",
  "bans": [
    { "championId": "Ahri", "team": "BLUE", "phase": 1, "locked": true },
    { "championId": "Zed", "team": "RED", "phase": 2, "locked": true }
  ],
  "picks": [
    { "id": 1, "championId": "Akali", "team": "BLUE", "locked": true },
    { "id": 2, "championId": "Katarina", "team": "RED", "locked": true }
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

| Behavior | How it works |
|---|---|
| No authentication | The draft code in the URL is the only credential |
| Unknown code | Returns `404` without disclosing draft details |
| Expired draft | Returns `404` (expired drafts resolve to not found) |
| Completed draft | Returns the final result, including completion time |

### Socket.IO spectator room (live updates)

**`public.join`** → emits `{ ok: true, draftId, code, status }`

An anonymous socket connects to the API's Socket.IO server (default path `/socket.io`) and emits `public.join` with `{ draftCode: "K9M2P7Q" }`. No auth token is required.

Once joined, the spectator receives:
- `turn.start` — the current turn number, phase, and remaining seconds
- `draft.update` — the full public state, including locked bans/picks
- `draft.completed` — the final pick/ban order when the draft finishes

## What is public vs. private

| Public (visible to spectators) | Private (participants only) |
|---|---|
| Draft code, status, current turn | Staged (pending) ban/pick selections |
| Locked bans with champion, team, phase | The acting team's current pending pick |
| Locked picks with champion, team | Per-client connection/presence state |
| Participant usernames | Socket.io room membership |
| Completion time and final order | Draft code used as a sharing credential |

**Staged selections are never exposed publicly.** The server strips the `pending` map from every `draft.update` broadcast sent to the `draft:<id>:public` spectator room, so a spectator can never see a selection before the acting participant locks it.

## Spectator connection rules

| Rule | Reason |
|---|---|
| No user identity recorded | Spectators are anonymous; no account required |
| No presence tracking | A spectator disconnect cannot expire a draft (only participant disconnects start the grace period) |
| Independent reconnect | Spectators reconnect to their own broadcast room without affecting participant state |
| Read-only | Spectators cannot send ban/pick/select actions |

## Verification against the API routes

| Documented behavior | Implemented route / service | Match |
|---|---|---|
| Anonymous spectator joins via code | `public.join` (`PublicJoinDto`, `WsJwtGuard` allows token-less sockets) | ✓ |
| Public snapshot over HTTP | `GET /public/draft/:code`, `PublicDraftController.getByCode` | ✓ |
| Unknown code → 404, no details leaked | `DraftNotFoundError` | ✓ |
| Pending selections stripped publicly | `publicBroadcastPayload` removes `pending` from `draft.update` | ✓ |
| Separate spectator room | `publicDraftRoom` = `draft:<id>:public` | ✓ |
| Spectator disconnect cannot expire draft | No presence/grace timer for spectators | ✓ |

## Local verification

```bash
# 1. Create a draft as an authenticated participant (see docs/account-session.md and docs/draft-rooms.md)
ALICE_TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"Password123!"}' | jq -r '.access_token')
CODE=$(curl -s -X POST http://localhost:4000/draft/create \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d '{"side":"BLUE"}' | jq -r '.code')

# 2. A spectator views the draft without authenticating
curl -s http://localhost:4000/public/draft/$CODE | jq .

# 3. An unknown code resolves to 404
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/public/draft/NOPECODE   # 404

# 4. Open the spectator page in a browser
open http://localhost:3000/d/$CODE
```

## Related documents

- `docs/account-session.md` — authentication required for participant actions
- `docs/draft-rooms.md` — draft creation, code sharing, and side assignment
