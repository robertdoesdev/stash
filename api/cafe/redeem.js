/* POST /api/cafe/redeem   { pin: "123456" }
 * Public (the cafe computer has no login). Calls the database, which rate-limits FIRST and then atomically claims the PIN.
 * 200 {ok, url, expires_in, title, mime_type, receipt, receipt_ttl}   404 {error:"invalid"} (same for every kind of bad PIN)
 * 429 rate_limited   502 retrieval_failed (+receipt: the PIN IS used, retry via /api/cafe/refresh)   503 unavailable */
const L = require('../_lib/cafe');

module.exports = async function redeem(req, res) {
  if (!L.guard(req, res, ['POST'])) return;
  const c = L.cfg();
  if (!c) { L.log('cafe_redeem_misconfigured'); return L.send(res, 503, { ok: false, error: 'unavailable' }); }
  const body = await L.readJson(req);
  if (body.error) return L.send(res, body.error === 'too_large' ? 413 : 400, { ok: false, error: 'bad_request' });
  const pin = body.value.pin;
  if (typeof pin !== 'string' || pin.length > 12) return L.send(res, 400, { ok: false, error: 'bad_request' });

  let out;
  try { out = await L.rpc(c, 'cafe_redeem', { p_pin: pin, p_ip: L.clientHash(req, c) }); }
  catch (e) { L.log('cafe_redeem_db_error', { status: e.status || 0 }); return L.send(res, 503, { ok: false, error: 'unavailable' }); }

  if (out.status === 'rate_limited') { L.log('cafe_redeem', { result: 'rate_limited' }); return L.limited(res, out); }
  if (out.status !== 'ok') { L.log('cafe_redeem', { result: 'invalid' }); return L.send(res, 404, { ok: false, error: 'invalid' }); }

  // The PIN is now consumed. If the signed URL cannot be produced, hand back the receipt so the cafe can retry
  // WITHOUT re-opening the PIN (see /api/cafe/refresh).
  try {
    const url = await L.signedUrl(c, out.storage_path);
    L.log('cafe_redeem', { result: 'ok' });
    return L.send(res, 200, { ok: true, url, expires_in: L.SIGNED_URL_SECONDS, title: out.title, mime_type: out.mime_type, receipt: out.receipt, receipt_ttl: out.receipt_ttl });
  } catch (e) {
    L.log('cafe_redeem', { result: 'retrieval_failed' });
    return L.send(res, 502, { ok: false, error: 'retrieval_failed', title: out.title, mime_type: out.mime_type, receipt: out.receipt, receipt_ttl: out.receipt_ttl });
  }
};
