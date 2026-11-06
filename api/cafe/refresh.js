/* POST /api/cafe/refresh   { receipt: "<64 hex>" }
 * Retry after a failed download/print FOR THE SAME already-redeemed document. Needs the receipt returned by /redeem
 * (256-bit random, stored hashed, 5 minute life, at most 3 uses). It never re-opens the PIN. */
const L = require('../_lib/cafe');

module.exports = async function refresh(req, res) {
  if (!L.guard(req, res, ['POST'])) return;
  const c = L.cfg();
  if (!c) { L.log('cafe_refresh_misconfigured'); return L.send(res, 503, { ok: false, error: 'unavailable' }); }
  const body = await L.readJson(req);
  if (body.error) return L.send(res, body.error === 'too_large' ? 413 : 400, { ok: false, error: 'bad_request' });
  const receipt = body.value.receipt;
  if (typeof receipt !== 'string' || receipt.length > 128) return L.send(res, 400, { ok: false, error: 'bad_request' });

  let out;
  try { out = await L.rpc(c, 'cafe_refresh', { p_receipt: receipt, p_ip: L.clientHash(req, c) }); }
  catch (e) { L.log('cafe_refresh_db_error', { status: e.status || 0 }); return L.send(res, 503, { ok: false, error: 'unavailable' }); }

  if (out.status === 'rate_limited') return L.limited(res, out);
  if (out.status !== 'ok') return L.send(res, 404, { ok: false, error: 'invalid' });
  try {
    const url = await L.signedUrl(c, out.storage_path);
    return L.send(res, 200, { ok: true, url, expires_in: L.SIGNED_URL_SECONDS, title: out.title, mime_type: out.mime_type, refreshes_left: out.refreshes_left });
  } catch (e) {
    return L.send(res, 502, { ok: false, error: 'retrieval_failed', refreshes_left: out.refreshes_left });
  }
};
