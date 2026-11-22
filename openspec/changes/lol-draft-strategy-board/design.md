# Design

## Context

The repository contains a Next.js web application, a NestJS API and Socket.IO gateway, PostgreSQL persistence through Prisma, Redis for live session state and caching, and a Docker Compose runtime. See `proposal.md` for motivation and `specs/draft-system/spec.md` for the behavioral contract.

The implementation supports a single 1v1 draft, not Bo3/Bo5 series management. Champion metadata comes from Riot's public Data Dragon CDN and requires no developer API key. The local deployment permits browser origins on `localhost:3000` and `127.0.0.1:3000`.

## Goals / Non-Goals

**Goals:**

- Keep the server authoritative for turn ownership, legality, timers, and durable draft history.
- Give participants and spectators low-latency live updates without exposing staged selections.
- Recover an interrupted Redis session from PostgreSQL and reconnect an interrupted socket without resetting the active turn.
- Keep the behavior deployable as four local Compose services with no external service dependency other than Data Dragon.
- Make user-visible rules explicit and testable through the OpenSpec delta.

**Non-Goals:**

- Bo3/Bo5 series state, ban carry-over, match result tracking, or matchmaking.
- 5v5 drafting, role assignment, champion statistics, or gameplay simulation.
- Persistent spectator identities or spectator chat.
- A multi-node distributed timer or event-bus architecture.
- A production public cloud deployment; the current security boundary is local-only deployment.

## Decisions

### 1. Separate HTTP request/response operations from real-time events

Authentication, registration, draft creation, side claims, the Fearless toggle, and public snapshots use NestJS HTTP endpoints. Active draft actions, turn announcements, timer warnings, and live broadcasts use Socket.IO.

**Rationale:** HTTP is a natural fit for commands with durable outcomes and simple validation. Socket.IO is needed for server-push state changes and reconnection. Keeping the two transports explicit avoids multiplexing every operation through one protocol.

**Alternative considered:** A single WebSocket event API for the entire application. Rejected because it would complicate browser refresh, request error handling, and unauthenticated public snapshots without providing a useful benefit.

### 2. Use PostgreSQL for durable history and Redis for live session state

Prisma stores users, drafts, locked bans, locked picks, and refresh-token identifiers. Redis stores `draft:<id>:session`, including the current turn, pending selections, skip counts, and the live ban/pick history. A missing Redis session is rebuilt from the PostgreSQL draft, ban, and pick rows.

**Rationale:** The database provides transactional and durable history. Redis provides low-latency access to the small mutable state needed by every turn.

**Alternative considered:** PostgreSQL for every live state read. Rejected because it would add unnecessary database traffic and complicate timer-driven updates.

**Trade-off:** Redis session updates are read-modify-write JSON operations. This is acceptable for the fixed one-acting-team 1v1 model; a multi-node or multi-team implementation would require atomic operations or a stronger event/state model.

### 3. Use an explicit server-side turn schedule

A single schedule maps turns 1 through 21 to phase, action type, expected side, and duration:

| Turns | Phase | Order |
|---|---|---|
| 1-6 | Ban Phase 1 | Blue, Red, Blue, Red, Blue, Red |
| 7-12 | Pick Phase 1 | Blue, Red, Red, Blue, Blue, Red |
| 13-16 | Ban Phase 2 | Red, Blue, Red, Blue |
| 17-20 | Pick Phase 2 | Red, Blue, Blue, Red |
| 21 | Finalization | Neither side acts |

Action turns use 30 seconds. Finalization uses 60 seconds. The schedule is shared by timer advancement, public snapshots, and client phase rendering.

**Rationale:** One authoritative table prevents the server, participant UI, and spectator UI from disagreeing about turn order.

**Alternative considered:** Deriving turns from client-side counters. Rejected because clients could drift and would not be authoritative.

### 4. Resolve each turn with an exclusive action claim

A manual lock, voluntary skip, or timer expiry must claim the current turn before it mutates state. If persistence fails after the claim, the claim is released so the timer can resolve the turn. A lock racing the deadline is rejected.

**Rationale:** This prevents double advancement and duplicate locked rows.

**Alternative considered:** Relying only on Redis transaction timing or client button disabling. Rejected because neither prevents two server requests from resolving the same turn.

### 5. Keep timers deadline-based and resumable

Each armed timer stores an absolute deadline. Rejoining during the same turn retains that deadline and returns the remaining seconds. Warnings are emitted at 5, 3, and 1 seconds. A server restart can re-arm the current turn from the persisted turn number, though it cannot reconstruct the pre-restart remaining duration.

**Rationale:** Absolute deadlines prevent reconnects from granting extra time and keep the UI close to the server clock.

**Alternative considered:** Sending a new 30-second countdown on every reconnect. Rejected because it made reconnects exploitable.

**Trade-off:** The in-memory timer and exclusive-claim maps are process-local. A multi-instance deployment would require shared timer ownership and distributed coordination.

### 6. Make timeout resolution deterministic

At expiry, a staged champion is locked. If no champion is staged, a pick turn chooses the first available champion by case-insensitive alphabetical name; a ban turn is skipped. If the champion catalog is unavailable, the pick turn falls back to a skip.

**Rationale:** A timeout must advance the draft instead of leaving the session stalled. Alphabetical fallback is deterministic and easy for every client to understand.

**Alternative considered:** Let the turn remain unresolved. Rejected because one disconnected participant would block the entire draft.

### 7. Separate participant rooms from public spectator rooms

Participants join `draft:<id>`; spectators join `draft:<id>:public`. Public `draft.update` events are sanitized by removing the `pending` map. Spectators do not contribute participant presence and therefore cannot expire a draft.

**Rationale:** Physical room separation makes accidental disclosure harder and keeps spectator reconnects independent from player presence.

**Alternative considered:** Broadcast one snapshot to everyone and rely on clients to hide pending fields. Rejected because clients would still receive private state.

### 8. Resolve side claims atomically in PostgreSQL

The creator chooses Blue or Red when creating the draft. A joining user claims a side with a conditional update that succeeds only while that side is null and the draft is waiting. When both sides are occupied, a second conditional update moves the draft to `IN_PROGRESS` and starts turn 1.

**Rationale:** The conditional update prevents simultaneous joiners from claiming the same side.

**Alternative considered:** Read-then-write side assignment. Rejected because concurrent requests could both pass the read check.

### 9. Use Data Dragon with patch-aware Redis caching

`versions.json` is cached for one hour. The normalized champion payload has no TTL but records its patch, so it remains reusable while that patch is current and is refreshed after a patch change. Fetch attempts use per-request timeouts, three exponential-backoff retries, and a 30-second overall deadline.

**Rationale:** The public CDN needs no API key, and patch-aware caching avoids stale champion names or icons without fetching the full catalog on every request.

**Alternative considered:** The Riot developer API with a configured key. Rejected for the local-only product because it adds credential management while Data Dragon provides the required metadata.

### 10. Authenticate HTTP and participant sockets with the same JWT identity

Access tokens expire after 15 minutes. Refresh tokens are opaque Redis values with a seven-day default TTL and are single-use. HTTP requests use a bearer-token guard. Socket handshakes use the same access token; malformed or expired presented tokens are rejected. A socket with no token is allowed only as a spectator.

**Rationale:** One identity service keeps authorization consistent across transports while allowing read-only public access.

**Alternative considered:** Separate socket sessions and passwords. Rejected because it duplicates authentication state and complicates revocation.

### 11. Keep the frontend state server-driven

The participant client uses a Zustand store fed by Socket.IO events. Staged selections are mirrored locally after a successful acknowledgement, while confirmed bans, picks, turn changes, completion, and expiry come from server broadcasts. Changing rooms clears stale draft state before joining the new room.

**Rationale:** The client can respond immediately to its own selection without becoming the source of truth for legality or confirmed history.

**Alternative considered:** Compute the complete draft state in the browser. Rejected because it duplicates server rules and is vulnerable to drift.

### 12. Treat visual preferences as local client state

The application provides light and dark themes. An inline root-layout script applies a valid saved preference before first paint, and the React theme provider keeps the DOM and application state synchronized.

**Rationale:** Theme preference is local to a browser and has no server-side behavior.

**Alternative considered:** Server-stored user preferences. Rejected because authentication is not required for every page and the preference has no cross-device requirement.

### 13. Use local Docker Compose as the deployment boundary

The Compose stack contains Next.js, NestJS, PostgreSQL, and Redis services. CORS permits only the local web origins, and container configuration passes secrets through environment variables rather than image layers.

**Rationale:** The product is designed for a trusted local or private host and does not need a public ingress, Kubernetes manifests, or a managed database.

**Alternative considered:** A hosted cloud deployment. Deferred because it would require a different threat model, secret-management strategy, and operational model.

## Risks / Trade-offs

- **[No automated test suite exists]** → Add backend unit/integration tests, frontend component tests, and end-to-end draft tests before archive.
- **[Client and server ban availability can diverge]** → Keep the server rule authoritative and align the ban board so a normal draft permits counter-bans while Fearless mode rejects them.
- **[README and product claims still mention unsupported series formats and a developer API]** → Reconcile the documentation with Data Dragon and the single-draft scope.
- **[Process-local timers do not support multiple API replicas]** → Keep the deployment single-instance for now, or move timer ownership to a shared coordinator before scaling horizontally.
- **[Redis loss rebuilds history but not an exact in-flight deadline]** → Continue persisting the current turn and accept that a process restart re-arms that turn.
- **[The draft code is the spectator capability URL]** → Treat the code as sensitive, avoid logging it as a secret value, and document that public links expose public draft state.
- **[Completed drafts remain queryable by code]** → Retain this behavior for results access, while applying an explicit retention policy if the deployment is exposed beyond the local host.

## Migration Plan

1. Configure `JWT_SECRET`, PostgreSQL, Redis, and optional `DATA_DRAGON_BASE_URL` values from the provided environment templates.
2. Apply the Prisma migration and initialize the `draft_db` PostgreSQL schema.
3. Start PostgreSQL and Redis, then the API and web services through Docker Compose.
4. Verify the API health endpoint, champion catalog endpoint, registration/login flow, and a complete local draft before sharing a spectator link.
5. For rollback, stop the Compose services and restore the previous application revision; PostgreSQL schema changes remain forward-only in the initial migration and should be backed up before later schema upgrades.
