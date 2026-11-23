# Continuous Integration

The GitHub Actions workflow at [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
runs on every push and pull request. It validates formatting, lint, tests,
documentation, the Compose end-to-end draft flow, and publishes container
images from `main`.

## Jobs

| Job | Trigger | What it runs |
|---|---|---|
| `lint` | Every push and pull request | Backend/frontend Prettier and ESLint, Prisma migration structure check, documentation check |
| `backend-test` | Every push and pull request | Backend Jest suite against service containers for PostgreSQL 15 and Redis 7 |
| `frontend-test` | Every push and pull request | Frontend Jest suite (component and accessibility tests) |
| `e2e` | Pull requests only | Builds the Compose stack, applies migrations through the one-shot `migrate` service, and plays a complete 21-turn draft through HTTP and Socket.IO |
| `deploy` | Pushes to `main` only | Builds and publishes the API and web images to GitHub Container Registry (GHCR) |

The `e2e` and `deploy` jobs wait for `lint`, `backend-test`, and
`frontend-test`. Concurrent runs on the same branch are cancelled when a newer
commit arrives.

## Prerequisites and secrets

The workflow uses only the repository `GITHUB_TOKEN`, which GitHub Actions
provides automatically. No Riot API key is required: champion data comes from
the public Data Dragon CDN.

| Name | Where it comes from | Used by |
|---|---|---|
| `GITHUB_TOKEN` | Provided by GitHub Actions | GHCR login and image push |
| `JWT_SECRET` | Generated per run with `openssl rand -hex 32` | Backend tests and Compose e2e |
| `POSTGRES_PASSWORD` | Generated per run with `openssl rand -hex 24` | Compose e2e only |

Repository settings needed for the publish job:

1. **Actions permissions** — allow workflows to read repository contents and
   write packages (the workflow declares `packages: write` for `deploy`).
2. **GHCR visibility** — published images inherit the repository visibility.
   Private repositories produce private packages; runners authenticate with
   `GITHUB_TOKEN`.
3. **Branch protection** (optional) — require the `lint`, `backend-test`, and
   `frontend-test` checks before merging.

The e2e job writes a throwaway root `.env` with generated secrets. It never
reads repository secrets, so pull requests from forks run the same suite.

## Published images

`deploy` pushes two images on every push to `main`:

```text
ghcr.io/<owner>/<repository>-api:latest
ghcr.io/<owner>/<repository>-api:<commit-sha>
ghcr.io/<owner>/<repository>-web:latest
ghcr.io/<owner>/<repository>-web:<commit-sha>
```

The image names are lowercased to satisfy the registry naming rules. The job
verifies both images exist with `docker buildx imagetools inspect` after the
push. The API image is the runtime stage of `backend/Dockerfile`; the web image
is the standalone build from `frontend/Dockerfile`.

## Reproduce CI locally

Run the same checks from the repository root.

### Lint, format, and documentation

```bash
cd backend
npm ci
npm run lint
npm run format:check
npm run db:check-migrations

cd ../frontend
npm ci
npm run lint
npm run format:check

cd ..
node scripts/check-docs.mjs
```

### Backend tests

The backend suite needs PostgreSQL and Redis. Start them with Compose, create
the test database, apply migrations, then run the suite:

```bash
docker compose up -d db redis

docker compose exec db psql -U postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='league_draft_test'" | grep -q 1 || \
  docker compose exec db psql -U postgres -c 'CREATE DATABASE league_draft_test;'
docker compose exec db psql -U postgres -d league_draft_test -c 'CREATE SCHEMA IF NOT EXISTS draft_db;'

cd backend
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/league_draft_test?schema=draft_db' \
  npm run db:migrate
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/league_draft_test?schema=draft_db' \
  JWT_SECRET='ci-test-secret-not-for-production' \
  REDIS_HOST=127.0.0.1 \
  REDIS_PORT=6379 \
  npm run test:ci
```

`backend/tests/setup.js` truncates the test schema between runs. Do not point
`DATABASE_URL` at a database you want to keep.

### Frontend tests

```bash
cd frontend
npm ci
npm run test:ci
```

### Compose end-to-end draft

The e2e suite talks to a running stack instead of booting Nest in-process.
Build and start the stack, shorten the Finalization window for a fast run, and
execute the suite:

```bash
cp .env.example .env
# set JWT_SECRET and POSTGRES_PASSWORD as described in docs/local-development.md

DRAFT_FINALIZATION_TIMER_MS=5000 docker compose up -d --build --wait

cd backend
npm ci
E2E_API_URL=http://127.0.0.1:4000 npm run test:e2e

cd ..
docker compose down -v
```

The suite registers two players, creates a draft, joins with the second
player, plays all 20 action turns, waits for Finalization to complete, checks
the public snapshot, and joins as a spectator. It uses the real gateway and
database, so it also verifies the Compose `migrate` service applied the schema.

The CI job sets `DRAFT_FINALIZATION_TIMER_MS=5000`; a local run without that
variable uses the normal 60-second Finalization window. The suite's default
wait is 90 seconds and can be extended with `E2E_FINALIZATION_TIMEOUT_MS`.

### Compose configuration and smoke test

```bash
docker compose config --quiet
bash scripts/smoke-test.sh
```

## Failure triage

| Failure | Likely cause | Remedy |
|---|---|---|
| `format:check` | Unformatted source | Run `npm run format` in that package and commit. |
| `lint` | ESLint error | Run `npm run lint` locally; fix or justify a rule change in `eslint.config.mjs`. |
| `db:check-migrations` | Missing or malformed migration folder | Add a migration under `backend/prisma/migrations/` and rerun. |
| Backend tests | PostgreSQL/Redis not ready or test schema not migrated | Check the service health and rerun the migration step. |
| E2E | Compose build/startup failure, migration failure, or timer too short | Read the uploaded Compose logs; `docker compose logs migrate db api`. |
| Deploy | Missing `packages: write` permission or GHCR name collision | Check the repository Actions permissions and package settings. |

The e2e job prints the last 200 Compose log lines when it fails. The stack is
always torn down with `docker compose down --volumes --remove-orphans`.

## Related documents

- [`docs/local-development.md`](local-development.md) — environment setup and
  manual startup.
- [`docs/troubleshooting.md`](troubleshooting.md) — runtime failures.
- [`docker/README.md`](../docker/README.md) — container topology and smoke
  test.
