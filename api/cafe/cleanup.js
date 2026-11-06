/* GET|POST /api/cafe/cleanup  — Vercel Cron (daily). Requires "Authorization: Bearer $CRON_SECRET" (Vercel adds it
 * automatically when the CRON_SECRET environment variable is set). Expires lapsed PINs, deletes old PIN history and
 * stale throttle rows. Returns counts only. */
const L = require('../_lib/cafe');

module.exports = async function cleanup(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET, POST' });
  const c = L.cfg();
  if (!c || !c.cron) return L.send(res, 503, { ok: false, error: 'unavailable' });
  const h = String(req.headers['authorization'] || '');
  if (!h.startsWith('Bearer ') || !L.timingSafeEq(h.slice(7), c.cron)) return L.send(res, 401, { ok: false, error: 'unauthorized' });
  try {
    const out = await L.rpc(c, 'cafe_cleanup', {});
    L.log('cafe_cleanup', out);
    return L.send(res, 200, { ok: true, result: out });
  } catch (e) {
    L.log('cafe_cleanup_error', { status: e.status || 0 });
    return L.send(res, 503, { ok: false, error: 'unavailable' });
  }
};
