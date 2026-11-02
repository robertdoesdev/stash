/* TEST DOUBLE of the Phase 3 backend: documents table, private Storage bucket and the RPCs of
 * supabase/migrations/0003_documents.sql. It mirrors that migration's rules; the migration itself is verified
 * against real PostgreSQL in tests/db/docs_test.sql. It is NOT Supabase Storage.
 * Fault injection (this.cloud): failUploads / failRpc[name] = N network failures; truncate = store half the bytes;
 * corruptDownload = flip a byte on download; limit = {free, paid} (tests shrink it to exercise quota quickly). */
const crypto = require('crypto');
const MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const RPCS = new Set(['begin_upload', 'finalize_upload', 'mark_upload_failed', 'begin_delete', 'confirm_removed', 'update_document_meta', 'my_storage_usage', 'search_my_documents']);

module.exports = function install(MockServer) {
  const P = MockServer.prototype, origReset = P.reset, origRpc = P.op_rpc;
  P.reset = function () {
    origReset.call(this);
    this.docs = new Map(); this.objects = new Map(); this.entitlements = new Map(); this.queue = [];
    this.cloud = { limit: { free: 1073741824, paid: 5368709120 }, failUploads: 0, failRpc: {}, truncate: false, corruptDownload: false };
  };
  const E = (m) => ({ error: { code: 'P0001', message: m, status: 400 } });
  const J = d => ({ data: d });
  const limitOf = (s, id) => s.cloud.limit[s.entitlements.get(id) || 'free'];
  const used = (s, id) => [...s.docs.values()].filter(d => d.user_id === id)
    .reduce((n, d) => n + (d.size_bytes != null ? d.size_bytes : Math.max(d.declared_size, (s.objects.get(d.storage_path) || { size: 0 }).size)), 0);
  const view = d => JSON.parse(JSON.stringify(d));
  const clean = (a) => {
    const t = String(a.p_title || '').trim();
    if (t.length < 1 || t.length > 200 || /[\x00-\x1f]/.test(t)) return 'invalid_title';
    if (a.p_tags && (a.p_tags.length > 20 || a.p_tags.some(x => !x || x.length > 40))) return 'invalid_tags';
    if (a.p_metadata && JSON.stringify(a.p_metadata).length > 16384) return 'invalid_metadata';
    return null;
  };
  const fail = (s, name) => { if (s.cloud.failRpc[name] > 0) { s.cloud.failRpc[name]--; return true; } return false; };

  P.op_rpc = function (a) {
    const { token, name, args } = a; const u = this.userByToken(token);
    if (name === 'delete_my_account' && u) {
      for (const [id, d] of this.docs) if (d.user_id === u.id) { this.queue.push(d.storage_path); this.docs.delete(id); }
    }
    if (!RPCS.has(name)) return origRpc.call(this, a);
    if (fail(this, name)) return { __network: true };
    if (!u) return E('not_authenticated');
    return this['rpc_' + name](u, args || {});
  };

  P.rpc_begin_upload = function (u, a) {
    if (!u.confirmed) return E('email_not_verified');
    if (!MIME.includes(a.p_mime)) return E('invalid_type');
    if (!(a.p_size >= 1 && a.p_size <= 10485760)) return E('invalid_size');
    if (a.p_sha256 != null && !/^[0-9a-f]{64}$/.test(a.p_sha256)) return E('invalid_hash');
    const bad = clean(a); if (bad) return E(bad);
    for (const d of this.docs.values()) if (d.user_id === u.id && d.status === 'pending' && d.expires_at < Date.now()) { d.status = 'failed'; d.expires_at = null; }
    const ex = [...this.docs.values()].find(d => d.user_id === u.id && d.local_ref === a.p_local_ref && a.p_local_ref != null);
    const lim = limitOf(this, u.id);
    if (ex) {
      if (ex.status === 'ready') return J({ status: 'exists', document: view(ex) });
      if (ex.status === 'deleting') return J({ status: 'deleting', document: view(ex) });
      if (ex.status === 'pending') return J({ status: 'ok', resumed: true, document: view(ex) });
      const usedNow = used(this, u.id) - (ex.size_bytes != null ? ex.size_bytes : ex.declared_size);
      if (usedNow + a.p_size > lim) return J({ status: 'quota_exceeded', used: usedNow, limit: lim });
      Object.assign(ex, { status: 'pending', declared_size: a.p_size, size_bytes: null, sha256: a.p_sha256, mime_type: a.p_mime, expires_at: Date.now() + 3600e3 });
      return J({ status: 'ok', resumed: true, document: view(ex) });
    }
    if ([...this.docs.values()].filter(d => d.user_id === u.id && d.status === 'pending').length >= 20) return J({ status: 'too_many_pending' });
    const usedNow = used(this, u.id);
    if (usedNow + a.p_size > lim) return J({ status: 'quota_exceeded', used: usedNow, limit: lim });
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const row = { id, user_id: u.id, local_ref: a.p_local_ref, status: 'pending', title: String(a.p_title).trim(), original_name: a.p_original_name, mime_type: a.p_mime,
      declared_size: a.p_size, size_bytes: null, sha256: a.p_sha256, category: a.p_category, tags: a.p_tags || [], notes: a.p_notes, ocr_text: a.p_ocr_text,
      metadata: a.p_metadata || {}, storage_path: u.id + '/' + id, created_at: now, updated_at: now, uploaded_at: null, expires_at: Date.now() + 3600e3 };
    this.docs.set(id, row); return J({ status: 'ok', document: view(row) });
  };
  P.rpc_finalize_upload = function (u, a) {
    const d = this.docs.get(a.p_id); if (!d || d.user_id !== u.id) return J({ status: 'not_found' });
    if (d.status === 'ready') return J({ status: 'ok', document: view(d) });
    if (d.status !== 'pending') return J({ status: 'not_pending', document_status: d.status });
    if (d.expires_at < Date.now()) { d.status = 'failed'; d.expires_at = null; return J({ status: 'expired' }); }
    const o = this.objects.get(d.storage_path); if (!o) return J({ status: 'object_missing' });
    if (o.size !== d.declared_size || o.mimetype !== d.mime_type) { d.status = 'failed'; d.size_bytes = o.size; d.expires_at = null; return J({ status: 'size_mismatch', declared: d.declared_size, actual: o.size }); }
    Object.assign(d, { status: 'ready', size_bytes: o.size, uploaded_at: new Date().toISOString(), expires_at: null, updated_at: new Date().toISOString() });
    return J({ status: 'ok', document: view(d) });
  };
  P.rpc_mark_upload_failed = function (u, a) {
    const d = this.docs.get(a.p_id); if (!d || d.user_id !== u.id || d.status !== 'pending') return J({ status: 'not_pending' });
    d.status = 'failed'; d.expires_at = null; return J({ status: 'ok' });
  };
  P.rpc_begin_delete = function (u, a) {
    const d = this.docs.get(a.p_id); if (!d || d.user_id !== u.id) return J({ status: 'not_found' });
    d.status = 'deleting'; d.expires_at = null; return J({ status: 'ok', storage_path: d.storage_path });
  };
  P.rpc_confirm_removed = function (u, a) {
    const d = this.docs.get(a.p_id); if (!d || d.user_id !== u.id) return J({ status: 'not_found' });
    if (!['deleting', 'failed'].includes(d.status)) return J({ status: 'not_removable', document_status: d.status });
    if (this.objects.has(d.storage_path)) return J({ status: 'object_still_present' });
    this.docs.delete(d.id); return J({ status: 'ok' });
  };
  P.rpc_update_document_meta = function (u, a) {
    const bad = clean(a); if (bad) return E(bad);
    const d = this.docs.get(a.p_id); if (!d || d.user_id !== u.id || d.status !== 'ready') return J({ status: 'not_found' });
    Object.assign(d, { title: String(a.p_title).trim(), category: a.p_category, tags: a.p_tags || [], notes: a.p_notes, ocr_text: a.p_ocr_text, metadata: a.p_metadata || {}, updated_at: new Date(Date.now() + 1).toISOString() });
    return J({ status: 'ok', document: view(d) });
  };
  P.rpc_my_storage_usage = function (u) {
    return J({ used: used(this, u.id), limit: limitOf(this, u.id), tier: this.entitlements.get(u.id) || 'free', documents: [...this.docs.values()].filter(d => d.user_id === u.id && d.status === 'ready').length });
  };
  P.rpc_search_my_documents = function (u, a) {
    const terms = String(a.p_query || '').toLowerCase().slice(0, 200).split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8);
    const rows = [...this.docs.values()].filter(d => d.user_id === u.id && d.status === 'ready' && (!a.p_category || d.category === a.p_category) && terms.every(t => {
      const words = [d.title, d.original_name, d.category, (d.tags || []).join(' '), d.notes, d.ocr_text].join(' ').toLowerCase().split(/[^a-z0-9]+/);
      return words.some(w => w.startsWith(t)); }));
    return J(rows.map(r => { const v = view(r); delete v.ocr_text; delete v.search; return v; }));
  };

  // table read: RLS select-own
  P.op_docsList = function ({ token, status }) {
    const u = this.userByToken(token); if (!u) return this.err('42501', 'permission denied for table documents', 401);
    return { rows: [...this.docs.values()].filter(d => d.user_id === u.id && (!status || d.status === status)).sort((a, b) => a.created_at < b.created_at ? -1 : 1).map(view) };
  };
  // storage (policies of 0003 as code)
  const stErr = (m, c) => ({ stError: { message: m, statusCode: String(c) } });
  P.op_stUpload = function ({ token, path, b64, mimetype }) {
    const u = this.userByToken(token); if (!u) return stErr('Unauthorized', 401);
    if (this.cloud.failUploads > 0) { this.cloud.failUploads--; return { __network: true }; }
    const d = [...this.docs.values()].find(x => x.storage_path === path);
    if (!d || d.user_id !== u.id || d.status !== 'pending' || d.expires_at <= Date.now()) return stErr('new row violates row-level security policy', 403);
    if (!MIME.includes(mimetype)) return stErr('mime type not supported', 415);
    if (this.objects.has(path)) return stErr('The resource already exists', 409);
    let buf = Buffer.from(b64, 'base64'); if (buf.length > 10485760) return stErr('The object exceeded the maximum allowed size', 413);
    if (this.cloud.truncate) buf = buf.subarray(0, Math.floor(buf.length / 2));
    this.objects.set(path, { size: buf.length, mimetype, buf, owner: u.id }); return { ok: true };
  };
  P.op_stDownload = function ({ token, path }) {
    const u = this.userByToken(token); if (!u) return stErr('Unauthorized', 401);
    const o = this.objects.get(path); if (!o || o.owner !== u.id || !path.startsWith(u.id + '/')) return stErr('Object not found', 404);
    const buf = Buffer.from(o.buf); if (this.cloud.corruptDownload && buf.length) buf[0] ^= 0xff;
    return { b64: buf.toString('base64'), mimetype: o.mimetype };
  };
  P.op_stRemove = function ({ token, paths }) {
    const u = this.userByToken(token); if (!u) return stErr('Unauthorized', 401);
    const removed = [];
    for (const p of paths) {
      const d = [...this.docs.values()].find(x => x.storage_path === p);
      if (this.objects.has(p) && d && d.user_id === u.id && ['deleting', 'failed', 'pending'].includes(d.status)) { this.objects.delete(p); removed.push(p); }
    }
    return { removed };   // like Storage: silently skips what the policy hides
  };
};
