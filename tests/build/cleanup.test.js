/* Self-test of scripts/cleanup-orphans.js against a LOCAL FAKE server (mocked). */
const http = require('http'), path = require('path'), { spawn } = require('child_process');
let failed = 0, total = 0; const ok = (n, c, x) => { total++; if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c || !x ? '' : '  -> ' + x)); };
const KEY = 'service-role-key-for-test-xyz';
function fake(report, { storageFails = false } = {}) {
  const calls = []; const srv = http.createServer((q, r) => { let b = ''; q.on('data', x => b += x); q.on('end', () => {
    calls.push({ m: q.method, u: q.url, auth: q.headers.authorization, b });
    if (q.url.endsWith('/rpc/orphan_report')) return r.end(JSON.stringify(report));
    if (q.url.startsWith('/storage/v1/object/documents')) { r.statusCode = storageFails ? 500 : 200; return r.end('[]'); }
    r.end('[]'); }); });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ srv, calls }))); }
const run = (port, args = []) => new Promise(res => { const c = spawn('node', [path.join(__dirname, '../../scripts/cleanup-orphans.js'), ...args], { env: { PATH: process.env.PATH, SUPABASE_URL: 'http://127.0.0.1:' + port, SUPABASE_SERVICE_ROLE_KEY: KEY } }); let o = ''; c.stdout.on('data', x => o += x); c.stderr.on('data', x => o += x); c.on('close', st => res({ st, o })); });
(async () => {
  const rep = { deletion_queue: ['u1/a', 'u1/b'], objects_without_row: ['u2/c'], ready_rows_without_object: ['x'], stale_failed_rows: [] };
  let f = await fake(rep); let r = await run(f.srv.address().port);
  ok('dry run: exit 0, lists counts, says WOULD', r.st === 0 && /WOULD be removed/.test(r.o) && /objects of deleted accounts : 2/.test(r.o));
  ok('dry run: issues NO delete requests', !f.calls.some(c => c.m === 'DELETE')); f.srv.closeAllConnections(); f.srv.close();
  f = await fake(rep); r = await run(f.srv.address().port, ['--apply']);
  const del = f.calls.find(c => c.m === 'DELETE' && c.u.startsWith('/storage'));
  ok('--apply removes queue + loose objects (and nothing else)', r.st === 0 && JSON.parse(del.b).prefixes.sort().join() === 'u1/a,u1/b,u2/c', r.o);
  ok('--apply clears only the queue rows it removed', f.calls.some(c => c.m === 'DELETE' && c.u.includes('storage_deletion_queue') && c.u.includes('u1/a') && !c.u.includes('u2/c')));
  ok('report-only categories are never deleted', !f.calls.some(c => c.b.includes('"x"')));
  ok('service key goes only as the Authorization header, and is never printed', f.calls.every(c => c.auth === 'Bearer ' + KEY) && !r.o.includes(KEY)); f.srv.closeAllConnections(); f.srv.close();
  f = await fake(rep, { storageFails: true }); r = await run(f.srv.address().port, ['--apply']);
  ok('storage failure: exit 1 and queue rows are KEPT', r.st === 1 && !f.calls.some(c => c.u.includes('storage_deletion_queue'))); f.srv.closeAllConnections(); f.srv.close();
  f = await fake({ deletion_queue: [], objects_without_row: Array.from({ length: 600 }, (_, i) => 'u/' + i) }); r = await run(f.srv.address().port, ['--apply']);
  ok('refuses an unusually large deletion without --max', r.st === 1 && /Refusing/.test(r.o) && !f.calls.some(c => c.m === 'DELETE')); f.srv.closeAllConnections(); f.srv.close();
  console.log(`\nCLEANUP SELF-TEST: ${total} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
