#!/usr/bin/env bash
# Real parallel connections against the cafe_stash database: concurrent redemption, concurrent creation, concurrent guessing.
# usage: cafe_concurrency.sh <socket dir> <port> <pg bin dir>     (called from run.sh)
set -uo pipefail
D="$1"; PORT="$2"; PGBIN="$3"
PS="psql -h $D -p $PORT -U postgres -X -q -t -A -d stash_cafe -v ON_ERROR_STOP=0"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
ok(){ echo "PASS $1"; }; bad(){ echo "FAIL $1 ($2)"; }
U=11111111-0000-0000-0000-00000000000a
$PS -c "delete from auth.users where id='$U'" >/dev/null
$PS <<SQL >/dev/null
insert into auth.users(id,email,email_confirmed_at) values ('$U','conc@x.com',now());
insert into public.documents(id,user_id,status,title,original_name,mime_type,declared_size,size_bytes,storage_path)
  values ('22222222-0000-0000-0000-00000000000a','$U','ready','Conc','c.pdf','application/pdf',10,10,'$U/22222222-0000-0000-0000-00000000000a');
insert into storage.objects(bucket_id,name,owner,metadata) values ('documents','$U/22222222-0000-0000-0000-00000000000a','$U','{"size":10}');
update public.cafe_settings set ip_req_per_min=1000, ip_fail_limit=1000, global_fail_limit=100000, create_per_hour=1000;
delete from public.cafe_attempts;
SQL
create_sql="set role authenticated; select set_config('request.jwt.claim.sub','$U',false); select public.cafe_create_pin('22222222-0000-0000-0000-00000000000a');"

# 1) 12 simultaneous creations for one student
for i in $(seq 1 12); do ( $PS -c "$create_sql" > "$W/c$i" 2>&1 ) & done; wait
N_OK=$(cat "$W"/c* | grep -c '"status": "ok"'); N_EX=$(cat "$W"/c* | grep -c 'active_exists')
LIVE=$($PS -c "select count(*) from public.cafe_pins where owner_id='$U' and status='active'")
[ "$N_OK" = 1 ] && [ "$LIVE" = 1 ] && ok "concurrent create: 12 parallel requests -> exactly 1 PIN issued ($N_EX answered active_exists)" || bad "concurrent create" "ok=$N_OK live=$LIVE"
PIN=$(cat "$W"/c* | grep -o '"pin_code": "[0-9]*"' | head -1 | grep -o '[0-9]\{6\}')

# 2) 25 simultaneous redemptions of the SAME pin from 25 different clients
for i in $(seq 1 25); do ( $PS -c "set role service_role; select public.cafe_redeem('$PIN', sha256(convert_to('conc-$i','UTF8')));" > "$W/r$i" 2>&1 ) & done; wait
WIN=$(cat "$W"/r* | grep -c '"status": "ok"'); LOSE=$(cat "$W"/r* | grep -c '"status": "invalid"')
RED=$($PS -c "select count(*) from public.cafe_pins where owner_id='$U' and status='redeemed'")
[ "$WIN" = 1 ] && [ "$LOSE" = 24 ] && [ "$RED" = 1 ] && ok "concurrent redeem: 25 simultaneous requests -> exactly 1 success, 24 refused" || bad "concurrent redeem" "win=$WIN lose=$LOSE redeemed=$RED"

# 3) concurrent refresh with one receipt: cap of 3 is exact
$PS -c "update public.cafe_pins set status='expired' where owner_id='$U' and status='active'" >/dev/null
PIN2=$($PS -c "$create_sql" | grep -o '"pin_code": "[0-9]*"' | grep -o '[0-9]\{6\}')
RC=$($PS -c "set role service_role; select public.cafe_redeem('$PIN2', sha256(convert_to('rc','UTF8')));" | grep -o '"receipt": "[0-9a-f]*"' | grep -o '[0-9a-f]\{64\}')
for i in $(seq 1 15); do ( $PS -c "set role service_role; select public.cafe_refresh('$RC', sha256(convert_to('rf-$i','UTF8')));" > "$W/f$i" 2>&1 ) & done; wait
FOK=$(cat "$W"/f* | grep -c '"status": "ok"')
[ "$FOK" = 3 ] && ok "concurrent receipt refresh: 15 simultaneous -> exactly 3 allowed (cap)" || bad "concurrent refresh" "ok=$FOK"

# 4) concurrent wrong guesses from ONE client with limit 5: exactly 5 answered, rest rate-limited
$PS -c "update public.cafe_settings set ip_fail_limit=5, ip_req_per_min=1000; delete from public.cafe_attempts;" >/dev/null
for i in $(seq 1 20); do ( $PS -c "set role service_role; select public.cafe_redeem('00000$((i%10))', sha256(convert_to('one-client','UTF8')));" > "$W/g$i" 2>&1 ) & done; wait
INV=$(cat "$W"/g* | grep -c '"status": "invalid"'); RL=$(cat "$W"/g* | grep -c 'rate_limited')
[ "$INV" = 5 ] && [ "$RL" = 15 ] && ok "concurrent guessing: 20 parallel guesses from one client -> 5 evaluated, 15 locked out (no race around the limit)" || bad "concurrent guessing" "invalid=$INV limited=$RL"
$PS -c "update public.cafe_settings set ip_req_per_min=30, ip_fail_limit=5, global_fail_limit=120, create_per_hour=12; delete from public.cafe_attempts; delete from auth.users where id='$U'" >/dev/null
