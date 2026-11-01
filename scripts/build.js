#!/usr/bin/env node
/* Stash build: copies the static site to ./dist and writes dist/env-config.js
 * from environment variables. No dependencies.
 *
 * Reads (public values only):
 *   SUPABASE_URL        https://<project-ref>.supabase.co
 *   SUPABASE_ANON_KEY   the project's anon / publishable key
 * It REFUSES to build if the key looks like a service-role / secret key, so a
 * secret cannot be shipped to browsers by a copy-paste mistake.
 *
 * Also: checks the key belongs to the same project as the URL, forbids localhost/http on production,
 * verifies vendor/ against vendor.lock.json, and scans the repo and dist/ for secrets.
 * Flag --skip-vendor-check is honoured ONLY off Vercel (local development before vendoring).
 */
const fs = require('fs');
const path = require('path');
const { verify: verifyVendor } = require('./vendor-deps');
const { scanDirs } = require('./check-secrets');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SITE_FILES = ['index.html', 'styles.css', 'landing.css', 'script.js', 'auth.js', 'data.json', 'manifest.json'];
const SITE_DIRS = ['assets', 'vendor', 'fonts']; // optional; copied if present

function fail(msg) { console.error('\nBUILD ERROR: ' + msg + '\n'); process.exit(1); }

function jwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch (e) { return null; }
}
function jwtRole(token) { const p = jwtPayload(token); return p && p.role || null; }
const refOf = u => (u.match(/^https:\/\/([a-z0-9-]+)\.supabase\.(?:co|in)$/i) || [])[1] || null;

function checkConfig(url, key, vercelEnv) {
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
  if (!refOf(url) && !isLocal) fail('SUPABASE_URL must look like https://<project-ref>.supabase.co (got a different shape).');
  if (isLocal && process.env.VERCEL) fail('SUPABASE_URL points at localhost, which cannot work on a deployed site.');
  if (/^sb_secret_/.test(key) || jwtRole(key) === 'service_role') {
    fail('SUPABASE_ANON_KEY contains a SECRET (service-role) key. Use the public anon/publishable key. Rotate the secret key in Supabase if it was pasted anywhere public.');
  }
  if (!/^sb_publishable_/.test(key) && jwtRole(key) !== 'anon') fail('SUPABASE_ANON_KEY is not recognised as an anon/publishable key.');
  const pl = jwtPayload(key);                       // legacy anon keys are JWTs and carry the project ref
  if (pl) {
    if (pl.ref && refOf(url) && pl.ref !== refOf(url)) fail('SUPABASE_ANON_KEY belongs to project "' + pl.ref + '" but SUPABASE_URL is project "' + refOf(url) + '". Dev and prod values are mixed up.');
    if (pl.exp && pl.exp * 1000 < Date.now()) fail('SUPABASE_ANON_KEY has expired.');
  }
  if (vercelEnv === 'production' && process.env.STASH_PROD_SUPABASE_REF && refOf(url) !== process.env.STASH_PROD_SUPABASE_REF)
    fail('Production build is not using the production Supabase project (STASH_PROD_SUPABASE_REF mismatch).');
}

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) copyRecursive(path.join(src, f), path.join(dest, f));
  } else fs.copyFileSync(src, dest);
}

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_ANON_KEY || '').trim();
const onVercel = !!process.env.VERCEL;

if (!url || !key) {
  if (onVercel) fail('SUPABASE_URL and SUPABASE_ANON_KEY must be set in Vercel (Project > Settings > Environment Variables) for this environment.');
  console.warn('WARNING: SUPABASE_URL / SUPABASE_ANON_KEY not set. The app will build but sign-in will show "not configured".');
} else checkConfig(url, key, process.env.VERCEL_ENV);
console.log('Build environment: ' + (process.env.VERCEL_ENV || (onVercel ? 'vercel' : 'local')) + '; Supabase project: ' + (refOf(url) || (url ? 'local' : 'none')));

// Dependency integrity: the page loads vendor/supabase.js, so it must be the pinned, hashed file.
if (/src="vendor\/supabase\.js"/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))) {
  const v = verifyVendor(ROOT);
  if (!v.ok) {
    if (!onVercel && process.argv.includes('--skip-vendor-check')) console.warn('WARNING (vendor check skipped, local only): ' + v.problem);
    else fail('Vendored Supabase client check failed: ' + v.problem);
  } else console.log('Vendored dependency verified against vendor.lock.json');
}

// Secret scan of the source tree (before copying anything).
{ const f = scanDirs([ROOT]); if (f.length) fail('Possible secret committed:\n  ' + f.map(x => x.rule + ' in ' + x.file).join('\n  ')); }

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
for (const f of SITE_FILES) {
  if (!fs.existsSync(path.join(ROOT, f))) fail('Missing site file: ' + f);
  fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
}
for (const d of SITE_DIRS) if (fs.existsSync(path.join(ROOT, d))) copyRecursive(path.join(ROOT, d), path.join(DIST, d));

const cfg = { SUPABASE_URL: url, SUPABASE_ANON_KEY: key };
fs.writeFileSync(path.join(DIST, 'env-config.js'),
  '// Generated by scripts/build.js. Public values only.\nwindow.STASH_ENV = ' + JSON.stringify(cfg) + ';\n');
{ const f = scanDirs([DIST]); if (f.length) fail('Possible secret in build output:\n  ' + f.map(x => x.rule + ' in ' + x.file).join('\n  ')); }
console.log('Built to dist/ (' + (url ? 'Supabase configured' : 'Supabase NOT configured') + ').');
