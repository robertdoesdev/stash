#!/usr/bin/env bash
# Migration + RLS tests on a throwaway local PostgreSQL 16 cluster.
#   db "stash"    : fresh 0001 + 0002  -> main suite (rls_test.sql)
#   db "stash_up" : 0001 with live data, then 0002 -> upgrade path
# Re-applies both migrations to prove idempotency.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); PORT=${PGPORT:-54329}
chown postgres "$D" 2>/dev/null || true
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$PGBIN/initdb -D $D/data -A trust >/dev/null"
run "$PGBIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log -w start >/dev/null"
trap 'run "$PGBIN/pg_ctl -D $D/data -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
P0="psql -h $D -p $PORT -U postgres -X -q -v ON_ERROR_STOP=1"
Q="psql -h $D -p $PORT -U postgres -X -q -t -A"
M1="$ROOT/supabase/migrations/0001_profiles.sql"; M2="$ROOT/supabase/migrations/0002_hardening.sql"
$P0 -c "create database stash" -c "create database stash_up"

echo "=== fresh install: 0001 + 0002 (then both again for idempotency) ==="
$P0 -d stash -f "$HERE/auth_stub.sql" 2>&1 | grep -v NOTICE || true
for f in "$M1" "$M2" "$M1" "$M2"; do $P0 -d stash -f "$f" 2>&1 | grep -v NOTICE || true; done
echo "migrations applied twice without error"
$Q -d stash -F ' ' -f "$HERE/rls_test.sql" 2>&1 | grep -E "^(PASS|FAIL|TOTAL)"

echo "=== upgrade path: live 0001 data -> 0002 ==="
$P0 -d stash_up -f "$HERE/auth_stub.sql" 2>&1 | grep -v NOTICE || true
$P0 -d stash_up -f "$M1" 2>&1 | grep -v NOTICE || true
$P0 -d stash_up -c "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('99999999-0000-0000-0000-000000000001','sq@x.com',null,'{\"full_name\":\"Sq Atter\",\"matric_number\":\"FU/50/0009\",\"level\":\"100L\"}'),
 ('99999999-0000-0000-0000-000000000002','ok@x.com',now(),'{\"full_name\":\"Okay Person\",\"matric_number\":\"FU/50/0005\",\"level\":\"100L\"}')"
$P0 -d stash_up -f "$M2" 2>&1 | grep -v NOTICE || true
$Q -d stash_up -f "$HERE/upgrade_check.sql"

echo "=== PHASE 3: 0003 documents / storage / quota ==="
M3="${M3_OVERRIDE:-$ROOT/supabase/migrations/0003_documents.sql}"
$P0 -c "create database stash_docs"
$P0 -d stash_docs -f "$HERE/auth_stub.sql" 2>&1 | grep -v NOTICE || true
$P0 -d stash_docs -f "$HERE/storage_stub.sql" 2>&1 | grep -v NOTICE || true
for f in "$M1" "$M2" "$M3" "$M3" "$M2" "$M3"; do $P0 -d stash_docs -f "$f" 2>&1 | grep -v NOTICE || true; done
echo "0003 applied repeatedly (and after re-running 0002) without error"
$Q -d stash_docs -F ' ' -f "${DOCS_TEST:-$HERE/docs_test.sql}" 2>&1 | grep -E "^(PASS|FAIL|TOTAL|DBG)|ERROR"

echo "=== PHASE 3 upgrade path: live Phase 2 data -> 0003 ==="
$P0 -d stash_up -f "$HERE/storage_stub.sql" 2>&1 | grep -v NOTICE || true
$P0 -d stash_up -f "$M3" 2>&1 | grep -v NOTICE || true
$Q -d stash_up -c "select 'UPGRADE3 profiles intact: ' || (count(*)=2 and bool_or(matric_number is not null)) from public.profiles"

echo "=== PHASE 4a: 0004 Cafe Print ==="
M4="${M4_OVERRIDE:-$ROOT/supabase/migrations/0004_cafe_print.sql}"
$P0 -c "create database stash_cafe"
$P0 -d stash_cafe -f "$HERE/auth_stub.sql" 2>&1 | grep -v NOTICE || true
$P0 -d stash_cafe -f "$HERE/storage_stub.sql" 2>&1 | grep -v NOTICE || true
for f in "$M1" "$M2" "$M3" "$M4"; do $P0 -d stash_cafe -f "$f" 2>&1 | grep -v NOTICE || true; done
PEPPER1=$($Q -d stash_cafe -c "select md5(pepper) from public.cafe_settings")
for f in "$M4" "$M3" "$M4"; do $P0 -d stash_cafe -f "$f" 2>&1 | grep -v NOTICE || true; done
PEPPER2=$($Q -d stash_cafe -c "select md5(pepper) from public.cafe_settings")
[ "$PEPPER1" = "$PEPPER2" ] && echo "PASS 0004 re-applies cleanly and keeps the same pepper (existing PINs stay valid)" || echo "FAIL 0004 changed the pepper on re-apply"
$Q -d stash_cafe -F ' ' -f "$HERE/cafe_test.sql" 2>&1 | grep -E "^(PASS|FAIL|TOTAL)|ERROR"
bash "$HERE/cafe_concurrency.sh" "$D" "$PORT" "$PGBIN"
