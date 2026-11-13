# LoL 1v1 Draft Strategy Board

A real-time multiplayer drafting simulator for League of Legends. Two authenticated players compete in a 1v1 draft following official LoL drafting rules, with Bo1/Bo3/Bo5 series formats, an optional **Fearless Drafting** mode, and link-based public viewing for spectators.

## Features

- **Real-time 1v1 drafting** — WebSocket-synchronized ban/pick phases with a lock mechanism and 30-second auto-commit timer
- **Official draft rules** — full LoL draft sequence (Ban Phase 1 → Pick 1 → Ban Phase 2 → Pick 2 → Finalization)
- **Series formats** — Bo1 / Bo3 / Bo5 with ban carry-over options
- **Fearless Drafting mode** — optional pre-draft toggle that permanently locks picks against later bans
- **Public viewing** — link-based spectator access without authentication, with reconnection grace period
- **Champion data** — Riot Games Datastore API v4, cached in Redis

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (React 18, TypeScript), Socket.IO client |
| Backend | NestJS 10 (TypeScript), Socket.IO server, JWT auth |
| Database | PostgreSQL 15 (Prisma ORM) |
| Cache / state | Redis 7 (session state, Riot API cache) |
| Deployment | Docker Compose (local-first) |

## Quickstart

Prerequisites: Docker with the Compose plugin.

```bash
# 1. Configure environment
cp .env.example .env
# then edit .env and set JWT_SECRET, e.g.: openssl rand -hex 32

# 2. Build and start all services
docker compose up -d --build

# 3. Verify
curl http://localhost:4000/health   # api health check
open http://localhost:3000          # web
```

## Services

| Service | Port | Role |
|---|---|---|
| `web` | 3000 | Next.js frontend (standalone build) |
| `api` | 4000 | NestJS API + Socket.IO server |
| `db` | 5432 | PostgreSQL 15 — database `league_draft`, schema `draft_db` |
| `redis` | 6379 | Redis 7 (AOF persistence) |

## Repository Structure

```
frontend/    Next.js app (Dockerfile included)
backend/     NestJS app (Dockerfile included)
docker/      Docker Compose documentation
scripts/     init-db.sql — database bootstrap, mounted into postgres
openspec/    Planning artifacts: proposal, design, specs, tasks
```

## Status & Planning

Development is tracked with OpenSpec. See `openspec/changes/lol-draft-strategy-board/`:

- `proposal.md` — scope and product definition
- `design.md` — technical architecture (authoritative for services/ports)
- `specs/` — behavioral requirements
- `tasks.md` — task breakdown with progress

The stack currently boots a minimal app shell; features land as tasks complete.
