/* Shared helpers for the Cafe Print endpoints (Vercel Node functions, CommonJS, zero dependencies).
 * SECURITY RULES kept here in one place:
 *   - The Supabase SERVICE ROLE key is read from the server environment only. It never reaches a response or a log.
 *   - Nothing sensitive is logged: no PIN, receipt, signed URL, storage path, document title or raw IP.
 *   - Every response is "Cache-Control: no-store". Only POST (and GET for the cron) are accepted. Same-origin only.
 *   - Invalid / expired / revoked / used / unavailable PINs all produce the SAME response. */
const crypto = require('crypto');

const SIGNED_URL_SECONDS = 90;      // lifetime of the signed URL for the ONE document
const MAX_BODY = 2048;              // bytes
const DB_TIMEOUT_MS = 8000;

function cfg() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !key) return null;
  let u; try { u = new URL(url); } catch (e) { return null; }
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.protocol !== 'https:' && !local) return null;           // plain http only for local tests
  return { url, key, salt: String(process.env.CAFE_IP_SALT || ''), cron: String(process.env.CRON_SECRET || '') };
}

function send(res, status, body, extra) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (extra) for (const k of Object.keys(extra)) res.setHeader(k, extra[k]);
  res.end(JSON.stringify(body));
}

function log(evt, fields) {   // structured, non-sensitive only
  try { console.log(JSON.stringify(Object.assign({ evt }, fields || {}))); } catch (e) { /* ignore */ }
}

/* Same-origin check: browsers send Origin on POST. A foreign origin is refused; non-browser callers (no Origin) are
 * still subject to the database rate limits. */
function sameOrigin(req) {
  const origin = req.headers['origin'];
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  try { return new URL(origin).host === host; } catch (e) { return false; }
}

function readJson(req) {
  return new Promise((resolve) => {
    const ct = String(req.headers['content-type'] || '');
    if (!/^application\/json\b/i.test(ct)) return resolve({ error: 'bad_request' });
    if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return resolve(JSON.stringify(req.body).length > MAX_BODY ? { error: 'too_large' } : { value: req.body });
    }
    let size = 0, over = false; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { over = true; } else chunks.push(c); });   // keep draining, never buffer more
    req.on('end', () => { if (over) return resolve({ error: 'too_large' }); try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' && !Array.isArray(v) ? { value: v } : { error: 'bad_request' }); } catch (e) { resolve({ error: 'bad_request' }); } });
    req.on('error', () => resolve({ error: 'bad_request' }));
  });
}

/* Client fingerprint for throttling: salted hash of the caller IP (IPv6 reduced to its /64 so rotating inside one
 * allocation does not defeat the limit). The raw IP is never stored or logged. Returns the bytea hex literal. */
function clientHash(req, c) {
  let ip = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
  if (!ip) ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (!ip) ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  ip = ip.replace(/^::ffff:/, '');
  if (ip.includes(':')) {
    const parts = ip.split('::'); const head = parts[0] ? parts[0].split(':') : []; const tail = parts[1] ? parts[1].split(':') : [];
    const full = parts.length === 2 ? head.concat(Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), tail) : head;
    ip = full.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
  }
  const salt = c.salt || crypto.createHash('sha256').update('cafe-ip:' + c.key).digest('hex');
  return '\\x' + crypto.createHmac('sha256', salt).update(ip).digest('hex');
}

async function http(url, opts) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), DB_TIMEOUT_MS);
  try { return await fetch(url, Object.assign({}, opts, { signal: ac.signal })); } finally { clearTimeout(t); }
}

async function rpc(c, name, args) {
  const r = await http(c.url + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(args)
  });
  if (!r.ok) { const e = new Error('rpc_failed'); e.status = r.status; throw e; }
  return r.json();
}

/* A short-lived signed URL for exactly one object. It grants no listing and no access to anything else. */
async function signedUrl(c, storagePath) {
  if (typeof storagePath !== 'string' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(storagePath)) throw new Error('bad_path');
  const r = await http(c.url + '/storage/v1/object/sign/documents/' + storagePath.split('/').map(encodeURIComponent).join('/'), {
    method: 'POST',
    headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS })
  });
  if (!r.ok) throw new Error('sign_failed');
  const j = await r.json(); let s = j && (j.signedURL || j.signedUrl);
  if (!s) throw new Error('sign_failed');
  if (/^https?:\/\//i.test(s)) { if (!s.startsWith(c.url + '/')) throw new Error('sign_failed'); return s; }
  if (s.startsWith('/storage/v1')) s = s.slice('/storage/v1'.length);
  return c.url + '/storage/v1' + (s.startsWith('/') ? s : '/' + s);
}

function guard(req, res, methods) {
  if (!methods.includes(req.method)) { send(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: methods.join(', ') }); return false; }
  if (!sameOrigin(req)) { send(res, 403, { ok: false, error: 'forbidden' }); return false; }
  return true;
}

function limited(res, out) {
  const wait = Math.max(1, Math.min(3600, parseInt(out.retry_after, 10) || 60));
  send(res, 429, { ok: false, error: 'rate_limited', retry_after: wait }, { 'Retry-After': String(wait) });
}

function timingSafeEq(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

module.exports = { SIGNED_URL_SECONDS, cfg, send, log, readJson, clientHash, rpc, signedUrl, guard, limited, timingSafeEq };
