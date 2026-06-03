#!/bin/sh
set -e

# Apply forward-only migrations before serving traffic.
if [ -n "${DATABASE_URL:-}" ]; then
  echo "entrypoint: running database migrations"
  cd /app/packages/db
  ./node_modules/.bin/prisma migrate deploy
fi

cd /app/apps/api
exec "$@"
