#!/bin/sh
set -e

# Apply forward-only migrations before serving traffic.
if [ -n "${DATABASE_URL:-}" ]; then
  echo "entrypoint: running database migrations"
  cd /app
  pnpm --filter @open-agents/db db:deploy
fi

cd /app/apps/api
exec "$@"
