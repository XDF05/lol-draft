# Docker Configuration

This directory documents the containerized development environment for the LoL 1v1 Draft Strategy Board. The compose file itself lives at the repository root: [`docker-compose.yml`](../docker-compose.yml).

## Services

| Service | Image / Build | Port | Purpose |
|---------|---------------|------|---------|
| `web`   | `./frontend` (Next.js 14) | 3000 | Frontend UI |
| `api`   | `./backend` (NestJS 10)  | 4000 | REST API + Socket.IO |
| `db`    | `postgres:15-alpine`     | 5432 | Primary database (`league_draft`, schema `draft_db`) |
| `redis` | `redis:7-alpine`         | 6379 | Cache / pub-sub (AOF persistence enabled) |

All services are attached to a single bridge network, `app-network`.

## Volumes

- `pgdata` — PostgreSQL data directory (`/var/lib/postgresql/data`)
- `redisdata` — Redis data directory (`/data`)

`scripts/init-db.sql` is mounted into the Postgres container and runs on first initialization (creates the `draft_db` schema).

## Running

```bash
# 1. Create a local env file with a strong secret (the root .env is gitignored)
cp .env.example .env
sed -i 's/^JWT_SECRET=.*/JWT_SECRET='"$(openssl rand -hex 32)"'/' .env

# 2. Build and start everything in the background
docker-compose up -d

# 3. Verify
docker-compose ps            # web, api, db, redis all running/healthy
curl http://localhost:4000/health   # -> {"status":"ok"}
```

## Teardown

```bash
docker-compose down          # stop containers (volumes kept)
docker-compose down -v       # also remove pgdata / redisdata volumes
```
