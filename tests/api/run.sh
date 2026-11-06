#!/usr/bin/env bash
# Throwaway PostgreSQL + migrations 0001-0004 + the API integration test. Never touches a real Supabase project.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."; PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); PORT=${PGPORT:-54331}
chown postgres "$D" 2>/dev/null || true
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$PGBIN/initdb -D $D/data -A trust >/dev/null"
run "$PGBIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log -w start >/dev/null"
trap 'run "$PGBIN/pg_ctl -D $D/data -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
P0="psql -h $D -p $PORT -U postgres -X -q -v ON_ERROR_STOP=0"
$P0 -c "create database api"
for f in "$ROOT/tests/db/auth_stub.sql" "$ROOT/tests/db/storage_stub.sql" "$ROOT"/supabase/migrations/000{1,2,3,4}_*.sql; do $P0 -d api -f "$f" 2>&1 | grep -v NOTICE || true; done
export PGHOST="$D" PGPORT="$PORT" PGDATABASE=api
node "$HERE/cafe.api.test.js"
