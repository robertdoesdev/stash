/* Stash cloud storage (Phase 3). Vanilla JS, no dependencies.
 *
 * Wraps the app's two existing storage seams instead of changing any screen:
 *   DB.saveDocuments  -> after the local save, diffs the list and queues cloud work
 *   FileStore.get     -> falls back to downloading from private cloud storage when the file is not on this device
 *
 * Principles
 *  - Opt-in per account (a confirmation in Settings). Nothing is uploaded before that.
 *  - Local copies are NEVER deleted by sync. A document counts as verified only after the cloud copy was
 *    downloaded back and its size and SHA-256 matched the local file.
 *  - The server (migration 0003) is the authority on ownership and quota; this file only reacts to its answers.
 *  - Failure is normal: every step is retried with backoff, is idempotent (local_ref), and leaves state that the
 *    next sync can resume. No password, token or file content is ever logged.
 */
(function () {
  'use strict';
  const BUCKET = 'documents', PAGE = 500, MAX_TRIES = 5;
  const H = { DB: null, FileStore: null, toast: function () {} };
  const running = new Set();
  const listeners = new Set();
  let localOnlyDepth = 0;

  /* ------------------------------------------------------------ persisted per-user sync state */
  const key = uid => 'stash_cloud_v1_' + uid;
  function load(uid) {
    try { const s = JSON.parse(localStorage.getItem(key(uid)) || 'null'); if (s && s.map) { s.deletes = s.deletes || []; return s; } } catch (e) { /* fall through */ }
    return { enabled: false, map: {}, deletes: [], lastPull: null };
  }
  function save(uid, st) { try { localStorage.setItem(key(uid), JSON.stringify(st)); } catch (e) { /* storage full: state is rebuilt on next sync */ } }

  function client() { return window.StashAuth && window.StashAuth.getClient ? window.StashAuth.getClient() : null; }
  function signedIn(uid) { const s = window.StashAuth && window.StashAuth.state; return !!(s && s.user && s.user.id === uid && client()); }
  function available(uid) { return signedIn(uid) && (typeof navigator === 'undefined' || navigator.onLine !== false); }

  /* ------------------------------------------------------------ small helpers */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function isTransient(e) {
    if (!e) return false;
    const st = Number(e.status || e.statusCode || (e.originalError && e.originalError.status));
    return /failed to fetch|network|timeout|load failed|fetch/i.test(String(e.message || '')) || [408, 425, 429, 500, 502, 503, 504].includes(st);
  }
  async function withRetry(fn, tries) {
    let last;
    for (let i = 0; i < (tries || 3); i++) {
      try { return await fn(); } catch (e) { last = e; if (!isTransient(e) || i === (tries || 3) - 1) throw e; await sleep(Math.min(400 * Math.pow(2, i), 4000)); }
    }
    throw last;
  }
  async function rpc(name, args) {
    const { data, error } = await client().rpc(name, args || {});
    if (error) { const e = new Error(error.message || name); e.status = error.status; e.code = error.code; throw e; }
    return data;
  }
  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16) + ':' + str.length; }
  async function sha256Hex(blob) {
    if (!(window.crypto && crypto.subtle)) return null;
    const buf = await blob.arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function mime(blob, doc) {
    const t = String(blob.type || doc.fileType || '').toLowerCase();
    return t === 'image/jpg' ? 'image/jpeg' : t;
  }

  /* ------------------------------------------------------------ mapping local doc <-> cloud row */
  const TYPED = new Set(['id', 'size', 'fileType', 'hasFile', 'name', 'originalFilename', 'category', 'tags', 'notes', 'ocrText', 'fileData']);
  function metaOf(doc) {
    const m = {};
    Object.keys(doc).forEach(k => { if (!TYPED.has(k) && doc[k] !== undefined && typeof doc[k] !== 'function') m[k] = doc[k]; });
    return m;
  }
  function payload(doc) {
    return {
      p_title: String(doc.name || doc.originalFilename || 'Untitled').slice(0, 200).replace(/[\u0000-\u001f\u007f]/g, ' ').trim() || 'Untitled',
      p_category: doc.category ? String(doc.category).slice(0, 60) : null,
      p_tags: Array.isArray(doc.tags) ? doc.tags.map(t => String(t).slice(0, 40)).filter(Boolean).slice(0, 20) : [],
      p_notes: doc.notes ? String(doc.notes).slice(0, 5000) : null,
      p_ocr_text: doc.ocrText ? String(doc.ocrText).slice(0, 200000) : null,
      p_metadata: metaOf(doc)
    };
  }
  const hashOf = doc => { const p = payload(doc); return fnv(JSON.stringify([p.p_title, p.p_category, p.p_tags, p.p_notes, p.p_ocr_text, p.p_metadata])); };
  function docFromRow(r) {
    return Object.assign({ autoFilled: [], course: '', level: '', semester: '', referenceType: '', referenceNumber: '', amount: 0, date: '', institution: '',
      extractedStudentId: '', academicSession: '', ocrStatus: 'skipped', textSource: 'none' }, r.metadata || {}, {
      id: r.local_ref || r.id, name: r.title, originalFilename: r.original_name, category: r.category || '', tags: r.tags || [], notes: r.notes || '',
      size: r.size_bytes, fileType: r.mime_type, uploadedAt: r.uploaded_at || r.created_at, modifiedAt: r.updated_at, hasFile: true, ocrText: r.ocr_text || '' });
  }

  /* ------------------------------------------------------------ one document: upload + verify */
  async function removeObjectQuietly(path) { try { await client().storage.from(BUCKET).remove([path]); } catch (e) { /* cleaned by a later sync */ } }

  async function uploadFlow(uid, doc, e) {
    const blob = await H.FileStore.getLocal(doc.id);
    if (!blob) { e.state = 'error'; e.err = 'no_local_file'; e.tries = MAX_TRIES; return; }
    const type = mime(blob, doc);
    const sha = await sha256Hex(blob);
    const args = Object.assign({ p_local_ref: doc.id, p_original_name: String(doc.originalFilename || doc.name || 'file').slice(0, 255).replace(/[\u0000-\u001f\u007f]/g, ' '),
      p_mime: type, p_size: blob.size, p_sha256: sha }, payload(doc));
    for (let round = 0; round < 2; round++) {
      let r = await withRetry(() => rpc('begin_upload', args));
      if (r.status === 'quota_exceeded') { e.state = 'blocked'; e.err = 'quota_exceeded'; e.usage = { used: r.used, limit: r.limit }; return; }
      if (r.status === 'too_many_pending' || r.status === 'deleting') { e.state = 'error'; e.err = r.status; return; }
      const row = r.document; e.cid = row.id; e.path = row.storage_path;
      if (r.status === 'exists') { e.finalized = true; e.state = 'synced'; e.hash = hashOf(doc); e.sha256 = sha; e.verifiedAt = e.verifiedAt || null; await verify(uid, doc, e, blob, sha); return; }

      const up = await withRetry(async () => {
        const res = await client().storage.from(BUCKET).upload(row.storage_path, blob, { contentType: type, upsert: false, cacheControl: '3600' });
        if (res.error && !/already exists|duplicate|409/i.test(String(res.error.message) + String(res.error.statusCode))) {
          const er = new Error(res.error.message || 'upload failed'); er.status = res.error.statusCode || res.error.status; throw er;
        }
        return res;
      }, 3);
      void up;
      const f = await withRetry(() => rpc('finalize_upload', { p_id: row.id }));
      if (f.status === 'ok') { e.finalized = true; e.state = 'synced'; e.err = null; e.hash = hashOf(doc); e.sha256 = sha; await verify(uid, doc, e, blob, sha); return; }
      // Anything else: clean up the bad object and, once, start again from a fresh reservation.
      await removeObjectQuietly(row.storage_path);
      if (f.status === 'size_mismatch' || f.status === 'object_missing' || f.status === 'expired') { await rpc('confirm_removed', { p_id: row.id }).catch(function () {}); continue; }
      await rpc('mark_upload_failed', { p_id: row.id }).catch(function () {});
      e.state = 'error'; e.err = f.status; return;
    }
    e.state = 'error'; e.err = 'upload_failed';
  }

  async function verify(uid, doc, e, blob, sha) {
    try {
      const { data, error } = await client().storage.from(BUCKET).download(e.path);
      if (error || !data) throw new Error('download failed');
      const same = data.size === blob.size && (!sha || (await sha256Hex(data)) === sha);
      if (same) { e.verifiedAt = new Date().toISOString(); e.err = null; }
      else { e.state = 'error'; e.err = 'verification_failed'; e.verifiedAt = null; }
    } catch (er) { e.verifiedAt = null; e.err = 'verification_pending'; }   // stays 'synced' but unverified; retried on next sync
  }

  async function metaFlow(uid, doc, e) {
    const p = payload(doc);
    const r = await withRetry(() => rpc('update_document_meta', Object.assign({ p_id: e.cid }, p)));
    if (r.status === 'ok') { e.state = 'synced'; e.hash = hashOf(doc); e.err = null; return; }
    e.cid = null; e.finalized = false; e.state = 'queued'; e.err = null;   // row vanished: upload again
  }

  async function processDoc(uid, doc, force) {
    const st0 = load(uid); const e = st0.map[doc.id]; if (!e) return;
    if (e.state === 'blocked' && !force) return;
    if (e.state === 'error' && !force && ((e.tries || 0) >= MAX_TRIES || Date.now() - (e.lastTry || 0) < 30000)) return;
    e.lastTry = Date.now();
    try {
      if (e.finalized && e.cid) {
        if (e.state === 'dirty' || e.state === 'error') await metaFlow(uid, doc, e);
        if (e.state === 'synced' && !e.verifiedAt) { const b = await H.FileStore.getLocal(doc.id); if (b) await verify(uid, doc, e, b, e.sha256 || await sha256Hex(b)); }
      } else { await uploadFlow(uid, doc, e); }
      if (e.state === 'synced') e.tries = 0;
    } catch (er) {
      e.state = 'error'; e.tries = (e.tries || 0) + 1; e.err = isTransient(er) ? 'network' : String(er.message || 'error').slice(0, 120);
    }
    const st = load(uid);
    if (st.map[doc.id]) { st.map[doc.id] = e; save(uid, st); }
    else if (e.cid) { st.deletes.push({ cid: e.cid, tries: 0 }); save(uid, st); }   // deleted locally while uploading: don't leave it in the cloud
  }

  /* ------------------------------------------------------------ deletes (two-phase, resumable) */
  async function runDeletes(uid) {
    let st = load(uid);
    for (const item of st.deletes.slice()) {
      try {
        const b = await withRetry(() => rpc('begin_delete', { p_id: item.cid }));
        if (b.status === 'ok') {
          await withRetry(async () => { const rm = await client().storage.from(BUCKET).remove([b.storage_path]); if (rm.error) throw Object.assign(new Error(rm.error.message), { status: rm.error.statusCode }); });
          const c = await withRetry(() => rpc('confirm_removed', { p_id: item.cid }));
          if (c.status !== 'ok' && c.status !== 'not_found') throw new Error(c.status);
        }
        st = load(uid); st.deletes = st.deletes.filter(x => x.cid !== item.cid); save(uid, st);
      } catch (er) { item.tries = (item.tries || 0) + 1; st = load(uid); st.deletes = st.deletes.map(x => x.cid === item.cid ? item : x); save(uid, st); }
    }
  }

  /* ------------------------------------------------------------ pull: bring cloud-only docs onto this device */
  async function pull(uid) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client().from('documents').select('*').eq('status', 'ready').order('created_at', { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push.apply(rows, data || []); if (!data || data.length < PAGE) break;
    }
    const local = await H.DB.getDocuments(uid); const byId = new Map(local.map(d => [d.id, d]));
    const st = load(uid); const add = [];
    const cloudIds = new Set(rows.map(r => r.id));
    for (const r of rows) {
      const lid = r.local_ref || r.id; const known = byId.get(lid);
      if (!known) {
        const d = docFromRow(r); add.push(d);
        st.map[d.id] = { cid: r.id, path: r.storage_path, state: 'synced', finalized: true, hash: hashOf(d), sha256: r.sha256 || null, verifiedAt: null, cloudUpdatedAt: r.updated_at };
      } else {
        const e = st.map[lid];
        if (e && e.cid === r.id && e.state === 'synced' && r.updated_at > (e.cloudUpdatedAt || '')) {   // edited on another device and not edited here
          const d = Object.assign(known, docFromRow(r), { id: known.id }); e.hash = hashOf(d); e.cloudUpdatedAt = r.updated_at; add.push(d);
        } else if (e && e.cid === r.id) { e.cloudUpdatedAt = e.cloudUpdatedAt || r.updated_at; }
      }
    }
    // Deleted elsewhere: keep the local copy, just flag it. Sync never removes local data.
    Object.keys(st.map).forEach(id => { const e = st.map[id]; if (e.cid && e.state === 'synced' && !cloudIds.has(e.cid)) e.missingInCloud = true; else if (e.cid) e.missingInCloud = false; });
    st.lastPull = new Date().toISOString(); save(uid, st);
    if (add.length) {
      const merged = local.map(d => add.find(a => a.id === d.id) || d);
      add.forEach(a => { if (!byId.has(a.id)) merged.unshift(a); });
      await H.DB._saveDocumentsRaw(uid, merged);
    }
    return add.length;
  }

  /* ------------------------------------------------------------ orchestration */
  async function pump(uid, force, doPull) {
    if (running.has(uid) || !available(uid)) return;
    running.add(uid); emit(uid);
    try {
      const st = load(uid); if (!st.enabled) return;
      await runDeletes(uid);
      if (doPull) await pull(uid).catch(() => {});
      const docs = await H.DB.getDocuments(uid);
      for (const d of docs) { await processDoc(uid, d, force); }
      const fin = load(uid);
      const blocked = Object.values(fin.map).filter(e => e.state === 'blocked').length;
      if (blocked && !fin.toldBlocked) { fin.toldBlocked = true; save(uid, fin); H.toast('Cloud storage is full — ' + blocked + ' file' + (blocked === 1 ? ' stays' : 's stay') + ' on this device only.'); }
      if (!blocked && fin.toldBlocked) { fin.toldBlocked = false; save(uid, fin); }
    } finally { running.delete(uid); emit(uid); }
  }
  const timers = {};
  function schedule(uid, delay, doPull) { clearTimeout(timers[uid]); timers[uid] = setTimeout(() => { pump(uid, false, !!doPull).catch(() => {}); }, delay == null ? 400 : delay); }

  function reconcileLocal(uid, docs) {
    const st = load(uid); if (!st.enabled) return;
    const ids = new Set(docs.map(d => d.id));
    docs.forEach(d => {
      const e = st.map[d.id];
      if (!e) st.map[d.id] = { state: 'queued', tries: 0 };
      else if (e.state === 'synced' && e.hash !== hashOf(d)) e.state = 'dirty';
    });
    Object.keys(st.map).forEach(id => {
      if (ids.has(id)) return;
      const e = st.map[id];
      if (e.cid && localOnlyDepth === 0 && e.finalized) st.deletes.push({ cid: e.cid, tries: 0 });
      else if (e.cid && localOnlyDepth === 0) st.deletes.push({ cid: e.cid, tries: 0 });   // unfinalized upload: remove the half-made object too
      delete st.map[id];
    });
    save(uid, st);
    schedule(uid);
  }

  /* ------------------------------------------------------------ public API */
  const emit = uid => listeners.forEach(fn => { try { fn(uid); } catch (e) { /* ignore */ } });

  function attach(helpers) {
    if (H.DB) return;
    H.DB = helpers.DB; H.FileStore = helpers.FileStore; H.toast = helpers.toast || H.toast;
    const origSave = H.DB.saveDocuments.bind(H.DB);
    H.DB._saveDocumentsRaw = origSave;
    H.DB.saveDocuments = async function (uid, docs) { const r = await origSave(uid, docs); try { reconcileLocal(uid, docs); } catch (e) { /* never block local saves */ } return r; };
    const fs = H.FileStore; const origGet = fs.get.bind(fs);
    fs.getLocal = origGet;
    fs.get = async function (id) {
      const local = await origGet(id).catch(() => null); if (local) return local;
      const uid = window.StashAuth && window.StashAuth.state.user && window.StashAuth.state.user.id; if (!uid) return null;
      const e = load(uid).map[id]; if (!e || !e.path || !available(uid)) return null;
      try {
        const { data, error } = await withRetry(async () => { const r = await client().storage.from(BUCKET).download(e.path); if (r.error) throw Object.assign(new Error(r.error.message), { status: r.error.statusCode }); return r; });
        if (error || !data) return null;
        await fs.put(id, data).catch(() => {});      // cache on this device
        return data;
      } catch (er) { return null; }
    };
    window.addEventListener('online', () => { const s = window.StashAuth && window.StashAuth.state; if (s && s.user) schedule(s.user.id, 1000, true); });
  }

  const api = {
    attach, available,
    isEnabled: uid => !!load(uid).enabled,
    async enable(uid) {                       // explicit opt-in; queues every existing local document
      const st = load(uid); st.enabled = true; save(uid, st);
      reconcileLocal(uid, await H.DB.getDocuments(uid));
      return pump(uid, true, true);
    },
    disable(uid) { const st = load(uid); st.enabled = false; save(uid, st); emit(uid); },
    syncNow(uid) { return pump(uid, true, true); },
    start(uid) { if (load(uid).enabled) schedule(uid, 800, true); },
    async localOnly(fn) { localOnlyDepth++; try { return await fn(); } finally { localOnlyDepth--; } },
    async usage() { return rpc('my_storage_usage'); },
    /* Cafe Print (server-authoritative; PINs are made and stored by the database, never in the browser). */
    cafe: {
      async docs() {            // only documents the SERVER says are fully uploaded
        const { data, error } = await client().from('documents').select('id,title,local_ref,status').eq('status', 'ready').order('title');
        if (error) { const e = new Error(error.message || 'documents'); e.status = error.status; throw e; }
        return data || [];
      },
      create(documentId) { return rpc('cafe_create_pin', { p_document_id: documentId }); },
      list() { return rpc('cafe_my_pins'); },
      revoke(id) { return rpc('cafe_revoke_pin', { p_id: id }); }
    },
    async search(query, category) { return rpc('search_my_documents', { p_query: query || '', p_category: category || null, p_limit: 100, p_offset: 0 }); },
    async purgeAllForAccountDeletion(uid) {   // best effort; the server also queues anything left
      try {
        const { data } = await client().from('documents').select('id,storage_path');
        for (const r of data || []) { try { await rpc('begin_delete', { p_id: r.id }); } catch (e) { /* ignore */ } }
        const paths = (data || []).map(r => r.storage_path);
        for (let i = 0; i < paths.length; i += 100) await client().storage.from(BUCKET).remove(paths.slice(i, i + 100));
      } catch (e) { /* server-side queue covers the rest */ }
    },
    status(uid) {
      const st = load(uid); const c = { total: 0, synced: 0, verified: 0, waiting: 0, failed: 0, blocked: 0, missingInCloud: 0, deleting: st.deletes.length, running: running.has(uid), enabled: !!st.enabled };
      Object.values(st.map).forEach(e => {
        c.total++;
        if (e.state === 'synced') { c.synced++; if (e.verifiedAt) c.verified++; }
        else if (e.state === 'blocked') c.blocked++;
        else if (e.state === 'error') c.failed++;
        else c.waiting++;
        if (e.missingInCloud) c.missingInCloud++;
      });
      return c;
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    _load: load
  };

  /* ------------------------------------------------------------ Settings row (uses the existing markup) */
  function fmtBytes(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(2).replace(/\.?0+$/, '') + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1).replace(/\.0$/, '') + ' MB' : Math.ceil(n / 1024) + ' KB'; }
  let uidOf = () => null;
  async function refreshUI(uid) {
    const t = document.getElementById('cloudToggle'); if (!t || !uid) return;
    const s = api.status(uid), txt = document.getElementById('cloudStatusText'), use = document.getElementById('cloudUsageText'), btn = document.getElementById('cloudSyncBtn');
    t.checked = s.enabled; btn.classList.toggle('hidden', !s.enabled);
    if (!s.enabled) { txt.textContent = 'Back up your documents to private storage tied to your account. A copy always stays on this device.'; use.textContent = ''; return; }
    const parts = [];
    if (s.running) parts.push('Syncing\u2026');
    parts.push(s.verified + ' of ' + s.total + ' document' + (s.total === 1 ? '' : 's') + ' backed up and verified');
    if (s.waiting) parts.push(s.waiting + ' waiting');
    if (s.failed) parts.push(s.failed + ' will retry');
    if (s.blocked) parts.push(s.blocked + ' not backed up \u2014 storage full');
    if (s.missingInCloud) parts.push(s.missingInCloud + ' no longer in the cloud (kept here)');
    txt.textContent = parts.join(' \u00b7 ');
    use.textContent = '';
    if (available(uid)) { try { const u = await rpc('my_storage_usage'); if (uidOf() === uid) use.textContent = fmtBytes(u.used) + ' of ' + fmtBytes(u.limit) + ' used'; } catch (e) { /* offline */ } }
  }
  api.refreshUI = refreshUI;
  api.forget = uid => { try { localStorage.removeItem(key(uid)); } catch (e) { /* ignore */ } };
  api.bindUI = function (getUid) {
    uidOf = getUid;
    const t = document.getElementById('cloudToggle'), btn = document.getElementById('cloudSyncBtn'); if (!t || t.dataset.bound) return; t.dataset.bound = '1';
    t.addEventListener('change', async function () {
      const uid = getUid(); if (!uid) return;
      if (t.checked) {
        if (!window.confirm('Back up your documents to your Stash account?\n\nFiles are uploaded to private storage that only you can open. A copy always stays on this device, and nothing is removed from it.')) { t.checked = false; return; }
        if (!available(uid)) { t.checked = false; H.toast('You need to be online and signed in to turn on cloud storage.'); return; }
        api.enable(uid).then(function () { refreshUI(uid); });
      } else { api.disable(uid); H.toast('Cloud backup paused. Your cloud copies are kept.'); }
      refreshUI(uid);
    });
    btn.addEventListener('click', function () { const uid = getUid(); if (uid) pump(uid, true, true).then(function () { refreshUI(uid); }); });
    api.onChange(function (uid) { if (uid === getUid()) refreshUI(uid); });
  };
  window.StashCloud = api;
})();
