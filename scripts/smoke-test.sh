#!/usr/bin/env bash
# Build and start an isolated Compose stack, then verify runtime health,
# non-root permissions, and the public API endpoints.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-lol-draft-smoke-$$}"

cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    docker compose ps || true
    docker compose logs --tail=120 || true
  fi
  docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

if [[ "${SMOKE_USE_CACHE:-0}" != "1" ]]; then
  echo "==> Building images without layer cache"
  docker compose build --no-cache
else
  echo "==> Building images (cache enabled)"
  docker compose build
fi

echo "==> Starting isolated stack: $COMPOSE_PROJECT_NAME"
docker compose up --detach --wait --wait-timeout 180

api_container="$(docker compose ps --quiet api)"
web_container="$(docker compose ps --quiet web)"
api_health="$(docker inspect --format '{{.State.Health.Status}}' "$api_container")"
web_health="$(docker inspect --format '{{.State.Health.Status}}' "$web_container")"

[[ "$api_health" == "healthy" ]] || {
  echo "API health status is '$api_health', expected healthy" >&2
  exit 1
}
[[ "$web_health" == "healthy" ]] || {
  echo "Web health status is '$web_health', expected healthy" >&2
  exit 1
}

api_uid="$(docker compose exec --no-TTY api id -u | tr -d '[:space:]')"
web_uid="$(docker compose exec --no-TTY web id -u | tr -d '[:space:]')"
[[ "$api_uid" != "0" && -n "$api_uid" ]] || {
  echo "API container is running as root" >&2
  exit 1
}
[[ "$web_uid" != "0" && -n "$web_uid" ]] || {
  echo "Web container is running as root" >&2
  exit 1
}

if docker compose exec --no-TTY api sh -c 'touch /app/should-not-be-writable' 2>/dev/null; then
  echo "API runtime user can unexpectedly write to /app" >&2
  docker compose exec --no-TTY api rm -f /app/should-not-be-writable || true
  exit 1
fi
if docker compose exec --no-TTY web sh -c 'touch /app/should-not-be-writable' 2>/dev/null; then
  echo "Web runtime user can unexpectedly write to /app" >&2
  docker compose exec --no-TTY web rm -f /app/should-not-be-writable || true
  exit 1
fi

# The frontend's image-optimizer cache is its one intentionally writable path.
docker compose exec --no-TTY web sh -c \
  'touch /app/.next/cache/.smoke-write && rm /app/.next/cache/.smoke-write'

echo "==> Verifying API health endpoint"
curl --fail --silent --show-error --retry 10 --retry-delay 2 \
  http://127.0.0.1:4000/health \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);if(v.status!=='ok')process.exit(1)})"

echo "==> Verifying champion catalog endpoint"
curl --fail --silent --show-error --retry 10 --retry-delay 2 \
  http://127.0.0.1:4000/champions \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);if(!Array.isArray(v.data)||v.data.length===0)process.exit(1)})"

echo "==> Smoke test passed"
