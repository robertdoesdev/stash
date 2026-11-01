/* Regression tests for defects found in the independent security review.
 * Run against any build with:  BASE=http://localhost:PORT/index.html node tests/e2e/hardening.e2e.js */
const { chromium } = require('playwright');
const { MockServer, installBackend, BASE, U } = require('./harness');
const results = []; let current = '';
const ok = (n, c, x) => { results.push({ t: current, n, pass: !!c }); console.log((c ? '  PASS ' : '  FAIL ') + n + (c ? '' : (x ? '  -> ' + x : ''))); };
const hash = p => p.evaluate(() => location.hash);
const waitHash = (p, h, t = 4000) => p.waitForFunction(x => location.hash === x, h, { timeout: t }).then(() => true, () => false);
const txt = (p, s) => p.locator(s).first().innerText().catch(() => '');
const ready = p => p.waitForFunction(() => window.StashAuth && window.StashAuth.state.ready);
const open = async (p, h = '') => { await p.goto(BASE + h); await ready(p); await p.waitForTimeout(150); };
async function mk(browser, server, ctx) {
  const c = ctx || await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await c.newPage(); await installBackend(page, server); return { ctx: c, page };
}
async function signupAndConfirm(page, s, over = {}) {
  const v = { ...U, ...over };
  await open(page, '#signup');
  await page.fill('#suName', v.name); await page.fill('#suMatric', v.matric); await page.selectOption('#suLevel', v.level);
  await page.fill('#suEmail', v.email); await page.fill('#suPassword', v.pw); await page.fill('#suConfirmPassword', v.pw);
  await page.click('#signupForm button[type=submit]'); await page.waitForTimeout(300);
  await page.goto([...s.mail].reverse().find(m => m.kind === 'signup' && m.to === v.email).link); await waitHash(page, '#dashboard');
}
async function login(page, email = U.email, pw = U.pw, remember = true) {
  await open(page, '#login'); await page.fill('#loginId', email); await page.fill('#loginPassword', pw);
  if (!remember) await page.uncheck('#rememberMe');
  await page.click('#loginForm button[type=submit]'); await waitHash(page, '#dashboard');
}
async function T(name, fn) { current = name; console.log('\n' + name); try { await fn(); } catch (e) { ok('threw: ' + e.message.split('\n')[0], false); } }

(async () => {
  const browser = await chromium.launch();

  await T('H1 logout ends THIS device only, and revokes it server-side', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signupAndConfirm(a.page, s);
    const b = await mk(browser, s); await login(b.page);
    await a.page.click('#logoutBtn'); await a.page.waitForTimeout(500);
    ok('device A is signed out', (await hash(a.page)) === '#login');
    ok('device A\'s server session was revoked', ![...s.tokens.values()].length || [...s.tokens.keys()].length === 1);
    await b.page.reload(); await ready(b.page); await b.page.waitForTimeout(400);
    ok('device B is STILL signed in after A logged out', (await hash(b.page)) === '#dashboard');
  });

  await T('H2 reset link opened in a NEW tab works after a "don\'t remember me" login', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signupAndConfirm(a.page, s);
    await a.page.click('#logoutBtn'); await a.page.waitForTimeout(300);
    await login(a.page, U.email, U.pw, false); await a.page.click('#logoutBtn'); await a.page.waitForTimeout(300);
    await open(a.page, '#login'); await a.page.click('#openForgotModal'); await a.page.fill('#forgotId', U.email);
    await a.page.click('#forgotForm button[type=submit]'); await a.page.waitForTimeout(400);
    const link = [...s.mail].reverse().find(m => m.kind === 'recovery').link;
    const tab = await a.ctx.newPage(); await installBackend(tab, s);        // mail clients open links in a new tab
    await tab.goto(link); await ready(tab);
    ok('new tab lands on the reset-password screen (verifier survived)', await waitHash(tab, '#reset-password'));
  });

  await T('H3 only an INVALID session signs you out (not 429 / 5xx / outages)', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signupAndConfirm(a.page, s);
    for (const code of [500, 429, 503]) {
      s.flags.getUserStatus = code; await a.page.reload(); await ready(a.page); await a.page.waitForTimeout(300);
      ok(`server answers ${code} -> still signed in`, (await hash(a.page)) === '#dashboard');
    }
    s.flags.getUserStatus = 401; await a.page.reload(); await ready(a.page); await a.page.waitForTimeout(300);
    ok('server answers 401 (invalid session) -> signed out', (await hash(a.page)) === '#login');
    ok('signed-out state cleared the stored session', !(await a.page.evaluate(() => localStorage.getItem('stash-auth'))));
  });

  await T('H4 matric conflicts: neutral wording + throttle (no existence oracle)', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signupAndConfirm(a.page, s);           // Ada owns 20/1234
    s.google = { email: 'prober@gmail.com', name: 'Prober' };
    const b = await mk(browser, s); await open(b.page, '#login'); await b.page.click('#googleLoginBtn'); await waitHash(b.page, '#onboarding');
    const msgs = [];
    for (let i = 0; i < 6; i++) {
      await b.page.fill('#obName', 'Prober One'); await b.page.fill('#obMatric', '20/1234'); await b.page.selectOption('#obLevel', '100L');
      await b.page.click('#onboardingForm button[type=submit]'); await b.page.waitForTimeout(250); msgs.push(await txt(b.page, '#onboardingError'));
    }
    ok('first 5 attempts get the same neutral message', msgs.slice(0, 5).every(m => m === msgs[0]) && /couldn.t register that matric/i.test(msgs[0]), msgs[0]);
    ok('message does NOT say the number is taken / registered / belongs to someone', !msgs.some(m => /already|taken|registered to|another (account|student)|belongs/i.test(m)), msgs[0]);
    ok('6th attempt is throttled', /too many attempts/i.test(msgs[5]), msgs[5]);
    ok('no profile was created for the prober', ![...s.profiles.values()].some(p => p.email === 'prober@gmail.com' && p.matric_number));
  });

  await T('H5 unverified sign-ups cannot squat a matric number', async () => {
    const s = new MockServer(); const sq = await mk(browser, s);
    await open(sq.page, '#signup'); await sq.page.fill('#suName', 'Squat Ter'); await sq.page.fill('#suMatric', '20/7777'); await sq.page.selectOption('#suLevel', '100L');
    await sq.page.fill('#suEmail', 'throwaway@example.com'); await sq.page.fill('#suPassword', 'correct-horse-9'); await sq.page.fill('#suConfirmPassword', 'correct-horse-9');
    await sq.page.click('#signupForm button[type=submit]'); await sq.page.waitForTimeout(300);
    const sqProfile = [...s.profiles.values()].find(p => p.email === 'throwaway@example.com');
    ok('unverified account holds NO matric number on the server', sqProfile && !sqProfile.matric_number, JSON.stringify(sqProfile));
    s.google = { email: 'owner@gmail.com', name: 'Real Owner' };
    const o = await mk(browser, s); await open(o.page, '#login'); await o.page.click('#googleLoginBtn'); await waitHash(o.page, '#onboarding');
    await o.page.fill('#obName', 'Real Owner'); await o.page.fill('#obMatric', '20/7777'); await o.page.selectOption('#obLevel', '100L');
    await o.page.click('#onboardingForm button[type=submit]');
    ok('the real owner can onboard with that matric number', await waitHash(o.page, '#dashboard'));
  });

  await T('H6 refuses to run if Supabase "Confirm email" is switched off', async () => {
    const s = new MockServer(); s.flags.confirmDisabled = true; const a = await mk(browser, s);
    await open(a.page, '#signup'); await a.page.fill('#suName', 'No Verify'); await a.page.fill('#suMatric', '20/0001'); await a.page.selectOption('#suLevel', '100L');
    await a.page.fill('#suEmail', 'nv@example.com'); await a.page.fill('#suPassword', 'correct-horse-9'); await a.page.fill('#suConfirmPassword', 'correct-horse-9');
    await a.page.click('#signupForm button[type=submit]'); await a.page.waitForTimeout(400);
    ok('sign-up is refused with a neutral message', /temporarily unavailable/i.test(await txt(a.page, '#signupError')));
    ok('no session was kept and the app is not entered', !(await a.page.evaluate(() => localStorage.getItem('stash-auth'))) && (await hash(a.page)) !== '#dashboard');
  });

  await T('H7 profile page: matric locked, correction path shown', async () => {
    const s = new MockServer(); const a = await mk(browser, s); await signupAndConfirm(a.page, s);
    await open(a.page, '#profile');
    ok('matric input is read-only', await a.page.evaluate(() => document.getElementById('pMatric').readOnly));
    ok('visible hint explains how to correct it', /contact support/i.test(await txt(a.page, '#matricHint')) && await a.page.locator('#matricHint').isVisible());
  });

  await browser.close();
  const failed = results.filter(r => !r.pass).length;
  console.log(`\nHARDENING: ${results.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
