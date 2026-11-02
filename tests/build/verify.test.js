/* Self-test of scripts/verify-supabase.js against a LOCAL FAKE server (mocked; says nothing about a real project). */
const http = require('http'), path = require('path'), { spawn } = require('child_process');
let failed = 0, total = 0; const ok = (n, c, x) => { total++; if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c || !x ? '' : '  -> ' + x)); };
const b = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const ANON = b({ alg: 'HS256' }) + '.' + b({ role: 'anon', ref: 'x' }) + '.sig';
function fake(mode) {
  const bad = mode === 'bad', docs = new Map(), objs = new Map(); let n = 0;
  const who = h => ({ T1: 'U1', T2: 'U2' })[(h || '').replace('Bearer ', '')] || null;
  return new Promise(res => { const s = http.createServer((q, r) => { const chunks = []; q.on('data', c => chunks.push(c)); q.on('end', () => {
    const raw = Buffer.concat(chunks); let body = {}; try { body = JSON.parse(raw.toString() || '{}'); } catch (e) { /* binary */ }
    const send = (c, o) => { r.statusCode = c; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(o)); };
    const me = who(q.headers.authorization); const u = q.url;
    if (u.startsWith('/auth/v1/settings')) return send(200, { external: { email: true, google: true, anonymous_users: bad }, mailer_autoconfirm: bad });
    if (u.startsWith('/auth/v1/token')) return body.email === 'u1@x' ? send(200, { access_token: 'T1', user: { id: 'U1' } }) : body.email === 'u2@x' ? send(200, { access_token: 'T2', user: { id: 'U2' } }) : send(400, {});
    if (u.startsWith('/auth/v1/logout')) return send(204, {});
    if (u.startsWith('/storage/v1/object/public/')) return send(bad ? 200 : 400, {});
    if (u.startsWith('/storage/v1/object/documents/')) {
      const path = u.replace('/storage/v1/object/documents/', ''); const d = [...docs.values()].find(x => x.path === path);
      if (!me) return send(401, {});
      if (q.method === 'POST') { if (!d || (d.uid !== me && !bad) || d.status !== 'pending' || objs.has(path)) return send(403, {}); objs.set(path, raw); return send(200, {}); }
      if (q.method === 'GET') { if (!objs.has(path) || (d.uid !== me && !bad)) return send(404, {}); r.statusCode = 200; return r.end(objs.get(path)); }
      if (q.method === 'DELETE') { if (d && (d.uid === me || bad) && (['deleting', 'failed', 'pending'].includes(d.status) || bad)) objs.delete(path); return send(200, []); }
    }
    if (u.startsWith('/rest/v1/rpc/')) {
      const fn = u.split('/').pop(); const d = docs.get(body.p_id);
      if (bad && fn === 'delete_my_account') return send(200, {});
      if (!me) return send(401, {});
      if (['orphan_report', 'admin_correct_matric', 'quota_used'].includes(fn)) return send(403, {});
      if (fn === 'begin_upload') { const id = 'D' + (++n); const row = { id, uid: me, path: me + '/' + id, status: 'pending', size: body.p_size }; docs.set(id, row); return send(200, { status: 'ok', document: { id, storage_path: row.path } }); }
      if (fn === 'my_storage_usage') return send(200, { used: 12, limit: 1073741824, tier: 'free' });
      if (!d || (d.uid !== me && !(bad && fn === 'begin_delete'))) return send(200, { status: 'not_found' });
      if (fn === 'finalize_upload') { const o = objs.get(d.path); if (!o) return send(200, { status: 'object_missing' }); d.status = 'ready'; return send(200, { status: 'ok', document: { size_bytes: o.length } }); }
      if (fn === 'begin_delete') { d.status = 'deleting'; return send(200, { status: 'ok' }); }
      if (fn === 'confirm_removed') { if (objs.has(d.path)) return send(200, { status: 'object_still_present' }); docs.delete(d.id); return send(200, { status: 'ok' }); }
      return send(200, { status: 'ok' });
    }
    if (u.startsWith('/rest/v1/')) {
      const tb = u.split('?')[0].split('/').pop();
      if (['user_entitlements', 'storage_deletion_queue'].includes(tb) && me) return send(403, {});
      if (tb === 'profiles' && q.method === 'GET') return send(200, bad && !me ? [{ id: 'x' }] : me ? [{ id: me, email: 'e', matric_number: null }] : []);
      if (tb === 'documents' && q.method === 'GET') return send(200, me ? [...docs.values()].filter(x => x.uid === me || bad).map(x => ({ id: x.id })) : []);
      return send(q.method === 'GET' ? 200 : 401, q.method === 'GET' ? [] : { message: 'denied' });
    }
    send(404, {}); }); }).listen(0, '127.0.0.1', () => res(s)); });
}
const run = (port) => new Promise(res => { const c = spawn('node', [path.join(__dirname, '../../scripts/verify-supabase.js')], { env: { PATH: process.env.PATH, SUPABASE_URL: 'http://127.0.0.1:' + port, SUPABASE_ANON_KEY: ANON, TEST_EMAIL: 'u1@x', TEST_PASSWORD: 'pw-pw-pw-1', TEST2_EMAIL: 'u2@x', TEST2_PASSWORD: 'pw-pw-pw-2' } }); let o = ''; c.stdout.on('data', x => o += x); c.stderr.on('data', x => o += x); c.on('close', st => res({ st, o })); });
(async () => {
  let s = await fake('good'); let r = await run(s.address().port); s.closeAllConnections(); s.close();
  ok('locked-down project -> all checks pass', r.st === 0 && !/FAIL/.test(r.o), r.o.split('\n').filter(l => /FAIL/.test(l)).join(' | '));
  ok('signed-in storage cycle and cross-account checks ran (and passed)', /PASS download returns identical bytes/.test(r.o) && /PASS ACCOUNT B cannot download/.test(r.o));
  ok('output states it does not test email/Google', /does NOT test email delivery or Google/.test(r.o));
  s = await fake('bad'); r = await run(s.address().port); s.closeAllConnections(); s.close();
  ok('misconfigured project -> exit 1', r.st === 1);
  for (const needle of ['"Confirm email" is ON', 'Anonymous sign-ins are OFF', 'anon cannot read profiles', 'anon cannot call delete_my_account', 'bucket "documents" is NOT public', 'ACCOUNT B cannot download', 'a READY file cannot be deleted directly']) ok('  flags: ' + needle, new RegExp('FAIL ' + needle.replace(/[()"]/g, '.')).test(r.o), needle);
  ok('never prints the key or tokens', !r.o.includes(ANON) && !/\bT1\b|\bT2\b/.test(r.o));
  console.log(`\nVERIFY SELF-TEST: ${total} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
