#!/usr/bin/env node
/* Fails if anything that looks like a real secret is present in the given folders (default: the repo and dist/).
 * Detects: Supabase secret keys (sb_secret_...), JWTs whose payload role is service_role, Google OAuth client
 * secrets (GOCSPX-...), Stripe-style live/test secret keys, and PEM private keys.
 * It is a safety net, not proof of absence. Never prints the secret itself. */
const fs = require('fs'), path = require('path');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'shots', '.vercel']);
const SKIP_FILES = new Set(['.env.example']);
const MAX = 3 * 1024 * 1024;

function jwtRole(tok) {
  const p = tok.split('.'); if (p.length !== 3) return null;
  try { return JSON.parse(Buffer.from(p[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role || null; } catch (e) { return null; }
}
const RULES = [
  ['Supabase secret key (sb_secret_)', /sb_secret_[A-Za-z0-9_-]{16,}/],
  ['Google OAuth client secret (GOCSPX-)', /GOCSPX-[A-Za-z0-9_-]{16,}/],
  ['Stripe/Paystack-style secret key', /\bsk_(live|test)_[A-Za-z0-9]{16,}/],
  ['PEM private key', /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
];

function scanText(text) {
  const hits = [];
  for (const [name, re] of RULES) if (re.test(text)) hits.push(name);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) {
    const r = jwtRole(m[0]); if (r === 'service_role' || r === 'supabase_admin') hits.push('JWT with role ' + r);
  }
  return hits;
}
function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f), st = fs.statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(f)) walk(p, out); }
    else if (!SKIP_FILES.has(f) && st.size <= MAX && !/\.(png|jpe?g|gif|ico|woff2?|zip|pdf|wasm)$/i.test(f)) out.push(p);
  }
  return out;
}
function scanDirs(dirs) {
  const findings = [];
  for (const d of dirs) if (fs.existsSync(d)) for (const f of walk(d, [])) {
    for (const h of scanText(fs.readFileSync(f, 'utf8'))) findings.push({ file: path.relative(process.cwd(), f), rule: h });
  }
  return findings;
}
module.exports = { scanText, scanDirs };
if (require.main === module) {
  const dirs = process.argv.slice(2); const root = path.resolve(__dirname, '..');
  const f = scanDirs(dirs.length ? dirs.map(d => path.resolve(d)) : [root]);
  if (f.length) { for (const x of f) console.error('SECRET? ' + x.rule + ' in ' + x.file); process.exit(1); }
  console.log('check-secrets: nothing suspicious found');
}
