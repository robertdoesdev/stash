/* End-to-end auth tests. Run: node tests/e2e/auth.e2e.js  (needs `playwright` and a static server:
 *   python3 -m http.server 8767   from the project root)
 * Backend = tests/e2e/mock-server.js (a test double). See docs/PHASE2_TEST_REPORT.md for what that does and does not prove. */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { MockServer, installBackend, BASE, U } = require('./harness');

const results = []; let current = '';
const ok = (name, cond, extra) => { results.push({ test: current, name, pass: !!cond, extra }); if (!cond) console.log('  FAIL', current, '::', name, extra || ''); };

async function mk(browser, server, o = {}) {
  const ctx = o.context || await browser.newContext({ viewport: { width: o.width || 1280, height: o.height || 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const consoleMsgs = []; const pageErrors = [];
  page.on('console', m => consoleMsgs.push(m.text())); page.on('pageerror', e => pageErrors.push(e.message));
  await installBackend(page, server, { unconfigured: o.unconfigured });
  return { ctx, page, consoleMsgs, pageErrors };
}
const hash = p => p.evaluate(() => location.hash);
const waitHash = (p, h, t = 4000) => p.waitForFunction(x => location.hash === x, h, { timeout: t }).then(() => true, () => false);
const vis = (p, s) => p.locator(s).first().isVisible().catch(() => false);
const txt = (p, s) => p.locator(s).first().innerText().catch(() => '');
const open = async (p, h = '') => { await p.goto(BASE + h); await p.waitForFunction(() => document.getElementById('authShell') !== null && window.StashAuth && window.StashAuth.state.ready); await p.waitForTimeout(150); };
async function fillSignup(p, d = U, over = {}) {
  const v = { ...d, ...over };
  await p.fill('#suName', v.name); await p.fill('#suMatric', v.matric); await p.selectOption('#suLevel', v.level);
  await p.fill('#suEmail', v.email); await p.fill('#suPassword', v.pw); await p.fill('#suConfirmPassword', v.confirm !== undefined ? v.confirm : v.pw);
}
async function signupUI(p, d = U, over = {}) { await open(p, '#signup'); await fillSignup(p, d, over); await p.click('#signupForm button[type=submit]'); await p.waitForTimeout(300); }
async function loginUI(p, email = U.email, pw = U.pw, remember = true) {
  await open(p, '#login'); await p.fill('#loginId', email); await p.fill('#loginPassword', pw);
  if (!remember) await p.uncheck('#rememberMe');
  await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(400);
}
const lastMail = (s, kind) => [...s.mail].reverse().find(m => !kind || m.kind === kind);
async function storageDump(p) { return p.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } })); }
async function verifyAndLogin(browser, server, page) {   // helper: register + confirm via link in same browser
  await signupUI(page); await page.goto(lastMail(server, 'signup').link); await waitHash(page, '#dashboard');
}

async function T(name, browser, fn) {
  current = name; const server = new MockServer();
  try { await fn(server); } catch (e) { ok('test threw: ' + e.message.split('\n')[0], false); }
}

(async () => {
  const browser = await chromium.launch();

  await T('01 not configured', browser, async s => {
    const { page } = await mk(browser, s, { unconfigured: true });
    await open(page, '#login');
    ok('login shows "not configured" notice', /isn.t configured/.test(await txt(page, '#loginNotice')));
    await page.fill('#loginId', U.email); await page.fill('#loginPassword', U.pw); await page.click('#loginForm button[type=submit]'); await page.waitForTimeout(300);
    ok('login attempt fails safely, stays on login', (await hash(page)) === '#login' && /available|isn.t/.test(await txt(page, '#loginError')));
    await open(page, '#dashboard'); ok('dashboard still guarded', (await hash(page)) === '#login');
  });

  await T('02 signup validation', browser, async s => {
    const { page } = await mk(browser, s);
    const cases = [
      ['empty name', { name: '' }, /full name/i], ['one-letter name', { name: 'A' }, /full name/i],
      ['bad matric (symbols)', { matric: 'ab!!' }, /matric/i], ['matric too short', { matric: '1' }, /matric/i],
      ['no level', { level: '' }, /level/i], ['bad email', { email: 'nope' }, /email/i],
      ['short password', { pw: 'short', confirm: 'short' }, /8 characters/], ['password mismatch', { confirm: 'different-9' }, /match/i]];
    for (const [label, over, re] of cases) {
      await open(page, '#signup'); await fillSignup(page, U, over);
      await page.click('#signupForm button[type=submit]'); await page.waitForTimeout(150);
      ok('invalid: ' + label, re.test(await txt(page, '#signupError')) && await vis(page, '#signupError'));
    }
    ok('no request reached the server for invalid forms', s.log.filter(l => l.op === 'signUp').length === 0);
  });

  await T('03 valid signup + verification gating', browser, async s => {
    const { page, consoleMsgs } = await mk(browser, s);
    await signupUI(page);
    ok('success panel shown', await vis(page, '#signupSuccess') && !(await vis(page, '#signupForm')));
    ok('panel mentions the email', (await txt(page, '#signupSuccessText')).includes(U.email));
    ok('verification email sent', s.mail.length === 1 && s.mail[0].kind === 'signup');
    ok('profile row exists but holds NO matric until the email is verified (anti-squatting)', s.profiles.size === 1 && ![...s.profiles.values()][0].matric_number);
    const dump = await storageDump(page);
    ok('NO session stored for unverified account', !/stash-auth"/.test(dump) && !(await page.evaluate(() => !!localStorage.getItem('stash-auth'))));
    ok('NO password in browser storage', !dump.includes(U.pw));
    await open(page, '#dashboard'); ok('cannot reach dashboard unverified', (await hash(page)) === '#login');
    await open(page, '#login'); await page.fill('#loginId', U.email); await page.fill('#loginPassword', U.pw);
    await page.click('#loginForm button[type=submit]'); await page.waitForTimeout(300);
    ok('login blocked: unverified message + resend button', /confirm your email/i.test(await txt(page, '#loginError')) && await vis(page, '#resendVerifyBtn'));
    await page.click('#resendVerifyBtn'); await page.waitForTimeout(200);
    ok('resend sends a second email', s.mail.filter(m => m.kind === 'signup').length === 2);
    ok('no password/token in console output', !consoleMsgs.some(m => m.includes(U.pw) || m.includes('tok_')));
    ok('password never sent anywhere except signUp/signIn', s.log.every(l => ['signUp', 'signIn', 'resend', 'getUser', 'exchange'].includes(l.op) || !JSON.stringify(l.p).includes(U.pw)));
    await page.goto([...s.mail].reverse().find(m => m.kind === 'signup').link); await page.waitForFunction(() => location.hash === '#dashboard', null, { timeout: 4000 }).catch(() => {});
    ok('after verification the matric is applied, normalised', [...s.profiles.values()][0].matric_number === '20/1234');

  });

  await T('04 duplicate email (anti-enumeration)', browser, async s => {
    const a = await mk(browser, s); await verifyAndLogin(browser, s, a.page);
    const b = await mk(browser, s);
    const before = s.mail.length;
    await signupUI(b.page, { ...U, matric: '21/9999' });
    ok('duplicate shows the SAME success screen', await vis(b.page, '#signupSuccess'));
    ok('no email sent for an existing confirmed account', s.mail.length === before);
    ok('no session created for the duplicate attempt', !(await b.page.evaluate(() => !!localStorage.getItem('stash-auth'))));
    ok('no second account created', s.users.size === 1);
  });

  await T('05 email verification link', browser, async s => {
    const { page } = await mk(browser, s);
    await signupUI(page); const link = lastMail(s, 'signup').link;
    await page.goto(link); ok('verified -> signed in -> dashboard (profile complete from signup)', await waitHash(page, '#dashboard'));
    ok('URL cleaned of ?code', !(await page.evaluate(() => location.search)));
    ok('dashboard visible', await vis(page, '#view-dashboard'));
    const again = await mk(browser, s);   // same single-use link reopened
    await again.page.goto(link); await again.page.waitForTimeout(500);
    ok('re-used / other-browser link -> login with notice', (await hash(again.page)) === '#login' && /couldn.t finish|invalid/i.test(await txt(again.page, '#loginNotice')));
    await loginUI(again.page); ok('can log in after verification', await waitHash(again.page, '#dashboard'));
  });

  await T('06 expired / invalid links', browser, async s => {
    const { page } = await mk(browser, s);
    await open(page, '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await page.waitForTimeout(200);
    ok('expired hash error -> login with clear notice', (await hash(page)) === '#login' && /invalid or has expired/i.test(await txt(page, '#loginNotice')));
    ok('notice offers password reset', await vis(page, '#loginNotice button'));
    await open(page, '?code=bogus'); await page.waitForTimeout(200);
    ok('bogus code -> login + notice, not signed in', (await hash(page)) === '#login' && await vis(page, '#loginNotice'));
    await page.goto(BASE + '#reset-password'); await page.waitForTimeout(300);
    ok('#reset-password without a reset link -> login', (await hash(page)) === '#login');
  });

  await T('07 login + session persistence', browser, async s => {
    const a = await mk(browser, s); await verifyAndLogin(browser, s, a.page);
    await a.page.click('#logoutBtn'); await a.page.waitForTimeout(300);
    ok('logout -> login, session cleared', (await hash(a.page)) === '#login' && !(await a.page.evaluate(() => !!localStorage.getItem('stash-auth'))));
    await a.page.goto(BASE + '#dashboard'); await a.page.waitForTimeout(300); ok('after logout dashboard is guarded', (await hash(a.page)) === '#login');
    await loginUI(a.page, U.email, 'wrong-password-1'); ok('wrong password -> clear error, stays on login', /don.t match/i.test(await txt(a.page, '#loginError')) && (await hash(a.page)) === '#login');
    await loginUI(a.page, 'nobody@example.com', U.pw); ok('unknown email -> same error (no enumeration)', /don.t match/i.test(await txt(a.page, '#loginError')));
    await loginUI(a.page, 'not-an-email', U.pw); ok('matric/non-email -> helpful message', /email address/i.test(await txt(a.page, '#loginError')));
    await loginUI(a.page); ok('valid login -> dashboard', await waitHash(a.page, '#dashboard'));
    await a.page.reload(); await a.page.waitForTimeout(500);
    ok('refresh keeps the session (still dashboard)', (await hash(a.page)) === '#dashboard' && await vis(a.page, '#view-dashboard'));
    ok('greeting uses server profile name', /Ada/.test(await txt(a.page, '#greeting')));
    const dump = await storageDump(a.page); ok('no password in browser storage after login', !dump.includes(U.pw) && !/"password"/.test(dump));
  });

  await T('08 remember-me off = this tab only', browser, async s => {
    const a = await mk(browser, s); await verifyAndLogin(browser, s, a.page);
    await a.page.click('#logoutBtn'); await a.page.waitForTimeout(200);
    await loginUI(a.page, U.email, U.pw, false);
    const where = await a.page.evaluate(() => ({ l: !!localStorage.getItem('stash-auth'), s: !!sessionStorage.getItem('stash-auth') }));
    ok('session kept in sessionStorage only', where.s && !where.l, JSON.stringify(where));
    const b = await mk(browser, s, { context: a.ctx }); await open(b.page, '#dashboard');
    ok('a brand-new tab is NOT signed in', (await hash(b.page)) === '#login');
  });

  await T('09 network failures', browser, async s => {
    const a = await mk(browser, s); await verifyAndLogin(browser, s, a.page);
    await a.page.click('#logoutBtn'); await a.page.waitForTimeout(200);
    s.flags.offline = true;
    await loginUI(a.page); ok('login offline -> network message', /reach the server/i.test(await txt(a.page, '#loginError')));
    await open(a.page, '#signup'); await fillSignup(a.page, U, { email: 'new@example.com', matric: '22/1111' });
    await a.page.click('#signupForm button[type=submit]'); await a.page.waitForTimeout(300);
    ok('signup offline -> network message, form kept', /reach the server/i.test(await txt(a.page, '#signupError')) && await vis(a.page, '#signupForm'));
    await a.page.click('#openForgotModal').catch(() => {});
    s.flags.offline = false; s.flags.rateLimit = true;
    await loginUI(a.page); ok('rate limit -> clear message', /too many/i.test(await txt(a.page, '#loginError')));
  });

  await T('10 Google: new student -> onboarding', browser, async s => {
    const { page } = await mk(browser, s);
    await open(page, '#login'); await page.click('#googleLoginBtn'); await page.waitForTimeout(800);
    const oauthCall = s.log.find(l => l.op === 'oauthStart');
    ok('OAuth start asked to return to this site\'s URL with no hash/params', !!oauthCall && oauthCall.p.redirect === BASE);
    ok('callback -> signed in, INCOMPLETE profile -> onboarding', await waitHash(page, '#onboarding'));
    ok('?code removed from URL', !(await page.evaluate(() => location.search)));
    ok('onboarding shows Google email + prefilled name', (await txt(page, '#obEmail')) === s.google.email && (await page.inputValue('#obName')) === s.google.name);
    ok('no password field is asked of a Google user', (await page.locator('#view-onboarding input[type=password]').count()) === 0);
    for (const r of ['dashboard', 'documents', 'upload', 'clearance', 'cafepin', 'profile', 'settings', 'help']) {
      await page.goto(BASE + '#' + r); await page.waitForTimeout(150);
      if ((await hash(page)) !== '#onboarding') ok('route ' + r + ' blocked until onboarding done', false);
    }
    ok('all 8 app routes redirect to onboarding while incomplete', true);
    const bad = [['name', { n: 'A', m: '20/1', l: '100L' }, /full name/i], ['matric', { n: 'Gina G', m: '??', l: '100L' }, /matric/i], ['level', { n: 'Gina G', m: '20/5555', l: '' }, /level/i]];
    for (const [label, v, re] of bad) {
      await page.fill('#obName', v.n); await page.fill('#obMatric', v.m); await page.selectOption('#obLevel', v.l);
      await page.click('#onboardingForm button[type=submit]'); await page.waitForTimeout(150);
      ok('onboarding rejects bad ' + label, re.test(await txt(page, '#onboardingError')) && (await hash(page)) === '#onboarding');
    }
    ok('nothing was saved by invalid attempts', s.log.filter(l => l.op === 'rpc').length === 0);
    await page.fill('#obName', 'Gina Google'); await page.fill('#obMatric', ' 20 / 5555 '.replace(/ /g, '')); await page.selectOption('#obLevel', '300L');
    await page.click('#onboardingForm button[type=submit]');
    ok('valid onboarding -> dashboard', await waitHash(page, '#dashboard'));
    const prof = [...s.profiles.values()][0]; ok('persisted: name, matric, level', prof.full_name === 'Gina Google' && prof.matric_number === '20/5555' && prof.level === '300L');
    await page.reload(); await page.waitForTimeout(400); ok('refresh stays on dashboard', (await hash(page)) === '#dashboard');
    await page.click('#logoutBtn'); await page.waitForTimeout(300);
    await open(page, '#login'); await page.click('#googleLoginBtn'); await page.waitForTimeout(800);
    ok('returning Google student with complete profile -> straight to dashboard', await waitHash(page, '#dashboard'));
  });

  await T('11 Google: matric already used + denied consent', browser, async s => {
    const a = await mk(browser, s); await verifyAndLogin(browser, s, a.page);   // Ada owns 20/1234
    s.google = { email: 'second@gmail.com', name: 'Second Student' };
    const b = await mk(browser, s); await open(b.page, '#login'); await b.page.click('#googleLoginBtn'); await waitHash(b.page, '#onboarding');
    await b.page.fill('#obName', 'Second Student'); await b.page.fill('#obMatric', '20/1234'); await b.page.selectOption('#obLevel', '100L');
    await b.page.click('#onboardingForm button[type=submit]'); await b.page.waitForTimeout(300);
    ok('duplicate matric -> neutral error, still onboarding', /couldn.t register that matric/i.test(await txt(b.page, '#onboardingError')) && (await hash(b.page)) === '#onboarding');
    s.flags.googleDeny = true;
    const c = await mk(browser, s); await open(c.page, '#login'); await c.page.click('#googleLoginBtn'); await c.page.waitForTimeout(800);
    ok('Google consent denied -> login with notice, not signed in', (await hash(c.page)) === '#login' && /didn.t complete/i.test(await txt(c.page, '#loginNotice')));
  });

  await T('12 Google user links to existing email account', browser, async s => {
    const a = await mk(browser, s); await verifyAndLogin(browser, s, a.page);
    s.google = { email: U.email, name: 'Ada Okafor' };
    await a.page.click('#logoutBtn'); await a.page.waitForTimeout(200);
    await open(a.page, '#login'); await a.page.click('#googleLoginBtn');
    ok('same verified email via Google -> dashboard, one account only', await waitHash(a.page, '#dashboard') && s.users.size === 1);
  });

  await T('13 forgot + reset password (event path AND fallback path)', browser, async s => {
    for (const emitEvent of [false, true]) {
      s.reset(); s.flags.emitRecoveryEvent = emitEvent;
      const a = await mk(browser, s); await verifyAndLogin(browser, s, a.page);
      await a.page.click('#logoutBtn'); await a.page.waitForTimeout(200);
      const tag = emitEvent ? '[PASSWORD_RECOVERY event]' : '[no event: fallback]';
      await open(a.page, '#login'); await a.page.click('#openForgotModal');
      await a.page.fill('#forgotId', 'nobody@example.com'); await a.page.click('#forgotForm button[type=submit]'); await a.page.waitForTimeout(300);
      const unknownMsg = await txt(a.page, '#forgotConfirmation'); const mailsAfterUnknown = s.mail.filter(m => m.kind === 'recovery').length;
      await a.page.click('#closeForgotModal'); await a.page.click('#openForgotModal');
      await a.page.fill('#forgotId', U.email); await a.page.click('#forgotForm button[type=submit]'); await a.page.waitForTimeout(300);
      ok(tag + ' unknown vs known email -> identical confirmation', (await txt(a.page, '#forgotConfirmation')) === unknownMsg && /if an account exists/i.test(unknownMsg));
      ok(tag + ' mail only for the real account', mailsAfterUnknown === 0 && s.mail.filter(m => m.kind === 'recovery').length === 1);
      await a.page.fill('#forgotId', 'not-an-email'); await a.page.click('#forgotForm button[type=submit]');
      ok(tag + ' invalid email format rejected', /email address/i.test(await txt(a.page, '#forgotError')));
      const link = lastMail(s, 'recovery').link;
      await a.page.goto(link);
      ok(tag + ' reset link -> reset-password screen', await waitHash(a.page, '#reset-password'));
      await a.page.goto(BASE + '#dashboard'); await a.page.waitForTimeout(300);
      ok(tag + ' app is locked until a new password is set', (await hash(a.page)) === '#reset-password');
      await a.page.fill('#rpNew', 'newpass-12345'); await a.page.fill('#rpConfirm', 'other-12345'); await a.page.click('#resetForm button[type=submit]'); await a.page.waitForTimeout(150);
      ok(tag + ' mismatch rejected', /match/i.test(await txt(a.page, '#resetError')));
      await a.page.fill('#rpNew', 'short'); await a.page.fill('#rpConfirm', 'short'); await a.page.click('#resetForm button[type=submit]'); await a.page.waitForTimeout(150);
      ok(tag + ' short password rejected', /8 characters/.test(await txt(a.page, '#resetError')));
      await a.page.fill('#rpNew', U.pw); await a.page.fill('#rpConfirm', U.pw); await a.page.click('#resetForm button[type=submit]'); await a.page.waitForTimeout(300);
      ok(tag + ' reusing the old password refused by server', /different/i.test(await txt(a.page, '#resetError')));
      await a.page.fill('#rpNew', 'newpass-12345'); await a.page.fill('#rpConfirm', 'newpass-12345'); await a.page.click('#resetForm button[type=submit]');
      ok(tag + ' new password saved -> dashboard', await waitHash(a.page, '#dashboard'));
      ok(tag + ' server password actually changed', s.byEmail(U.email).password === 'newpass-12345');
      await a.page.click('#logoutBtn'); await a.page.waitForTimeout(200);
      await loginUI(a.page, U.email, U.pw); ok(tag + ' old password no longer works', /don.t match/i.test(await txt(a.page, '#loginError')));
      await loginUI(a.page, U.email, 'newpass-12345'); ok(tag + ' new password works', await waitHash(a.page, '#dashboard'));
      const b = await mk(browser, s); await b.page.goto(link); await b.page.waitForTimeout(500);
      ok(tag + ' used link cannot be reused', (await hash(b.page)) === '#login' && await vis(b.page, '#loginNotice'));
    }
  });

  await T('14 reset link opened in a different browser', browser, async s => {
    const a = await mk(browser, s); await verifyAndLogin(browser, s, a.page); await a.page.click('#logoutBtn'); await a.page.waitForTimeout(200);
    await open(a.page, '#login'); await a.page.click('#openForgotModal'); await a.page.fill('#forgotId', U.email); await a.page.click('#forgotForm button[type=submit]'); await a.page.waitForTimeout(300);
    const b = await mk(browser, s); await b.page.goto(lastMail(s, 'recovery').link); await b.page.waitForTimeout(500);
    ok('different browser -> safe failure notice, NOT signed in', (await hash(b.page)) === '#login' && /request a new link/i.test(await txt(b.page, '#loginNotice')));
  });

  await T('15 route protection (signed out)', browser, async s => {
    const { page } = await mk(browser, s);
    for (const r of ['dashboard', 'documents', 'upload', 'clearance', 'cafepin', 'profile', 'settings', 'help', 'onboarding', 'reset-password']) {
      await open(page, '#' + r); if ((await hash(page)) !== '#login') ok('signed-out ' + r + ' -> login', false, await hash(page));
    }
    ok('all protected + onboarding + reset routes redirect signed-out visitors to login', true);
    for (const r of ['landing', 'login', 'signup', 'print-portal']) { await open(page, '#' + r); ok('public route ' + r + ' reachable', (await hash(page)) === '#' + r); }
    await open(page, '#bogus'); ok('unknown route -> landing', (await hash(page)) === '#landing');
    ok('landing legacy #pricing still scrolls to pricing', await (async () => { await open(page, '#pricing'); await page.waitForTimeout(800); return (await hash(page)) === '#landing' && await page.evaluate(() => Math.abs(document.getElementById('pricing-section').getBoundingClientRect().top) < 160); })());
  });

  await T('16 signed-in users bounce off auth pages', browser, async s => {
    const { page } = await mk(browser, s); await verifyAndLogin(browser, s, page);
    for (const r of ['login', 'signup', 'onboarding']) { await open(page, '#' + r); ok('signed-in ' + r + ' -> dashboard', await waitHash(page, '#dashboard')); }
    for (const r of ['documents', 'upload', 'clearance', 'cafepin', 'profile', 'settings', 'help']) { await open(page, '#' + r); await page.waitForTimeout(150); if ((await hash(page)) !== '#' + r) ok('app route ' + r + ' renders when signed in', false); }
    ok('all app routes load for a complete signed-in student', true);
  });

  await T('17 profile page + server rules', browser, async s => {
    const { page } = await mk(browser, s); await verifyAndLogin(browser, s, page);
    await open(page, '#profile');
    ok('matric is read-only once set', await page.evaluate(() => document.getElementById('pMatric').readOnly));
    ok('email is read-only', await page.evaluate(() => document.getElementById('pEmail').readOnly));
    await page.fill('#pName', 'Ada N. Okafor'); await page.selectOption('#pLevel', '300L'); await page.fill('#pDepartment', 'Computer Science');
    await page.click('#profileForm button[type=submit]'); await page.waitForTimeout(400);
    const p = [...s.profiles.values()][0]; ok('name + level saved on the server', p.full_name === 'Ada N. Okafor' && p.level === '300L' && p.matric_number === '20/1234');
    await page.evaluate(() => { document.getElementById('pMatric').readOnly = false; document.getElementById('pMatric').value = 'FU/99/9999'; });
    await page.click('#profileForm button[type=submit]'); await page.waitForTimeout(400);
    ok('editing matric in dev tools does NOT change it (server keeps stored matric)', [...s.profiles.values()][0].matric_number === '20/1234');
    const direct = s.op_rpc({ token: [...s.tokens.keys()][0], name: 'save_my_profile', args: { p_full_name: 'Ada', p_matric: 'FU/99/9999', p_level: '300L' } });
    ok('server refuses matric change (matric_locked)', direct.error && /matric_locked/.test(direct.error.message));
  });

  await T('18 change password + delete account', browser, async s => {
    const { page } = await mk(browser, s); await verifyAndLogin(browser, s, page);
    await open(page, '#settings');
    await page.fill('#cpCurrent', 'wrong-pass-123'); await page.fill('#cpNew', 'brand-new-123'); await page.fill('#cpConfirm', 'brand-new-123');
    await page.click('#changePasswordForm button[type=submit]'); await page.waitForTimeout(300);
    ok('wrong current password rejected', /incorrect/i.test(await txt(page, '#changePasswordError')));
    await page.fill('#cpCurrent', U.pw); await page.fill('#cpNew', 'short'); await page.fill('#cpConfirm', 'short');
    await page.click('#changePasswordForm button[type=submit]'); await page.waitForTimeout(200);
    ok('short new password rejected', /8 characters/.test(await txt(page, '#changePasswordError')));
    await page.fill('#cpCurrent', U.pw); await page.fill('#cpNew', 'brand-new-123'); await page.fill('#cpConfirm', 'brand-new-123');
    await page.click('#changePasswordForm button[type=submit]'); await page.waitForTimeout(400);
    ok('password changed on the server', s.byEmail(U.email).password === 'brand-new-123');
    await page.click('#deleteAccountBtn'); await page.fill('#deleteAccountPassword', 'nope-nope-1'); await page.click('#deleteAccountForm button[type=submit]'); await page.waitForTimeout(300);
    ok('delete with wrong password refused', /incorrect/i.test(await txt(page, '#deleteAccountError')) && s.users.size === 1);
    await page.fill('#deleteAccountPassword', 'brand-new-123'); await page.click('#deleteAccountForm button[type=submit]'); await page.waitForTimeout(600);
    ok('account + profile removed on server', s.users.size === 0 && s.profiles.size === 0);
    ok('signed out afterwards and local data removed', await page.evaluate(() => !localStorage.getItem('stash-auth') && !JSON.parse(localStorage.getItem('stash_users') || '{}')[Object.keys(JSON.parse(localStorage.getItem('stash_users') || '{}'))[0]]));
    await loginUI(page, U.email, 'brand-new-123'); ok('cannot log in to a deleted account', /don.t match/i.test(await txt(page, '#loginError')));
  });

  await T('19 Google user: no password UI, delete by typing DELETE', browser, async s => {
    const { page } = await mk(browser, s); await open(page, '#login'); await page.click('#googleLoginBtn'); await waitHash(page, '#onboarding');
    await page.fill('#obName', 'Gina Google'); await page.fill('#obMatric', '20/5555'); await page.selectOption('#obLevel', '100L'); await page.click('#onboardingForm button[type=submit]'); await waitHash(page, '#dashboard');
    await open(page, '#settings');
    await page.fill('#cpCurrent', 'x'); await page.fill('#cpNew', 'brand-new-123'); await page.fill('#cpConfirm', 'brand-new-123'); await page.click('#changePasswordForm button[type=submit]'); await page.waitForTimeout(300);
    ok('change-password explains Google sign-in', /Google/.test(await txt(page, '#changePasswordError')));
    await page.click('#deleteAccountBtn'); ok('delete asks to type DELETE', /DELETE/.test(await txt(page, '#deleteAccountLabel')));
    await page.fill('#deleteAccountPassword', 'delete'); await page.click('#deleteAccountForm button[type=submit]'); await page.waitForTimeout(250);
    ok('wrong confirmation text refused', s.users.size === 1);
    await page.fill('#deleteAccountPassword', 'DELETE'); await page.click('#deleteAccountForm button[type=submit]'); await page.waitForTimeout(600);
    ok('Google account deleted', s.users.size === 0);
  });

  await T('20 legacy demo data is neutralised', browser, async s => {
    const { page } = await mk(browser, s);
    await page.addInitScript(() => { if (!localStorage.getItem('__seeded')) {
      localStorage.setItem('__seeded', '1');
      localStorage.setItem('stash_users', JSON.stringify({ u_old: { id: 'u_old', name: 'Old', matric: '1', email: 'old@x.com', password: 'plaintext-secret', plan: 'pro', documents: [] }, u_g: { id: 'u_g', email: 'google.demo@school.edu', password: '__google__', documents: [] } }));
      localStorage.setItem('stash_session', JSON.stringify({ userId: 'u_old' })); } });
    await open(page, '#dashboard');
    const dump = await storageDump(page);
    ok('legacy plaintext passwords removed from storage', !dump.includes('plaintext-secret') && !dump.includes('__google__'));
    ok('legacy demo session removed + not signed in', (await hash(page)) === '#login' && !dump.includes('"stash_session"'));
    ok('demo Google account record removed', !dump.includes('google.demo@school.edu'));
    await loginUI(page, 'old@x.com', 'plaintext-secret'); ok('old demo credentials do not log in', (await hash(page)) === '#login');
  });

  await T('21 paid access cannot be set from the browser', browser, async s => {
    const { page } = await mk(browser, s); await verifyAndLogin(browser, s, page);
    await page.evaluate(() => { const u = JSON.parse(localStorage.getItem('stash_users')); Object.values(u).forEach(r => { r.plan = 'pro'; r.role = 'admin'; }); localStorage.setItem('stash_users', JSON.stringify(u)); });
    await page.reload(); await page.waitForTimeout(500);
    const plan = await page.evaluate(async () => (await Auth.currentUser()).plan);
    ok('editing localStorage plan/role has no effect (plan always free)', plan === 'free');
  });

  await T('22 static checks', browser, async () => {
    const root = path.join(__dirname, '..', '..');
    const files = ['index.html', 'script.js', 'auth.js', 'env-config.js', 'landing.css'].map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]);
    const bad = [/__google__/, /GOOGLE-DEMO/, /service_role/i, /sb_secret_/, /user\.password/, /\bpassword:\s*password/];
    for (const [f, c] of files) for (const re of bad) if (re.test(c) && !(f === 'script.js' && /google\.demo/.test(re.source))) ok(`${f} must not contain ${re}`, false);
    ok('no demo-auth strings / service-role / secret keys in shipped files', true);
    const script = files.find(f => f[0] === 'script.js')[1];
    ok('no console.log of auth data', !/console\.(log|info|debug)\([^)]*(password|token|session)/i.test(script + files.find(f => f[0] === 'auth.js')[1]));
    ok('no setItem of a password', !/setItem\([^)]*password/i.test(script));
    ok('index.html has no "(Demo)" Google label', !/Continue with Google \(Demo\)/.test(files[0][1]));
    ok('env-config.js committed blank', /SUPABASE_URL: ""/.test(files.find(f => f[0] === 'env-config.js')[1]));
  });

  await browser.close();
  const failed = results.filter(r => !r.pass);
  const byTest = {}; results.forEach(r => { (byTest[r.test] = byTest[r.test] || { p: 0, f: 0 })[r.pass ? 'p' : 'f']++; });
  console.log('\n=== SUMMARY ===');
  Object.entries(byTest).forEach(([t, c]) => console.log((c.f ? 'FAIL ' : 'PASS ') + t + `  (${c.p} ok${c.f ? ', ' + c.f + ' failed' : ''})`));
  console.log(`\nTOTAL ${results.length} checks, ${failed.length} failed`);
  fs.writeFileSync(path.join(__dirname, 'last-results.json'), JSON.stringify({ total: results.length, failed: failed.length, byTest, failures: failed }, null, 1));
  process.exit(failed.length ? 1 : 0);
})();
