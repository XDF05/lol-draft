# Docker Configuration

This directory documents the containerized development environment for the LoL 1v1 Draft Strategy Board. The Compose file itself lives at the repository root: [`docker-compose.yml`](../docker-compose.yml).

## Services

| Service | Image / Build | Loopback port | Purpose |
|---------|---------------|---------------|---------|
| `web`   | `./frontend` (Next.js 16) | `127.0.0.1:3000` | Frontend UI |
| `api`   | `./backend` (NestJS 11)  | `127.0.0.1:4000` | REST API + Socket.IO |
| `db`    | `postgres:15-alpine`     | `127.0.0.1:5432` | Primary database (`league_draft`, schema `draft_db`) |
| `redis` | `redis:7-alpine`         | `127.0.0.1:6379` | Cache / pub-sub (AOF persistence enabled) |

All services are attached to a private bridge network, `app-network`. Published ports bind to loopback rather than every host interface.

Both application images use multi-stage Alpine Node 22 builds and run as the built-in non-root `node` user (UID 1000). The backend's `/app` tree is read-only to that user. The frontend permits writes only in `/app/.next/cache`, which Next.js uses for image-optimization cache entries.

## Volumes

- `pgdata` — PostgreSQL data directory (`/var/lib/postgresql/data`)
- `redisdata` — Redis data directory (`/data`)

`scripts/init-db.sql` is mounted into the Postgres container and runs on first initialization (creates the `draft_db` schema).

## Health checks

Compose health checks use each image's Node runtime and require no extra package:

- `api`: `GET http://127.0.0.1:4000/health`
- `web`: `GET http://127.0.0.1:3000/`
- `redis`: `redis-cli ping`
- `db`: the existing `pg_isready` check

`web` starts only after `api` is healthy. `api` starts only after PostgreSQL and Redis are healthy.

## Running

```bash
# 1. Create a local env file with strong secrets (the root .env is gitignored)
cp .env.example .env
sed -i 's/^JWT_SECRET=.*/JWT_SECRET='"$(openssl rand -hex 32)"'/' .env
sed -i 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD='"$(openssl rand -hex 24)"'/' .env

# 2. Build and start everything in the background
docker compose up -d --wait

# 3. Verify
docker compose ps
curl http://127.0.0.1:4000/health   # -> {"status":"ok"}
```

## Image smoke test

[`scripts/smoke-test.sh`](../scripts/smoke-test.sh) builds both images without layer cache, starts an isolated Compose project, verifies healthy services and non-root write restrictions, and checks `/health` plus `/champions`:

```bash
./scripts/smoke-test.sh
```

The script always tears down its isolated project and volumes. Set `SMOKE_USE_CACHE=1` only when intentionally testing cached image layers.

## Teardown

```bash
docker compose down          # stop containers (volumes kept)
docker compose down -v       # also remove pgdata / redisdata volumes
```
