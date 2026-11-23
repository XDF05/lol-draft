# Troubleshooting

This guide covers the failures most often seen while running or using the
local stack. Each remedy is written against the current Compose services and
API routes.

## The draft code is rejected or not found

**Symptoms:** the room shows "Draft not found", the API returns `404` with
code `DRAFT_NOT_FOUND`, or the spectator page cannot load.

**Causes and remedies:**

1. **Typo or wrong code.** Draft codes are seven characters from an
   unambiguous alphabet. Lookup normalizes case, but the characters must
   match. Copy the code again from the waiting room.
2. **Waiting room expired.** A draft that stays in `WAITING_FOR_PLAYERS`
   without a second player for five minutes is deleted. Create a new draft.
3. **Draft expired.** A participant who stays disconnected for more than
   30 seconds expires an in-progress draft. Expired codes resolve as not
   found. Create a new draft.
4. **Draft was completed and the link no longer resolves.** Completed drafts
   are not removed by the cleanup sweep, so a completed link should keep
   working. If it returns `404`, check that the request is reaching the same
   database where the draft was played.
5. **Wrong environment.** A code created against one database does not exist
   in another. Check that both players and the API use the same Compose
   project and `DATABASE_URL`.

## The draft expired during play

**Symptom:** the room shows "This draft has expired" and no further actions
are accepted.

**Cause:** the server expires an in-progress draft when a participant's last
socket remains disconnected for more than 30 seconds. Spectator disconnects
do not cause this.

**Remedies:**

1. Reconnect the participant within 30 seconds; the server restores the
   current turn and the real remaining countdown.
2. If the window already passed, create a new draft.
3. For local testing only, shorten or lengthen the window with
   `DRAFT_GRACE_PERIOD_MS` in the root `.env`, then restart the API:
   ```bash
   docker compose up -d --force-recreate api
   ```

## The champion pool is unavailable

**Symptom:** the interface shows a champion-pool error, or
`GET /champions` returns `503` with code `CHAMPION_UNAVAILABLE`.

**Cause:** the catalog is not cached and Riot's Data Dragon CDN could not be
reached after the configured retries and timeout.

**Remedies:**

1. Check the API log for the Data Dragon failure:
   ```bash
   docker compose logs --tail=100 api
   ```
2. Verify outbound HTTPS access to `https://ddragon.leagueoflegends.com`.
   Corporate proxies, offline hosts, and DNS failures all produce this state.
3. Retry the endpoint after a short wait; the service caches the result once
   the CDN responds:
   ```bash
   curl -i http://127.0.0.1:4000/champions
   ```
4. If you intentionally use a mirror, set `DATA_DRAGON_BASE_URL` in `.env` to
   its base URL (without the `/api/versions.json` suffix) and restart the API.
5. A Redis outage can also remove the cached catalog. Check:
   ```bash
   docker compose exec redis redis-cli ping
   ```

Draft actions do not require the catalog on the server, but the browser needs
it to render the pool. An expired pick turn with no staged champion falls back
to a skip when the catalog is unavailable.

## Login or registration fails

| Response | Likely cause | Remedy |
|---|---|---|
| `409` on register | Username or email already exists | Choose a different identity or sign in. |
| `400` on register | Username/email/password failed validation | Use 3–32 letters, numbers, or underscores for the username, a valid email, and an 8–128 character password. |
| `401` on login | Wrong username or password | Retry with the correct credentials. The API does not reveal which field was wrong. |
| `429` on login | More than five attempts per client IP in 60 seconds | Wait for the window to pass, then retry. |
| `401` on an authenticated request | Access token expired or malformed | The frontend refreshes automatically. If refresh also fails, sign in again. |
| `401` on refresh | Refresh token unknown, expired, or already used | Sign in again; each refresh token is single-use. |
| All tokens rejected after a restart | `JWT_SECRET` changed or Redis auth keys were cleared | Sign in again. Keep the same `JWT_SECRET` across API restarts. |

If the frontend keeps returning to the login page, clear the browser's stored
`auth_token` and `refresh_token` values and sign in again. In development,
the API must allow the frontend origin: use `http://localhost:3000` or
`http://127.0.0.1:3000` in the browser.

## The socket disconnects or never connects

**Symptoms:** the connection indicator stays on "reconnecting", live updates
stop, or the browser console reports a Socket.IO connection error.

**Remedies:**

1. Confirm the API is healthy:
   ```bash
   curl http://127.0.0.1:4000/health
   ```
2. Confirm the browser's `NEXT_PUBLIC_API_URL` points at a reachable API. For
   a host-run frontend, use `http://localhost:4000`; for the Compose frontend,
   the compiled default is also `http://localhost:4000`.
3. Use an allowed browser origin. The API permits exactly
   `http://localhost:3000` and `http://127.0.0.1:3000`. Opening the frontend
   through another hostname or port makes CORS and Socket.IO handshakes fail.
4. If a reverse proxy sits in front of the API, enable WebSocket upgrade
   forwarding and keep the `/socket.io` path intact.
5. A participant who reconnects within 30 seconds keeps the draft; a longer
   outage expires it. The last confirmed board remains visible while the
   socket is down.

## The second player cannot join

**Symptom:** joining returns `409`, or the room says the draft already has two
players.

**Causes and remedies:**

- Both sides are already occupied. The room is not accepting a third player.
- A simultaneous join won the remaining side. Exactly one request succeeds;
  the other receives `409`.
- The draft is no longer `WAITING_FOR_PLAYERS` (it started or expired). Create
  a new draft.
- The joining user is already a participant. Re-opening the same room is
  idempotent and returns the existing side.

## A lock or swap is rejected

| Message | Cause |
|---|---|
| "Not your turn" | The action belongs to the opposing side or another turn. |
| "Current turn is a BAN turn" / "Current turn is a PICK turn" | The action type does not match the phase. |
| "Draft has not started yet" | The draft is still waiting or no longer in progress. |
| "Champion already banned" | The champion is already in the locked ban list. |
| "Champion already picked" / "Champion is banned" | The champion is unavailable for a pick. |
| "No pending ban selection to lock" / "No pending pick selection to lock" | Nothing was staged before locking. |
| "Turn already resolved" | The timer or another action already resolved the turn. |
| "Swaps are only available during Finalization" | The draft is not in the 60-second swap window. |
| "Can only swap picks within your own team" | A cross-side swap was attempted. |

The server validates all of these; refreshing does not bypass them.

## The Compose stack does not start

1. Check service state and the migration job first:
   ```bash
   docker compose ps
   docker compose logs migrate
   docker compose logs db
   docker compose logs api
   ```
2. `migrate` must exit with status `0` before `api` starts. A failed migration
   usually means PostgreSQL was not ready, `DATABASE_URL` is wrong, or the
   migrations folder is malformed. Verify locally:
   ```bash
   cd backend
   npm run db:check-migrations
   ```
3. If a host port is already in use, stop the conflicting process or change
   the loopback port mapping in `docker-compose.yml`.
4. If `JWT_SECRET` is empty, Compose interpolation leaves the API without a
   usable signing secret. Set it in the root `.env`.
5. If the database volume was created before a schema change, apply the
   migrations again by recreating the migration job:
   ```bash
   docker compose up -d --force-recreate migrate
   ```
6. As a last resort for a disposable local environment, remove the volumes and
   start from scratch:
   ```bash
   docker compose down -v
   docker compose up -d --build --wait
   ```
   This deletes local accounts, drafts, and Redis state.

## The documentation or CI check fails

Run the same checks locally:

```bash
node scripts/check-docs.mjs
cd backend && npm run lint && npm run format:check
cd ../frontend && npm run lint && npm run format:check
```

A documentation failure usually means a relative link points at a missing
file, a documented `npm run` script does not exist, or a documented local path
was renamed. See [`docs/ci.md`](ci.md) for the full CI job list.

## Related documents

- [`docs/local-development.md`](local-development.md) — startup and database
  initialization.
- [`docs/api.md`](api.md) — error codes and event contracts.
- [`docs/security.md`](security.md) — authentication, secrets, and deployment
  assumptions.
