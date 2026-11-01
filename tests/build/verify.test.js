/* Self-test of scripts/verify-supabase.js against a LOCAL FAKE server (mocked; says nothing about a real project). */
const http = require('http'), path = require('path'), { spawn } = require('child_process');
let failed = 0, total = 0; const ok = (n, c, x) => { total++; if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c || !x ? '' : '  -> ' + x)); };
const b = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const ANON = b({ alg: 'HS256' }) + '.' + b({ role: 'anon', ref: 'x' }) + '.sig';
function fake(mode) {
  return new Promise(res => { const s = http.createServer((q, r) => {
    const send = (c, o) => { r.statusCode = c; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(o)); };
    const bad = mode === 'bad';
    if (q.url.startsWith('/auth/v1/settings')) return send(200, { external: { email: true, google: true, anonymous_users: bad }, mailer_autoconfirm: bad });
    if (q.url.startsWith('/rest/v1/profiles') && q.method === 'GET') return send(200, bad ? [{ id: 'someone-else', email: 'a@b.c' }] : []);
    if (q.url.startsWith('/rest/v1/rpc/')) return send(bad && q.url.endsWith('delete_my_account') ? 200 : 401, {});
    if (q.url.startsWith('/rest/v1/')) return send(q.method === 'GET' ? 200 : 401, q.method === 'GET' ? [] : { message: 'denied' });
    send(404, {});
  }).listen(0, '127.0.0.1', () => res(s)); });
}
const run = (port) => new Promise(res => { const c = spawn('node', [path.join(__dirname, '../../scripts/verify-supabase.js')], { env: { PATH: process.env.PATH, SUPABASE_URL: 'http://127.0.0.1:' + port, SUPABASE_ANON_KEY: ANON } }); let o = ''; c.stdout.on('data', x => o += x); c.stderr.on('data', x => o += x); c.on('close', st => res({ st, o })); });
(async () => {
  let s = await fake('good'); let r = await run(s.address().port); s.closeAllConnections(); s.close();
  ok('locked-down project -> all checks pass', r.st === 0 && !/FAIL/.test(r.o), r.o.split('\n').filter(l => /FAIL/.test(l)).join(' | '));
  ok('output states it does not test email/Google', /does NOT test email delivery or Google/.test(r.o));
  s = await fake('bad'); r = await run(s.address().port); s.closeAllConnections(); s.close();
  ok('misconfigured project -> exit 1', r.st === 1);
  for (const needle of ['"Confirm email" is ON', 'Anonymous sign-ins are OFF', 'anon cannot read profiles', 'anon cannot call delete_my_account']) ok('  flags: ' + needle, new RegExp('FAIL ' + needle.replace(/[()"]/g, '.')).test(r.o), needle);
  ok('never prints the key', !r.o.includes(ANON));
  console.log(`\nVERIFY SELF-TEST: ${total} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
