/* Phase 3 browser tests: real app code (script.js, auth.js, cloud.js) against the Supabase test double extended with
 * Storage + documents (mock-cloud.js). Classification: automated/mocked. NOT real Supabase Storage. */
const { chromium } = require('playwright'); const crypto = require('crypto');
const { MockServer, installBackend, BASE, U } = require('./harness');
const results = []; let current = '';
const ok = (n, c, x) => { results.push({ t: current, n, pass: !!c }); console.log((c ? '  PASS ' : '  FAIL ') + n + (c ? '' : (x ? '  -> ' + x : ''))); };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const hash = p => p.evaluate(() => location.hash);
const waitHash = (p, h, t = 5000) => p.waitForFunction(x => location.hash === x, h, { timeout: t }).then(() => true, () => false);
const ready = p => p.waitForFunction(() => window.StashAuth && window.StashAuth.state.ready);
const open = async (p, h = '') => { await p.goto(BASE + h); await ready(p); await p.waitForTimeout(150); };
const bytes = (tag, n = 600) => Buffer.concat([Buffer.from('%PDF-1.4\n' + tag + '\n'), crypto.randomBytes(n)]);

async function mk(browser, server, ctx) {
  const c = ctx || await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await c.newPage(); page.on('dialog', d => d.accept()); page.errs = []; page.on('pageerror', e => page.errs.push(e.message));
  page.logs = []; page.on('console', m => page.logs.push(m.text())); await installBackend(page, server); return { ctx: c, page };
}
async function signup(page, s, v = U) {
  await open(page, '#signup');
  await page.fill('#suName', v.name); await page.fill('#suMatric', v.matric); await page.selectOption('#suLevel', v.level);
  await page.fill('#suEmail', v.email); await page.fill('#suPassword', v.pw); await page.fill('#suConfirmPassword', v.pw);
  await page.click('#signupForm button[type=submit]'); await page.waitForTimeout(300);
  await page.goto([...s.mail].reverse().find(m => m.kind === 'signup' && m.to === v.email).link); await waitHash(page, '#dashboard');
}
async function login(page, v = U) { await open(page, '#login'); await page.fill('#loginId', v.email); await page.fill('#loginPassword', v.pw); await page.click('#loginForm button[type=submit]'); await waitHash(page, '#dashboard'); }
const uidOf = p => p.evaluate(() => StashAuth.state.user.id);
async function addFiles(page, files) {
  await open(page, '#upload'); await page.waitForTimeout(300);
  await page.locator('input[type=file]').first().setInputFiles(files.map(f => ({ name: f.name, mimeType: f.type || 'application/pdf', buffer: f.buf })));
  await page.waitForTimeout(1200 + files.length * 300);
}
const localDocs = p => p.evaluate(async () => (await DB.getDocuments(StashAuth.state.user.id)).map(d => ({ id: d.id, name: d.name })));
const localBlob = (p, id) => p.evaluate(async id => { const b = await FileStore.getLocal(id); if (!b) return null; const u = new Uint8Array(await b.arrayBuffer()); let s = ''; u.forEach(x => s += String.fromCharCode(x)); return btoa(s); }, id);
const status = p => p.evaluate(() => StashCloud.status(StashAuth.state.user.id));
async function settle(p, ms = 20000) { await p.waitForTimeout(700); await p.waitForFunction(() => { const s = StashCloud.status(StashAuth.state.user.id); return !s.running; }, null, { timeout: ms }).catch(() => {}); await p.waitForTimeout(150); }
async function enable(p) { await open(p, '#settings'); await p.locator('#cloudPanel .slider').click(); await settle(p); }
const syncNow = async p => { await p.evaluate(() => StashCloud.syncNow(StashAuth.state.user.id)); await settle(p); };
const ready_docs = s => [...s.docs.values()].filter(d => d.status === 'ready');
async function T(name, fn) { current = name; console.log('\n' + name); try { await fn(); } catch (e) { ok('threw: ' + e.message.split('\n')[0], false); } }

(async () => {
  const browser = await chromium.launch();

  await T('C1 opt-in: nothing is uploaded until the student agrees', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [{ name: 'receipt.pdf', buf: bytes('r1') }]); await a.page.waitForTimeout(1500);
    ok('document saved locally', (await localDocs(a.page)).length === 1);
    ok('server holds no documents and no objects before opt-in', s.docs.size === 0 && s.objects.size === 0);
    ok('no storage/document calls were made', !s.log.some(l => ['stUpload', 'docsList'].includes(l.op) || /upload/.test(l.p && l.p.name || '')));
    await open(a.page, '#settings'); ok('Settings shows the Cloud storage row, switch off', await a.page.locator('#cloudPanel').isVisible() && !(await a.page.locator('#cloudToggle').isChecked()));
    await a.page.locator('#cloudPanel .slider').click(); await settle(a.page);
    ok('after opt-in the document is ready in the cloud', ready_docs(s).length === 1 && s.objects.size === 1);
    const st = await status(a.page); ok('it was verified by downloading it back (size + SHA-256)', st.verified === 1 && st.failed === 0, JSON.stringify(st));
    ok('private path is <user id>/<document id>', ready_docs(s)[0].storage_path === (await uidOf(a.page)) + '/' + ready_docs(s)[0].id);
    ok('local copy is still on this device', !!(await localBlob(a.page, (await localDocs(a.page))[0].id)));
    ok('status text is shown', /1 of 1 document backed up and verified/.test(await a.page.locator('#cloudStatusText').innerText()));
    ok('page had no JS errors', a.page.errs.length === 0, a.page.errs.join('|'));
  });

  await T('C2 migration of existing local documents keeps local copies', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    const files = [1, 2, 3].map(i => ({ name: 'doc' + i + '.pdf', buf: bytes('m' + i, 300 * i) }));
    await addFiles(a.page, files);
    const before = await localDocs(a.page); ok('3 local documents exist before migration', before.length === 3);
    await enable(a.page);
    ok('all 3 are ready in the cloud', ready_docs(s).length === 3 && s.objects.size === 3);
    ok('stored bytes equal the local bytes (SHA-256), per document', (await Promise.all(before.map(async d => {
      const row = [...s.docs.values()].find(r => r.local_ref === d.id); const local = Buffer.from(await localBlob(a.page, d.id), 'base64');
      return row && sha(s.objects.get(row.storage_path).buf) === sha(local); }))).every(Boolean));
    const after = await localDocs(a.page); ok('local documents unchanged (same ids, none removed)', JSON.stringify(after.map(d => d.id).sort()) === JSON.stringify(before.map(d => d.id).sort()));
    ok('every local blob still present', (await Promise.all(before.map(d => localBlob(a.page, d.id)))).every(Boolean));
    const st = await status(a.page); ok('3 of 3 verified', st.verified === 3 && st.total === 3);
    const n = s.docs.size; await syncNow(a.page); ok('running sync again is idempotent (no duplicates)', s.docs.size === n && s.objects.size === 3);
  });

  await T('C3 transient failures are retried; no duplicates', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [{ name: 'flaky.pdf', buf: bytes('f') }]);
    s.cloud.failUploads = 2; s.cloud.failRpc.finalize_upload = 1;
    await enable(a.page);
    ok('upload succeeded after network failures', ready_docs(s).length === 1 && s.objects.size === 1);
    ok('exactly one document row (retries reused the reservation)', s.docs.size === 1);
    ok('verified', (await status(a.page)).verified === 1);
  });

  await T('C4 failed uploads leave no orphan; local copy kept; retry works', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [{ name: 'bad.pdf', buf: bytes('bad', 2000) }]);
    s.cloud.truncate = true; await enable(a.page);
    ok('server did not accept a corrupt (truncated) object as ready', ready_docs(s).length === 0);
    ok('no orphaned object is left in storage', s.objects.size === 0, 'objects=' + s.objects.size);
    ok('no leftover document row either', s.docs.size === 0, 'rows=' + [...s.docs.values()].map(d => d.status));
    const st = await status(a.page); ok('UI state: 1 will retry, 0 verified', st.failed === 1 && st.verified === 0, JSON.stringify(st));
    ok('local copy untouched', !!(await localBlob(a.page, (await localDocs(a.page))[0].id)));
    await open(a.page, '#settings'); ok('Settings says it will retry', /1 will retry/.test(await a.page.locator('#cloudStatusText').innerText()));
    s.cloud.truncate = false; await syncNow(a.page);
    ok('after the fault clears, Sync now succeeds and verifies', ready_docs(s).length === 1 && (await status(a.page)).verified === 1);
  });

  await T('C5 offline, then back online', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [{ name: 'offline.pdf', buf: bytes('o') }]);
    s.flags.offline = true; await enable(a.page);
    ok('nothing reached the server while offline', s.docs.size === 0);
    ok('doc is waiting/retrying, not lost', (await status(a.page)).verified === 0 && (await localDocs(a.page)).length === 1);
    s.flags.offline = false; await syncNow(a.page);
    ok('uploads once the connection is back', ready_docs(s).length === 1 && (await status(a.page)).verified === 1);
  });

  await T('C6 server-side quota: files over the limit stay local, nothing exceeds the limit', async () => {
    const s = new MockServer(); s.cloud.limit.free = 2500; const a = await mk(browser, s); await signup(a.page, s);
    const raw = [1, 2, 3].map(i => ({ name: 'q' + i + '.pdf', buf: Buffer.concat([Buffer.from('%PDF-1.4 q' + i + '\n'), crypto.randomBytes(1000 - 12)]) }));
    await addFiles(a.page, raw); await enable(a.page);
    const uid = await uidOf(a.page); const usedNow = [...s.docs.values()].filter(d => d.user_id === uid).reduce((n, d) => n + (d.size_bytes || d.declared_size), 0);
    ok('2 documents fit, third is refused by the SERVER', ready_docs(s).length === 2 && s.docs.size === 2, 'ready=' + ready_docs(s).length);
    ok('stored bytes never exceed the limit', usedNow <= 2500, 'used=' + usedNow);
    ok('all 3 documents remain on this device', (await localDocs(a.page)).length === 3);
    const st = await status(a.page); ok('UI reports 1 not backed up (storage full)', st.blocked === 1 && st.verified === 2, JSON.stringify(st));
    await open(a.page, '#settings'); ok('Settings explains it', /storage full/.test(await a.page.locator('#cloudStatusText').innerText()));
    ok('usage line shows used of limit', /of .* used/.test(await a.page.locator('#cloudUsageText').innerText()));
    ok('retrying does not bypass the quota', (await (async () => { await syncNow(a.page); return ready_docs(s).length; })()) === 2);
    s.entitlements.set(uid, 'paid'); s.cloud.limit.paid = 100000; await syncNow(a.page);
    ok('after the server-side tier changes, the blocked file uploads', ready_docs(s).length === 3);
    ok('browser cannot change its own tier (no such call exists in the app)', !s.log.some(l => /entitlement/i.test(JSON.stringify(l))));
  });

  await T('C7 cross-account isolation', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [{ name: 'secret.pdf', buf: bytes('secret') }]); await enable(a.page);
    const row = ready_docs(s)[0];
    const B = { name: 'Bola Bello', matric: '20/5678', level: '100L', email: 'bola@example.com', pw: 'correct-horse-9' };
    const b = await mk(browser, s); await signup(b.page, s, B);
    const probe = await b.page.evaluate(async ({ path, id }) => {
      const c = StashAuth.getClient(); const out = {};
      out.download = (await c.storage.from('documents').download(path)).error ? 'denied' : 'LEAK';
      out.list = ((await c.from('documents').select('*')).data || []).length;
      out.begin_delete = (await c.rpc('begin_delete', { p_id: id })).data.status;
      out.finalize = (await c.rpc('finalize_upload', { p_id: id })).data.status;
      out.update = (await c.rpc('update_document_meta', { p_id: id, p_title: 'pwn', p_category: null, p_tags: [], p_notes: null, p_ocr_text: null, p_metadata: {} })).data.status;
      out.confirm = (await c.rpc('confirm_removed', { p_id: id })).data.status;
      out.remove = (await c.storage.from('documents').remove([path])).data.length;
      out.search = (await c.rpc('search_my_documents', { p_query: 'secret' })).data.length;
      out.upload = (await c.storage.from('documents').upload(path, new Blob(['x'], { type: 'application/pdf' }), { contentType: 'application/pdf' })).error ? 'denied' : 'LEAK';
      return out; }, { path: row.storage_path, id: row.id });
    ok('B cannot download A\'s file', probe.download === 'denied');
    ok('B sees zero of A\'s rows', probe.list === 0);
    ok('B cannot delete/finalize/update/confirm A\'s document', probe.begin_delete === 'not_found' && probe.finalize === 'not_found' && probe.update === 'not_found' && probe.confirm === 'not_found', JSON.stringify(probe));
    ok('B cannot remove A\'s object, search it, or overwrite it', probe.remove === 0 && probe.search === 0 && probe.upload === 'denied', JSON.stringify(probe));
    ok('A\'s document is intact', s.docs.get(row.id).status === 'ready' && s.docs.get(row.id).title !== 'pwn' && s.objects.has(row.storage_path));
    await enable(b.page); ok('B enabling cloud pulls nothing of A\'s', (await localDocs(b.page)).length === 0);
  });

  await T('C8 delete: cloud copy and quota are released; interrupted deletes resume', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [{ name: 'x1.pdf', buf: bytes('x1') }, { name: 'x2.pdf', buf: bytes('x2') }]); await enable(a.page);
    const del = (ids) => a.page.evaluate(async ids => { const u = StashAuth.state.user.id; const d = (await DB.getDocuments(u)).filter(x => !ids.includes(x.id)); await DB.saveDocuments(u, d); ids.forEach(i => FileStore.delete(i)); }, ids);
    const [d1, d2] = await localDocs(a.page);
    await del([d1.id]); await settle(a.page);
    ok('deleted document is gone from cloud rows and storage', ready_docs(s).length === 1 && s.objects.size === 1);
    ok('server usage dropped (quota freed)', (await a.page.evaluate(() => StashCloud.usage())).used === ready_docs(s)[0].size_bytes);
    s.cloud.failRpc.confirm_removed = 3; await del([d2.id]); await settle(a.page);
    ok('interrupted delete leaves a resumable record, local doc already gone', (await localDocs(a.page)).length === 0 && (await status(a.page)).deleting === 1);
    ok('quota is NOT freed until the object is confirmed gone', s.docs.size === 1 && s.docs.values().next().value.status === 'deleting');
    await a.page.reload(); await ready(a.page); await syncNow(a.page);
    ok('after reload + sync the delete completes (no orphan row/object)', s.docs.size === 0 && s.objects.size === 0 && (await status(a.page)).deleting === 0);
  });

  await T('C9 "Clear local vault" clears this device only', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [{ name: 'keep.pdf', buf: bytes('keep') }]); await enable(a.page);
    await open(a.page, '#settings'); await a.page.click('#clearVaultBtn'); await a.page.waitForTimeout(800);
    ok('local list is empty', (await localDocs(a.page)).length === 0);
    ok('cloud copy is NOT deleted', ready_docs(s).length === 1 && s.objects.size === 1);
    await syncNow(a.page); const d = await localDocs(a.page);
    ok('next sync restores the document from the cloud', d.length === 1);
    const got = await a.page.evaluate(async id => { const b = await FileStore.get(id); return b ? b.size : -1; }, d[0].id);
    ok('FileStore.get falls back to the cloud download', got === s.objects.values().next().value.size, 'size=' + got);
  });

  await T('C10 second device: pull and lazy download', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    const buf = bytes('shared', 900); await addFiles(a.page, [{ name: 'shared.pdf', buf }]); await enable(a.page);
    const b = await mk(browser, s); await login(b.page); await enable(b.page);
    const d = await localDocs(b.page); ok('device B lists the document', d.length === 1 && d[0].name === (await localDocs(a.page))[0].name);
    ok('device B has no blob yet (lazy)', (await localBlob(b.page, d[0].id)) === null);
    const got = await b.page.evaluate(async id => { const x = await FileStore.get(id); const u = new Uint8Array(await x.arrayBuffer()); return Array.from(u); }, d[0].id);
    ok('opening it downloads the identical bytes', sha(Buffer.from(got)) === sha(buf));
    ok('and caches it on device B', (await localBlob(b.page, d[0].id)) !== null);
    await b.page.evaluate(() => { const u = StashAuth.state.user.id; return DB.getDocuments(u).then(ds => { ds[0].name = 'Renamed on B'; return DB.saveDocuments(u, ds); }); }); await settle(b.page);
    await syncNow(a.page);
    ok('metadata edit on B reaches A', (await localDocs(a.page))[0].name === 'Renamed on B');
  });

  await T('C11 organization + search follow the server', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [{ name: 'a.pdf', buf: bytes('a') }, { name: 'b.pdf', buf: bytes('b') }]); await enable(a.page);
    await a.page.evaluate(async () => { const u = StashAuth.state.user.id; const ds = await DB.getDocuments(u); ds[0].name = 'Hostel allocation'; ds[0].category = 'admin'; ds[0].ocrText = 'Room B12 Block C'; ds[0].tags = ['housing']; await DB.saveDocuments(u, ds); });
    await settle(a.page);
    const r1 = await a.page.evaluate(() => StashCloud.search('hostel')); ok('search by new title', r1.length === 1 && r1[0].title === 'Hostel allocation');
    const r2 = await a.page.evaluate(() => StashCloud.search('block')); ok('search by scanned text', r2.length === 1);
    const r3 = await a.page.evaluate(() => StashCloud.search('', 'admin')); ok('filter by category', r3.length === 1);
    const r4 = await a.page.evaluate(() => StashCloud.search('housing')); ok('search by tag', r4.length === 1);
    ok('search results never contain OCR text blobs', !('ocr_text' in r1[0]));
  });

  await T('C12 a corrupted cloud copy is never reported as verified', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [{ name: 'c.pdf', buf: bytes('c') }]); s.cloud.corruptDownload = true; await enable(a.page);
    const st = await status(a.page); ok('verification failed -> not counted as verified', st.verified === 0 && st.failed === 1, JSON.stringify(st));
    ok('local copy untouched', !!(await localBlob(a.page, (await localDocs(a.page))[0].id)));
  });

  await T('C13 account deletion removes cloud files', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [{ name: 'gone.pdf', buf: bytes('g') }]); await enable(a.page);
    const uid = await uidOf(a.page); const paths = [...s.docs.values()].map(d => d.storage_path);
    await a.page.evaluate(async () => { await StashCloud.purgeAllForAccountDeletion(StashAuth.state.user.id); await StashAuth.deleteAccount(); });
    ok('no objects remain', s.objects.size === 0); ok('no document rows remain', s.docs.size === 0);
    ok('account is gone', !s.users.has(uid));
    ok('every path was either removed or queued for the cleaner', paths.every(p => !s.objects.has(p)));
  });

  await T('C14 logged-out and hygiene', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [{ name: 'h.pdf', buf: bytes('h') }]); await enable(a.page);
    ok('no password or access token appears in console output', !a.page.logs.some(l => l.includes(U.pw) || l.includes('tok_')));
    await a.page.click('#logoutBtn'); await a.page.waitForTimeout(500);
    const n = s.log.length; await a.page.waitForTimeout(1500);
    ok('signed-out page makes no further cloud calls', s.log.length === n);
    ok('sync state is per account (key contains the user id)', await a.page.evaluate(() => Object.keys(localStorage).some(k => /^stash_cloud_v1_[0-9a-f-]{36}$/.test(k))));
    ok('no JS errors', a.page.errs.length === 0, a.page.errs.join('|'));
  });

  await T('C15 Settings row layout (existing panel styles, no overflow)', async () => {
    const s = new MockServer(); s.cloud.limit.free = 1500; const a = await mk(browser, s); await signup(a.page, s);
    await addFiles(a.page, [1, 2].map(i => ({ name: 'l' + i + '.pdf', buf: bytes('l' + i, 1000) }))); await enable(a.page);
    for (const w of [320, 360, 390, 768, 1280]) {
      await a.page.setViewportSize({ width: w, height: 900 }); await open(a.page, '#settings'); await a.page.waitForTimeout(500);
      const m = await a.page.evaluate(() => { const r = document.getElementById('cloudPanel').getBoundingClientRect(), b = document.getElementById('cloudSyncBtn').getBoundingClientRect(), t = document.getElementById('cloudToggle').closest('label').getBoundingClientRect();
        return { sw: document.documentElement.scrollWidth, iw: innerWidth, right: r.right, btnR: b.right, btnVisible: b.width > 0, togR: t.right }; });
      ok(`${w}px: no horizontal overflow, panel/button/switch inside viewport`, m.sw <= m.iw && m.right <= m.iw + 1 && m.btnR <= m.iw + 1 && m.togR <= m.iw + 1 && m.btnVisible, JSON.stringify(m));
    }
  });

  await browser.close();
  const failed = results.filter(r => !r.pass).length;
  console.log(`\nCLOUD: ${results.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
