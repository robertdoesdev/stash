#!/usr/bin/env node
/* Smoke test for a REAL Supabase project, run by you after applying the migrations.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon/publishable key> node scripts/verify-supabase.js
 *   optional: TEST_EMAIL=... TEST_PASSWORD=...   (a DEDICATED, already email-verified test account in a DEV project)
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
      await call('POST', '/auth/v1/logout?scope=local', { token });
    }
  } else console.log('SKIP signed-in checks (set TEST_EMAIL and TEST_PASSWORD for a dedicated verified DEV test account)');
  console.log('\nverify-supabase: ' + (failed ? failed + ' check(s) FAILED' : 'all checks passed') + ' (this does NOT test email delivery or Google sign-in)'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('verify-supabase: ' + e.message); process.exit(2); });
