# Proposal

## Why

The project needs a durable, testable specification for its real-time 1v1 draft flow. The application implementation now exists, but the original artifacts do not describe the delivered behavior in OpenSpec's required proposal and delta formats.

## What Changes

- Define the end-to-end authenticated 1v1 draft capability, including account registration and login, JWT session refresh, draft creation, side assignment, real-time ban/pick turns, timers, persistence, finalization, and public spectating.
- Define the champion-catalog behavior using Riot's public Data Dragon CDN, version-aware Redis caching, retry/backoff handling, and a clear unavailable state.
- Capture the implemented timeout behavior: a staged selection is locked at expiry, an unstaged pick turn selects the first available champion in alphabetical order, and an unstaged ban turn is skipped.
- Capture the implemented reconnection, room-switch state reset, public-state sanitization, cleanup, responsive interface, and persisted light/dark theme behaviors.
- Scope the initial release to one 1v1 draft. Bo3/Bo5 series management, ban carry-over, matchmaking, 5v5 drafting, and gameplay simulation are not part of this change.

## Capabilities

### New Capabilities

- `draft-system`: Defines authenticated two-player 1v1 draft sessions from account access through champion selection, finalization, persistence, and public viewing.

### Modified Capabilities

None. This is the project's first durable OpenSpec capability.

## Impact

- **Backend:** NestJS HTTP and Socket.IO APIs, JWT authentication, Redis-backed live sessions and champion caching, PostgreSQL draft history, Data Dragon integration, turn timers, cleanup, and error handling.
- **Frontend:** Next.js authentication and draft-room pages, participant and spectator socket clients, Zustand draft state, responsive champion board, loading/error feedback, and theme persistence.
- **Infrastructure:** Docker Compose services for the web app, API, PostgreSQL, and Redis; local-only CORS policy; environment configuration.
- **Operational work:** Automated tests, security hardening, production container hardening, CI/CD, and user/API documentation remain tracked implementation work before archive.
