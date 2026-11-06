/* Cafe Print API integration test.
 * REAL: migrations 0001-0004 on a throwaway PostgreSQL, the real api/cafe/*.js handlers, real HTTP, real parallelism.
 * SIMULATED (a test double, NOT Supabase): the PostgREST /rpc layer (forwards to psql as role service_role) and Supabase
 * Storage signing/serving (token + expiry + path binding). Env: PGHOST PGPORT PGDATABASE from tests/api/run.sh. */
const http = require('http'), crypto = require('crypto'), { execFile } = require('child_process');
const KEY = 'test-service-role-key-NOT-REAL-' + crypto.randomBytes(6).toString('hex');
const results = []; const check = (n, ok, d) => { results.push({ n, ok: !!ok }); process.stdout.write((ok ? 'PASS ' : 'FAIL ') + n + (ok || !d ? '' : '  <- ' + d) + '\n'); };
const U = '33333333-0000-0000-0000-00000000000a', V = '44444444-0000-0000-0000-00000000000b';
const DOC = '55555555-0000-0000-0000-00000000000a', DOC2 = '66666666-0000-0000-0000-00000000000b';
const psqlArgs = () => ['-h', process.env.PGHOST, '-p', process.env.PGPORT, '-U', 'postgres', '-X', '-q', '-t', '-A', '-d', process.env.PGDATABASE, '-v', 'ON_ERROR_STOP=1'];
const psql = (sql) => new Promise((res, rej) => execFile('psql', psqlArgs().concat(['-c', sql]), (e, so, se) => e ? rej(new Error(se || e.message)) : res(so.trim())));
const lit = (v) => v === null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";

// ---- storage + postgrest test double
const store = { tokens: new Map(), objects: new Map(), clockSkew: 0, failSign: 0, signCalls: [] };
const now = () => Date.now() + store.clockSkew;
const shim = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks).toString();
  const url = new URL(req.url, 'http://x'); const auth = req.headers['authorization'] === 'Bearer ' + KEY && req.headers['apikey'] === KEY;
  const J = (s, o) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    if (!auth) return J(401, { message: 'invalid key' });
    const fn = url.pathname.split('/').pop(); const a = JSON.parse(raw || '{}');
    if (!['cafe_redeem', 'cafe_refresh', 'cafe_cleanup'].includes(fn)) return J(404, {});
    const args = Object.keys(a).map(k => `${k} => ${lit(a[k])}${k === 'p_ip' ? '::bytea' : ''}`).join(', ');
    try { const out = await psql(`set role service_role; select public.${fn}(${args})`); return J(200, JSON.parse(out.split('\n').pop())); }
    catch (e) { return J(500, { message: 'db' }); }
  }
  if (url.pathname.startsWith('/storage/v1/object/sign/documents/') && req.method === 'POST') {
    if (!auth) return J(401, {});
    if (store.failSign > 0) { store.failSign--; return J(500, { message: 'storage down' }); }
    const path = decodeURIComponent(url.pathname.replace('/storage/v1/object/sign/documents/', ''));
    store.signCalls.push(path);
    if (!store.objects.has(path)) return J(404, {});
    const token = crypto.randomBytes(16).toString('hex'); store.tokens.set(token, { path, exp: now() + JSON.parse(raw).expiresIn * 1000 });
    return J(200, { signedURL: `/object/sign/documents/${path}?token=${token}` });
  }
  if (url.pathname.startsWith('/storage/v1/object/sign/documents/') && req.method === 'GET') {
    const t = store.tokens.get(url.searchParams.get('token')); const path = decodeURIComponent(url.pathname.replace('/storage/v1/object/sign/documents/', ''));
    if (!t || t.path !== path || t.exp < now()) return J(400, { error: 'invalid or expired token' });
    res.setHeader('content-type', 'application/pdf'); return res.end(store.objects.get(path));
  }
  return J(401, { message: 'not authorised (private bucket)' });   // no listing, no public access
});
const listen = (s) => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));

// ---- API under test
const handlers = { redeem: require('../../api/cafe/redeem.js'), refresh: require('../../api/cafe/refresh.js'), cleanup: require('../../api/cafe/cleanup.js') };
const logs = []; const origLog = console.log; 
const apiSrv = http.createServer((req, res) => { const m = req.url.match(/^\/api\/cafe\/(\w+)/); const h = m && handlers[m[1]]; if (!h) { res.statusCode = 404; return res.end(); } Promise.resolve(h(req, res)).catch(() => { res.statusCode = 500; res.end(); }); });
async function call(port, path, body, o = {}) {
  const r = await fetch(`http://127.0.0.1:${port}/api/cafe/${path}`, { method: o.method || 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-real-ip': o.ip || '198.51.100.' + (1 + Math.floor(Math.random() * 250)) }, o.headers || {}), body: o.method === 'GET' ? undefined : (o.raw !== undefined ? o.raw : JSON.stringify(body)) });
  let j = null; const txt = await r.text(); try { j = JSON.parse(txt); } catch (e) { /* */ }
  return { status: r.status, json: j, headers: r.headers, text: txt };
}
const newPin = async (uid, doc) => { await psql(`update public.cafe_pins set status='expired' where owner_id='${uid}' and status='active'; update public.cafe_pins set created_at=created_at-interval '2 hours' where owner_id='${uid}' and created_at>now()-interval '1 hour'`);
  const o = await psql(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false); select public.cafe_create_pin('${doc}')`); return JSON.parse(o.split('\n').pop()).pin_code; };
const reset = () => psql(`delete from public.cafe_attempts; update public.cafe_global set fail_count=0, window_start=now(); update public.cafe_settings set ip_req_per_min=30, ip_fail_limit=5, global_fail_limit=1000, create_per_hour=1000`);

(async () => {
  const sp = await listen(shim); process.env.SUPABASE_URL = 'http://127.0.0.1:' + sp; process.env.SUPABASE_SERVICE_ROLE_KEY = KEY; process.env.CRON_SECRET = 'cron-' + crypto.randomBytes(6).toString('hex'); process.env.CAFE_IP_SALT = 'test-salt';
  const ap = await listen(apiSrv);
  await psql(`insert into auth.users(id,email,email_confirmed_at) values ('${U}','u@x.com',now()),('${V}','v@x.com',now()) on conflict do nothing;
    insert into public.documents(id,user_id,status,title,original_name,mime_type,declared_size,size_bytes,storage_path) values
     ('${DOC}','${U}','ready','Fee receipt','r.pdf','application/pdf',9,9,'${U}/${DOC}'),('${DOC2}','${V}','ready','Other','o.pdf','application/pdf',9,9,'${V}/${DOC2}') on conflict do nothing;
    insert into storage.objects(bucket_id,name,owner,metadata) values ('documents','${U}/${DOC}','${U}','{}'),('documents','${V}/${DOC2}','${V}','{}') on conflict do nothing`);
  store.objects.set(`${U}/${DOC}`, Buffer.from('%PDF-1.4 student-U-secret')); store.objects.set(`${V}/${DOC2}`, Buffer.from('%PDF-1.4 student-V-secret'));
  // capture logs
  console.log = (...a) => { logs.push(a.join(' ')); };
  await reset();

  // 1 happy path from "another device" (no cookie, no auth header)
  let pin = await newPin(U, DOC);
  let r = await call(ap, 'redeem', { pin });
  check('redeem: valid PIN, no login -> 200 with a signed URL', r.status === 200 && r.json.ok && /\/storage\/v1\/object\/sign\/documents\//.test(r.json.url), JSON.stringify(r.json));
  check('redeem: response is minimum info (url, title, mime, receipt) and no-store', r.json.expires_in === 90 && r.json.title === 'Fee receipt' && !('owner_id' in r.json) && !('storage_path' in r.json) && /no-store/.test(r.headers.get('cache-control')));
  const f = await fetch(r.json.url); const body = await f.text();
  check('signed URL downloads exactly that student\'s document', f.status === 200 && body.includes('student-U-secret'));
  const t = new URL(r.json.url); const other = `${t.origin}/storage/v1/object/sign/documents/${V}/${DOC2}${t.search}`;
  check('signed URL is bound to ONE object (cannot be pointed at another student\'s file)', (await fetch(other)).status === 400);
  check('private bucket: unsigned read and listing refused', (await fetch(`${t.origin}/storage/v1/object/documents/${U}/${DOC}`)).status === 401 && (await fetch(`${t.origin}/storage/v1/object/list/documents`, { method: 'POST' })).status === 401);
  store.clockSkew = 91 * 1000; check('signed URL stops working after its lifetime (90 s)', (await fetch(r.json.url)).status === 400); store.clockSkew = 0;
  const again = await call(ap, 'redeem', { pin }); const unknown = await call(ap, 'redeem', { pin: '000000' });
  check('redeem: same PIN a second time -> 404 invalid', again.status === 404 && again.json.error === 'invalid');
  check('redeem: used PIN and unknown PIN give identical responses', again.text === unknown.text && again.status === unknown.status);

  // 2 concurrency over HTTP
  await reset(); pin = await newPin(U, DOC);
  const par = await Promise.all(Array.from({ length: 20 }, () => call(ap, 'redeem', { pin })));
  check('concurrent redeem over HTTP: 20 simultaneous requests -> exactly one 200', par.filter(x => x.status === 200).length === 1 && par.filter(x => x.status === 404).length === 19, par.map(x => x.status).join());

  // 3 brute force
  await reset(); pin = await newPin(U, DOC);
  const atk = '203.0.113.7'; const st = [];
  for (let i = 0; i < 5; i++) st.push((await call(ap, 'redeem', { pin: '11111' + i }, { ip: atk })).status);
  const locked = await call(ap, 'redeem', { pin }, { ip: atk });
  check('brute force: 5 wrong guesses then even the correct PIN gets 429 + Retry-After', st.every(s => s === 404) && locked.status === 429 && +locked.headers.get('retry-after') > 0, st.join() + ' ' + locked.status);
  check('brute force: a different client can still use that PIN (it was not burned)', (await call(ap, 'redeem', { pin }, { ip: '203.0.113.99' })).status === 200);
  await reset(); await psql(`update public.cafe_settings set ip_req_per_min=4`);
  const fl = []; for (let i = 0; i < 6; i++) fl.push((await call(ap, 'redeem', { pin: 'x' }, { ip: '203.0.113.50' })).status === 429);
  check('flood: requests above the per-minute cap are refused with 429 (even bad input)', fl.slice(4).every(Boolean));
  await reset(); await psql(`update public.cafe_settings set global_fail_limit=5`);
  for (let i = 0; i < 5; i++) await call(ap, 'redeem', { pin: '12345' + i }, { ip: '198.18.0.' + (i + 1) });
  pin = await newPin(U, DOC);
  check('distributed guessing: global failure ceiling refuses even a fresh client (fail-closed)', (await call(ap, 'redeem', { pin }, { ip: '198.18.9.9' })).status === 429);
  await reset();
  const v6 = []; for (let i = 0; i < 6; i++) v6.push((await call(ap, 'redeem', { pin: '22222' + i }, { ip: '2001:db8:1:2:' + (i + 1) + '::' + (i + 7) })).status);
  check('IPv6 rotation inside one /64 is one client (6th request locked)', v6[5] === 429, v6.join());

  // 4 input validation / hardening
  await reset();
  check('only POST: GET -> 405 with Allow', (await call(ap, 'redeem', null, { method: 'GET' })).status === 405);
  check('cross-origin browser request -> 403', (await call(ap, 'redeem', { pin: '123456' }, { headers: { origin: 'https://evil.example' } })).status === 403 && (await call(ap, 'redeem', { pin: '123456' }, { headers: { 'sec-fetch-site': 'cross-site' } })).status === 403);
  check('wrong content-type / malformed JSON / array body -> 400', (await call(ap, 'redeem', null, { raw: 'pin=1', headers: { 'content-type': 'text/plain' } })).status === 400 && (await call(ap, 'redeem', null, { raw: '{bad' })).status === 400 && (await call(ap, 'redeem', null, { raw: '[1]' })).status === 400);
  check('non-string PIN -> 400; huge body -> 413', (await call(ap, 'redeem', { pin: 123456 })).status === 400 && (await call(ap, 'redeem', { pin: 'x'.repeat(5000) })).status === 413);
  check('client cannot inject owner/document/expiry fields (ignored; PIN decides)', (await call(ap, 'redeem', { pin: '999999', owner_id: U, document_id: DOC, storage_path: `${U}/${DOC}`, expires_at: '2999-01-01' })).status === 404);
  check('SQL-ish PIN is just invalid', (await call(ap, 'redeem', { pin: "1' or '1'='1" })).status === 404);

  // 5 unavailable document
  await reset(); pin = await newPin(U, DOC); await psql(`update public.documents set status='deleting' where id='${DOC}'`);
  check('document deleted after PIN creation -> 404 (same as invalid)', (await call(ap, 'redeem', { pin })).status === 404);
  await psql(`update public.documents set status='ready' where id='${DOC}'`);
  await reset(); pin = await newPin(U, DOC); store.objects.delete(`${U}/${DOC}`); await psql(`delete from storage.objects where name='${U}/${DOC}'`);
  check('object missing from the private bucket -> 404', (await call(ap, 'redeem', { pin })).status === 404);
  store.objects.set(`${U}/${DOC}`, Buffer.from('%PDF-1.4 student-U-secret')); await psql(`insert into storage.objects(bucket_id,name,owner,metadata) values ('documents','${U}/${DOC}','${U}','{}')`);

  // 6 redeemed but retrieval fails
  await reset(); pin = await newPin(U, DOC); store.failSign = 1;
  const rf = await call(ap, 'redeem', { pin });
  check('retrieval fails after redemption -> 502 with a receipt, PIN stays consumed', rf.status === 502 && rf.json.error === 'retrieval_failed' && /^[0-9a-f]{64}$/.test(rf.json.receipt));
  check('...the PIN itself is NOT reusable', (await call(ap, 'redeem', { pin })).status === 404);
  const rr = await call(ap, 'refresh', { receipt: rf.json.receipt });
  check('...but the receipt fetches a fresh signed URL for the SAME document', rr.status === 200 && (await (await fetch(rr.json.url)).text()).includes('student-U-secret') && rr.json.refreshes_left === 2, JSON.stringify(rr.json));
  await call(ap, 'refresh', { receipt: rf.json.receipt }); await call(ap, 'refresh', { receipt: rf.json.receipt });
  check('...receipt is capped at 3 refreshes', (await call(ap, 'refresh', { receipt: rf.json.receipt })).status === 404);
  check('refresh: garbage / PIN-as-receipt rejected', (await call(ap, 'refresh', { receipt: pin })).status === 404 && (await call(ap, 'refresh', { receipt: 'a'.repeat(64) })).status === 404 && (await call(ap, 'refresh', {})).status === 400);

  // 7 isolation of two students
  await reset(); const pv = await newPin(V, DOC2); const rv = await call(ap, 'redeem', { pin: pv });
  check('cross-user: student V\'s PIN opens only V\'s document', rv.status === 200 && (await (await fetch(rv.json.url)).text()).includes('student-V-secret') && !store.signCalls.slice(-1)[0].startsWith(U));

  // 8 cleanup + config
  const cs = process.env.CRON_SECRET;
  check('cleanup: no / wrong bearer -> 401', (await call(ap, 'cleanup', null, { method: 'GET' })).status === 401 && (await call(ap, 'cleanup', null, { method: 'GET', headers: { authorization: 'Bearer nope' } })).status === 401);
  const cl = await call(ap, 'cleanup', null, { method: 'GET', headers: { authorization: 'Bearer ' + cs } });
  check('cleanup: correct bearer -> 200 with counts only', cl.status === 200 && 'expired' in cl.json.result);
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  check('misconfigured (no service key) -> 503, nothing leaked', (await call(ap, 'redeem', { pin: '123456' })).status === 503);
  process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey; process.env.SUPABASE_URL = 'http://evil.example'; 
  check('non-https Supabase URL refused outside localhost', (await call(ap, 'redeem', { pin: '123456' })).status === 503); process.env.SUPABASE_URL = 'http://127.0.0.1:' + sp;
  process.env.SUPABASE_URL = 'http://127.0.0.1:1'; await reset().catch(() => {});
  check('database unreachable -> 503 generic (no internals)', (await call(ap, 'redeem', { pin: '123456' })).json.error === 'unavailable'); process.env.SUPABASE_URL = 'http://127.0.0.1:' + sp;

  // 9 logging / secrets
  const all = logs.join('\n');
  check('logs contain no PIN, receipt, signed token, service key, path or raw IP', !/123456|token=|storage\/v1|student-|203\.0\.113/.test(all) && !all.includes(KEY) && !all.includes(U) && !/[0-9a-f]{64}/.test(all) && logs.length > 0);
  const failed = results.filter(x => !x.ok).length; console.log = origLog; console.log(`TOTAL ${results.length - failed}/${results.length}`);
  await psql(`delete from auth.users where id in ('${U}','${V}')`);
  shim.close(); apiSrv.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.log = origLog; console.error('FATAL', e); process.exit(2); });
