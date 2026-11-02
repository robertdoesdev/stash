#!/usr/bin/env node
/* Smoke test for a REAL Supabase project, run by you after applying the migrations.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon/publishable key> node scripts/verify-supabase.js
 *   optional: TEST_EMAIL=... TEST_PASSWORD=...   (a DEDICATED, already email-verified test account in a DEV project)
 *   optional: TEST2_EMAIL=... TEST2_PASSWORD=... (a SECOND such account; enables the cross-account checks)
 *   Phase 3 (migration 0003): the signed-in checks upload, verify and delete a 12-byte throw-away PDF in the bucket 'documents'.
 *
 * Uses only the PUBLIC anon key. Never prints keys or tokens. Does not create or delete anything.
 * It checks configuration and permissions; it cannot prove emails are delivered or Google works
 * (those stay manual: docs/SETUP_PHASE2.md section 6). Exit code 1 if any check fails.
 * Until YOU run this against YOUR project, nothing here counts as a real-service result. */
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_ANON_KEY || '';
if (!URL_ || !KEY) { console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY.'); process.exit(2); }
if (/^sb_secret_/.test(KEY) || /"role"\s*:\s*"service_role"/.test(Buffer.from((KEY.split('.')[1] || ''), 'base64url').toString())) { console.error('That is a SECRET key. Refusing to use it.'); process.exit(2); }
let failed = 0; const ok = (n, c, x) => { if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c || !x ? '' : '  -> ' + x)); };
const call = async (method, p, { token, body } = {}) => {
  const r = await fetch(URL_ + p, { method, headers: { apikey: KEY, Authorization: 'Bearer ' + (token || KEY), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, json: j };
};
const denied = r => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0);

(async () => {
  const s = await call('GET', '/auth/v1/settings');
  ok('Auth settings reachable', s.status === 200, 'HTTP ' + s.status);
  if (s.status === 200) {
    const j = s.json;
    ok('Email provider enabled', j.external && j.external.email === true);
    ok('"Confirm email" is ON (mailer_autoconfirm must be false)', j.mailer_autoconfirm === false, 'mailer_autoconfirm=' + j.mailer_autoconfirm);
    console.log((j.external && j.external.google ? 'INFO ' : 'TODO ') + 'Google provider is ' + (j.external && j.external.google ? 'enabled' : 'NOT enabled'));
    ok('Anonymous sign-ins are OFF', !(j.external && j.external.anonymous_users), 'external.anonymous_users=true');
  }
  const own = await call('GET', '/rest/v1/profiles?select=*');
  ok('anon cannot read profiles (RLS)', denied(own), 'HTTP ' + own.status + ' rows=' + (Array.isArray(own.json) ? own.json.length : '?'));
  ok('anon cannot insert into profiles', denied(await call('POST', '/rest/v1/profiles', { body: { id: '00000000-0000-0000-0000-000000000000', email: 'x@example.com' } })));
  ok('anon cannot update profiles', denied(await call('PATCH', '/rest/v1/profiles?id=neq.00000000-0000-0000-0000-000000000000', { body: { level: '500L' } })));
  ok('anon cannot delete profiles', denied(await call('DELETE', '/rest/v1/profiles?id=neq.00000000-0000-0000-0000-000000000000')));
  for (const t of ['profile_save_attempts', 'matric_corrections']) ok('anon cannot read ' + t, denied(await call('GET', '/rest/v1/' + t + '?select=*')));
  for (const [fn, body] of [['save_my_profile', { p_full_name: 'Zz Zz', p_matric: 'ZZ/0000', p_level: '100L' }], ['delete_my_account', {}],
    ['admin_correct_matric', { p_user_id: '00000000-0000-0000-0000-000000000000', p_new_matric: 'ZZ/0000', p_reason: 'verification probe only' }],
    ['handle_new_user', {}], ['apply_signup_metadata', { p_id: '00000000-0000-0000-0000-000000000000', p_meta: {} }], ['normalize_matric', { p: 'x' }]])
    { const r = await call('POST', '/rest/v1/rpc/' + fn, { body }); ok('anon cannot call ' + fn + '()', r.status >= 400, 'HTTP ' + r.status); }

  // ---- Phase 3 (migration 0003): documents + private storage
  const ZERO = '00000000-0000-0000-0000-000000000000';
  for (const t of ['documents', 'user_entitlements', 'storage_deletion_queue']) ok('anon cannot read ' + t, denied(await call('GET', '/rest/v1/' + t + '?select=*')));
  for (const [fn, body] of [['begin_upload', { p_local_ref: 'x', p_title: 't', p_original_name: 't.pdf', p_mime: 'application/pdf', p_size: 1, p_sha256: null, p_category: null, p_tags: [], p_notes: null, p_ocr_text: null, p_metadata: {} }],
    ['finalize_upload', { p_id: ZERO }], ['mark_upload_failed', { p_id: ZERO }], ['begin_delete', { p_id: ZERO }], ['confirm_removed', { p_id: ZERO }],
    ['update_document_meta', { p_id: ZERO, p_title: 't', p_category: null, p_tags: [], p_notes: null, p_ocr_text: null, p_metadata: {} }],
    ['my_storage_usage', {}], ['search_my_documents', { p_query: 'a' }], ['orphan_report', {}], ['quota_used', { p_user: ZERO }], ['storage_limit_bytes', { p_user: ZERO }]])
    { const r = await call('POST', '/rest/v1/rpc/' + fn, { body }); ok('anon cannot call ' + fn + '()', r.status >= 400, 'HTTP ' + r.status); }
  const pub = await fetch(URL_ + '/storage/v1/object/public/documents/' + ZERO + '/' + ZERO, { headers: { apikey: KEY } });
  ok('bucket "documents" is NOT public (public URL does not serve files)', pub.status !== 200, 'HTTP ' + pub.status);
  const anonObj = await fetch(URL_ + '/storage/v1/object/documents/' + ZERO + '/' + ZERO, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  ok('anon cannot read objects in the bucket', anonObj.status >= 400, 'HTTP ' + anonObj.status);

  if (process.env.TEST_EMAIL && process.env.TEST_PASSWORD) {
    const t = await call('POST', '/auth/v1/token?grant_type=password', { body: { email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD } });
    ok('test account can sign in (must be verified)', t.status === 200 && t.json && t.json.access_token, 'HTTP ' + t.status);
    if (t.status === 200) {
      const token = t.json.access_token, uid = t.json.user && t.json.user.id;
      const rows = await call('GET', '/rest/v1/profiles?select=id,email,matric_number', { token });
      ok('signed-in user sees exactly ONE profile row (their own)', Array.isArray(rows.json) && rows.json.length === 1 && rows.json[0].id === uid, 'rows=' + (Array.isArray(rows.json) ? rows.json.length : '?'));
      ok('signed-in user cannot UPDATE profiles directly', denied(await call('PATCH', '/rest/v1/profiles?id=eq.' + uid, { token, body: { matric_number: 'HACK/0001' } })));
      ok('signed-in user cannot grant themselves anything via profile_complete', denied(await call('PATCH', '/rest/v1/profiles?id=eq.' + uid, { token, body: { profile_complete: true } })));
      ok('signed-in user cannot call admin_correct_matric()', (await call('POST', '/rest/v1/rpc/admin_correct_matric', { token, body: { p_user_id: uid, p_new_matric: 'HACK/0001', p_reason: 'verification probe only' } })).status >= 400);
      for (const tb of ['profile_save_attempts', 'matric_corrections']) ok('signed-in user cannot read ' + tb, denied(await call('GET', '/rest/v1/' + tb + '?select=*', { token })));
      // ---- Phase 3: full storage cycle with a throw-away document
      const sha = require('crypto').createHash('sha256').update('%PDF-1.4 x\n').digest('hex'); const bytes = Buffer.from('%PDF-1.4 x\n');
      const bu = await call('POST', '/rest/v1/rpc/begin_upload', { token, body: { p_local_ref: 'verify-' + Date.now(), p_title: 'verify-supabase probe', p_original_name: 'probe.pdf', p_mime: 'application/pdf', p_size: bytes.length, p_sha256: sha, p_category: null, p_tags: [], p_notes: null, p_ocr_text: null, p_metadata: {} } });
      const doc = bu.json && bu.json.document; ok('begin_upload reserves a pending document', bu.status === 200 && bu.json && bu.json.status === 'ok' && doc && doc.storage_path === uid + '/' + doc.id, 'HTTP ' + bu.status + ' ' + JSON.stringify(bu.json).slice(0, 120));
      if (doc) {
        const objUrl = URL_ + '/storage/v1/object/documents/' + doc.storage_path, sh = { apikey: KEY, Authorization: 'Bearer ' + token };
        const wrong = await fetch(URL_ + '/storage/v1/object/documents/' + uid + '/' + ZERO, { method: 'POST', headers: { ...sh, 'Content-Type': 'application/pdf' }, body: bytes });
        ok('cannot upload to a path that has no reservation', wrong.status >= 400, 'HTTP ' + wrong.status);
        const up = await fetch(objUrl, { method: 'POST', headers: { ...sh, 'Content-Type': 'application/pdf' }, body: bytes });
        ok('upload to the reserved path works', up.status === 200, 'HTTP ' + up.status);
        const again = await fetch(objUrl, { method: 'POST', headers: { ...sh, 'Content-Type': 'application/pdf' }, body: bytes });
        ok('a second upload to the same path is refused (no overwrite)', again.status >= 400, 'HTTP ' + again.status);
        const fin = await call('POST', '/rest/v1/rpc/finalize_upload', { token, body: { p_id: doc.id } });
        ok('finalize_upload reads the REAL object size from storage.objects (assumption check)', fin.json && fin.json.status === 'ok' && fin.json.document.size_bytes === bytes.length, JSON.stringify(fin.json).slice(0, 160));
        if (process.env.TEST2_EMAIL && process.env.TEST2_PASSWORD) {
          const t2 = await call('POST', '/auth/v1/token?grant_type=password', { body: { email: process.env.TEST2_EMAIL, password: process.env.TEST2_PASSWORD } });
          ok('second test account can sign in', t2.status === 200 && t2.json && t2.json.access_token, 'HTTP ' + t2.status);
          if (t2.status === 200) {
            const h2 = { apikey: KEY, Authorization: 'Bearer ' + t2.json.access_token };
            const x = await fetch(objUrl, { headers: h2 }); ok('ACCOUNT B cannot download account A\'s file', x.status >= 400, 'HTTP ' + x.status);
            ok('ACCOUNT B sees no document rows of A', ((await call('GET', '/rest/v1/documents?select=id', { token: t2.json.access_token })).json || []).every(r => r.id !== doc.id));
            for (const fn of ['finalize_upload', 'begin_delete', 'confirm_removed', 'mark_upload_failed']) { const r = await call('POST', '/rest/v1/rpc/' + fn, { token: t2.json.access_token, body: { p_id: doc.id } }); ok('ACCOUNT B cannot ' + fn + '() A\'s document', r.json && r.json.status !== 'ok', JSON.stringify(r.json).slice(0, 80)); }
            const ow = await fetch(objUrl, { method: 'POST', headers: { ...h2, 'Content-Type': 'application/pdf' }, body: bytes }); ok('ACCOUNT B cannot write to A\'s path', ow.status >= 400, 'HTTP ' + ow.status);
            const rmB = await fetch(objUrl, { method: 'DELETE', headers: h2 }); const still2 = await fetch(objUrl, { headers: sh }); ok('ACCOUNT B cannot delete A\'s file', still2.status === 200, 'delete HTTP ' + rmB.status);
            await call('POST', '/auth/v1/logout?scope=local', { token: t2.json.access_token });
          }
        } else console.log('SKIP cross-account checks (set TEST2_EMAIL and TEST2_PASSWORD for a second verified DEV account)');
        const dl = await fetch(objUrl, { headers: sh }); const got = Buffer.from(await dl.arrayBuffer());
        ok('download returns identical bytes', dl.status === 200 && got.equals(bytes), 'HTTP ' + dl.status);
        const usage = await call('POST', '/rest/v1/rpc/my_storage_usage', { token, body: {} });
        ok('my_storage_usage reports a limit of 1 GiB (free) or 5 GiB (paid)', usage.json && [1073741824, 5368709120].includes(usage.json.limit), JSON.stringify(usage.json));
        const rm0 = await fetch(URL_ + '/storage/v1/object/documents/' + doc.storage_path, { method: 'DELETE', headers: sh });
        const still = await fetch(objUrl, { headers: sh });
        ok('a READY file cannot be deleted directly (must go through begin_delete)', still.status === 200, 'delete HTTP ' + rm0.status + ', then GET ' + still.status);
        const bd = await call('POST', '/rest/v1/rpc/begin_delete', { token, body: { p_id: doc.id } });
        ok('begin_delete marks it deleting', bd.json && bd.json.status === 'ok');
        const early = await call('POST', '/rest/v1/rpc/confirm_removed', { token, body: { p_id: doc.id } });
        ok('confirm_removed refuses while the object still exists', early.json && early.json.status === 'object_still_present', JSON.stringify(early.json));
        const rm = await fetch(URL_ + '/storage/v1/object/documents/' + doc.storage_path, { method: 'DELETE', headers: sh });
        ok('owner can remove the object once the row is deleting', rm.status === 200, 'HTTP ' + rm.status);
        const cr = await call('POST', '/rest/v1/rpc/confirm_removed', { token, body: { p_id: doc.id } });
        ok('confirm_removed then deletes the row (cleanup complete)', cr.json && cr.json.status === 'ok', JSON.stringify(cr.json));
      }
      ok('signed-in user cannot read user_entitlements / storage_deletion_queue / call orphan_report',
        denied(await call('GET', '/rest/v1/user_entitlements?select=*', { token })) && denied(await call('GET', '/rest/v1/storage_deletion_queue?select=*', { token })) && (await call('POST', '/rest/v1/rpc/orphan_report', { token, body: {} })).status >= 400);
      await call('POST', '/auth/v1/logout?scope=local', { token });
    }
  } else console.log('SKIP signed-in checks (set TEST_EMAIL and TEST_PASSWORD for a dedicated verified DEV test account)');
  console.log('\nverify-supabase: ' + (failed ? failed + ' check(s) FAILED' : 'all checks passed') + ' (this does NOT test email delivery or Google sign-in)'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('verify-supabase: ' + e.message); process.exit(2); });
