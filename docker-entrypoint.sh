#!/bin/sh
set -e

# Apply pending migrations before the app starts (DATABASE_URL from env).
echo "Running dbmate migrations..."
dbmate --migrations-dir ./db/migrations --no-dump-schema up

exec "$@"
