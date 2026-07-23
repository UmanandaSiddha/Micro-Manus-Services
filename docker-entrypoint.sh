#!/bin/sh
# Bring the database up to date, then exec the Node app. Fails fast if the database
# is unreachable or migrations don't apply — better than booting against a stale schema.
#
# Uses the dbmate binary shipped with the npm dependency. Expects a clean DATABASE_URL
# (include ?sslmode=disable if your Postgres has no TLS).

set -e

DBMATE="node_modules/.bin/dbmate --migrations-dir ./db/migrations --no-dump-schema"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

echo "==> Waiting for database…"
for i in $(seq 1 30); do
  if $DBMATE status >/dev/null 2>&1; then
    echo "    reachable."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "    still unreachable after 60s — aborting." >&2
    exit 1
  fi
  sleep 2
done

# The database is expected to already exist (created once on the VPS postgres container).
# We only apply migrations here — no `dbmate create`.
echo "==> Running migrations…"
$DBMATE up

echo "==> Starting Node app…"
exec "$@"
