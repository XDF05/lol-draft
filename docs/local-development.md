# Local Development

This guide covers the prerequisites, environment configuration, database
initialization, and startup paths for the LoL 1v1 Draft Strategy Board. The
Docker Compose path is the supported way to run the complete stack; the manual
path is useful while editing the backend or frontend.

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Docker Engine + Compose plugin | Compose v2 or newer | Full stack, database, Redis, e2e tests |
| Node.js | 22.x (the container version) | Backend/frontend development and tests |
| npm | 10 or newer | Dependency installation and scripts |
| PostgreSQL client (`psql`) | 15 or newer | Optional manual database checks |
| `openssl` | any recent version | Generating local secrets |

Host ports used by Compose: `3000` (web), `4000` (api), `5432` (PostgreSQL),
and `6379` (Redis). All are bound to `127.0.0.1`.

## Environment configuration

### Compose (repository root)

Compose reads the root `.env` file. Start from the template:

```bash
cp .env.example .env
sed -i 's/^JWT_SECRET=.*/JWT_SECRET='"$(openssl rand -hex 32)"'/' .env
sed -i 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD='"$(openssl rand -hex 24)"'/' .env
```

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs access tokens. Required; use at least 32 random bytes. |
| `POSTGRES_PASSWORD` | Password for the Compose PostgreSQL user. |
| `DATA_DRAGON_BASE_URL` | Optional Data Dragon override; leave empty for the public CDN. |

The real `.env` is ignored by Git and by Docker build contexts. Do not commit
it. See [`docs/security.md`](security.md) for the full secret-handling model.

### Backend (manual development)

Copy `backend/.env.example` to `backend/.env` and adjust the service hosts:

```bash
cd backend
cp .env.example .env
```

For a manually started API on the host, the important values are:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/league_draft?schema=draft_db
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
JWT_SECRET=<a long random value>
PORT=4000
```

`DRAFT_GRACE_PERIOD_MS`, `DRAFT_TURN_TIMER_MS`, and
`DRAFT_FINALIZATION_TIMER_MS` are optional test/dev overrides. Leaving them
unset uses the specification values: 30-second action turns, a 60-second
Finalization window, and a 30-second reconnection grace period.

### Frontend (manual development)

Copy `frontend/.env.example` to `frontend/.env.local`:

```bash
cd frontend
cp .env.example .env.local
```

For a frontend on the host and an API on `localhost:4000`, set:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:4000
```

`NEXT_PUBLIC_API_URL` is compiled into the browser bundle. It must be a
browser-reachable URL and must never contain a credential.

## Database initialization

### Docker Compose

The Compose stack includes a one-shot `migrate` service. It uses the backend
image's migration stage to run `prisma migrate deploy` against the `db`
service, then exits successfully. The `api` service starts only after that
completion, so a fresh `pgdata` volume always has the tables from
`backend/prisma/migrations/`.

`scripts/init-db.sql` is mounted into the PostgreSQL container and creates the
`draft_db` schema on first initialization. The Prisma migration creates the
tables inside that schema.

### Manual database

Start PostgreSQL and Redis (for example with the Compose services only):

```bash
docker compose up -d db redis
```

The Compose database creates `league_draft` from `POSTGRES_DB`; create the
schema once:

```bash
docker compose exec db psql -U postgres -d league_draft -c 'CREATE SCHEMA IF NOT EXISTS draft_db;'
```

Then apply the checked-in migrations from `backend/`:

```bash
cd backend
npm ci
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/league_draft?schema=draft_db' \
  npm run db:migrate
```

Useful database checks:

```bash
cd backend
npm run db:check-migrations   # validates migration folder structure, no DB needed
npm run db:check-drift        # optional; requires SHADOW_DATABASE_URL
```

## Start the full stack

```bash
cp .env.example .env
# edit JWT_SECRET and POSTGRES_PASSWORD as shown above

docker compose up -d --build --wait
docker compose ps
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/champions
```

Open `http://127.0.0.1:3000` in a browser. `docker compose ps` should report
`api`, `web`, `db`, and `redis` as healthy or running, and `migrate` as exited
with status `0`.

Follow logs when diagnosing startup:

```bash
docker compose logs -f api
docker compose logs -f migrate
```

Stop the stack with `docker compose down` (keeps volumes) or
`docker compose down -v` (also removes the PostgreSQL and Redis volumes).

## Run the applications manually

1. Start PostgreSQL and Redis:
   ```bash
   docker compose up -d db redis
   ```
2. Apply migrations (see the manual database section above).
3. Start the API:
   ```bash
   cd backend
   npm ci
   npm run start:dev
   ```
4. Start the frontend in a second terminal:
   ```bash
   cd frontend
   npm ci
   npm run dev
   ```
5. Open `http://localhost:3000`.

The backend reads `backend/.env` through `dotenv/config`. The frontend reads
`frontend/.env.local`. If the API is not on `localhost:4000`, update
`NEXT_PUBLIC_API_URL` and restart the frontend dev server.

## Tests and checks

```bash
# Backend (needs PostgreSQL and Redis; the test database is league_draft_test)
cd backend
npm run lint
npm run format:check
npm run test:ci
npm run test:security

# Frontend
cd ../frontend
npm run lint
npm run format:check
npm run test:ci

# Documentation and repository-level checks
cd ..
node scripts/check-docs.mjs
docker compose config --quiet
```

The backend test setup expects a test database at
`postgresql://postgres:postgres@localhost:5432/league_draft_test?schema=draft_db`.
Create it and apply migrations before running the suite:

```bash
docker compose exec db psql -U postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='league_draft_test'" | grep -q 1 || \
  docker compose exec db psql -U postgres -c 'CREATE DATABASE league_draft_test;'
docker compose exec db psql -U postgres -d league_draft_test -c 'CREATE SCHEMA IF NOT EXISTS draft_db;'
cd backend
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/league_draft_test?schema=draft_db' \
  npm run db:migrate
```

Run the end-to-end draft suite against a running Compose stack:

```bash
cd backend
E2E_API_URL=http://127.0.0.1:4000 npm run test:e2e
```

The CI stack shortens the Finalization window for this suite; a local stack
uses the normal 60-second window unless `DRAFT_FINALIZATION_TIMER_MS` is set.

## Related documents

- [`docs/ci.md`](ci.md) — CI jobs, secrets, and image publishing.
- [`docs/troubleshooting.md`](troubleshooting.md) — common startup and runtime
  failures.
- [`docker/README.md`](../docker/README.md) — container topology and smoke test.
