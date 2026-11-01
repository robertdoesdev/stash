#!/usr/bin/env bash
# Evidence run: apply ONLY 0001 and show the audit findings.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); PORT=${PGPORT:-54331}
chown postgres "$D" 2>/dev/null || true
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$PGBIN/initdb -D $D/data -A trust >/dev/null"
run "$PGBIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log -w start >/dev/null"
trap 'run "$PGBIN/pg_ctl -D $D/data -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
P="psql -h $D -p $PORT -U postgres -X -q -v ON_ERROR_STOP=1"
$P -c "create database stash"; P="$P -d stash"
$P -f "$HERE/auth_stub.sql"; $P -f "$ROOT/supabase/migrations/0001_profiles.sql"
psql -h $D -p $PORT -U postgres -d stash -X -q -t -A -f "$HERE/findings_0001.sql" 2>&1
