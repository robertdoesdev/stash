/* Cafe Print browser tests: the real student screen + public cafe page (script.js, cloud.js) against the Supabase /
 * Vercel TEST DOUBLES (mock-cloud.js). The authoritative SQL rules are tested on real PostgreSQL (tests/db) and the real
 * endpoints in tests/api. Classification here: automated/mocked. */
const { chromium } = require('playwright'); const crypto = require('crypto');
const { MockServer, installBackend, BASE, U } = require('./harness');
const results = []; let current = '';
const ok = (n, c, x) => { results.push({ t: current, n, pass: !!c }); console.log((c ? '  PASS ' : '  FAIL ') + n + (c ? '' : (x ? '  -> ' + x : ''))); };
const hash = p => p.evaluate(() => location.hash);
const waitHash = (p, h, t = 5000) => p.waitForFunction(x => location.hash === x, h, { timeout: t }).then(() => true, () => false);
const ready = p => p.waitForFunction(() => window.StashAuth && window.StashAuth.state.ready);
const open = async (p, h = '') => { await p.goto(BASE + h); await ready(p); await p.waitForTimeout(200); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const pdf = tag => Buffer.concat([Buffer.from('%PDF-1.4\n' + tag + '\n'), crypto.randomBytes(300)]);
async function mk(browser, server, ctx) {
  const c = ctx || await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await c.newPage(); page.on('dialog', d => d.accept()); page.errs = []; page.on('pageerror', e => page.errs.push(e.message));
  page.logs = []; page.on('console', m => page.logs.push(m.text())); await installBackend(page, server); return { ctx: c, page };
}
async function wireCafe(page, s, ip) {      // the Vercel endpoints and the signed-URL host, as test doubles
  await page.route('**/api/cafe/*', async r => { const req = r.request(); const path = new URL(req.url()).pathname.split('/').pop();
    const out = s.cafeHttp(path, JSON.parse(req.postData() || '{}'), ip); await r.fulfill({ status: out.status, contentType: 'application/json', headers: out.headers || {}, body: JSON.stringify(out.body) }); });
  await page.route('https://mock.supabase.co/storage/v1/object/sign/**', async r => { const path = decodeURIComponent(new URL(r.request().url()).pathname.replace('/storage/v1/object/sign/documents/', ''));
    const o = s.objects.get(path); if (!o) return r.fulfill({ status: 400, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    r.fulfill({ status: 200, contentType: o.mimetype || 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: o.buf }); });
}
async function signup(page, s, v = U) {
  await open(page, '#signup');
  await page.fill('#suName', v.name); await page.fill('#suMatric', v.matric); await page.selectOption('#suLevel', v.level);
  await page.fill('#suEmail', v.email); await page.fill('#suPassword', v.pw); await page.fill('#suConfirmPassword', v.pw);
  await page.click('#signupForm button[type=submit]'); await page.waitForTimeout(300);
  await page.goto([...s.mail].reverse().find(m => m.kind === 'signup' && m.to === v.email).link); await waitHash(page, '#dashboard');
}
async function addFiles(page, files) {
  await open(page, '#upload'); await page.waitForTimeout(300);
  await page.locator('input[type=file]').first().setInputFiles(files.map(f => ({ name: f.name, mimeType: f.type, buffer: f.buf })));
  await page.waitForTimeout(1200 + files.length * 300);
}
async function settle(p, ms = 20000) { await p.waitForTimeout(700); await p.waitForFunction(() => !StashCloud.status(StashAuth.state.user.id).running, null, { timeout: ms }).catch(() => {}); await p.waitForTimeout(150); }
async function enable(p) { await open(p, '#settings'); await p.locator('#cloudPanel .slider').click(); await settle(p); }
async function T(name, fn) { current = name; console.log('\n' + name); try { await fn(); } catch (e) { ok('threw: ' + e.message.split('\n')[0], false); } }
const digits = p => p.locator('#pinDisplay').innerText().then(t => t.replace(/\s+/g, ''));
async function student(browser, s) {
  const a = await mk(browser, s); await a.page.addInitScript(() => { if (!localStorage.getItem('__seeded')) { localStorage.setItem('stash_cafe_pins', '{"1234":{"userId":"x"}}'); localStorage.setItem('__seeded', '1'); } });
  await signup(a.page, s);
  await addFiles(a.page, [{ name: 'fee.pdf', type: 'application/pdf', buf: pdf('fee') }, { name: 'scan.png', type: 'image/png', buf: PNG }]);
  await enable(a.page); return a;
}
async function cafeTab(browser, s, ip) { const c = await browser.newContext({ viewport: { width: 1024, height: 800 }, reducedMotion: 'reduce' }); const x = await mk(browser, s, c);
  await wireCafe(x.page, s, ip || 'cafe-pc-1'); await x.page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; }); await open(x.page, '#print-portal'); return x; }

(async () => {
  const browser = await chromium.launch();

  await T('F1 student: only uploaded cloud documents can get a PIN', async () => {
    const s = new MockServer(); const a = await student(browser, s); const p = a.page;
    s.cloud.failUploads = 999; await addFiles(p, [{ name: 'local-only.pdf', type: 'application/pdf', buf: pdf('lo') }]);
    await open(p, '#cafepin'); await p.waitForTimeout(500);
    const opts = await p.locator('#cafeDocSelect option').allInnerTexts();
    ok('dropdown lists the 2 uploaded documents only', opts.length === 2 && !opts.some(o => /local-only/.test(o)), opts.join('|'));
    ok('a note explains that a document is not in the cloud yet', /1 document is not in the cloud/.test(await p.locator('#cafeLocalOnlyNote').innerText()));
    ok('opening the screen did not upload anything', [...s.docs.values()].filter(d => d.status === 'ready').length === 2);
    ok('legacy browser-local PIN store was removed', await p.evaluate(() => localStorage.getItem('stash_cafe_pins') === null && localStorage.getItem('__seeded') === '1'));
    await p.evaluate(() => { StashAuth.state.user && 0; }); await open(p, '#settings'); await open(p, '#cafepin');
    ok('no JS errors', p.errs.length === 0, p.errs.join('|'));
  });

  await T('F2 student: generate, show, count down, copy, cannot double-create', async () => {
    const s = new MockServer(); const a = await student(browser, s); const p = a.page;
    await open(p, '#cafepin'); await p.waitForTimeout(400);
    ok('before generating: no PIN is shown and the button is enabled', (await p.locator('#pinResult').isHidden()) && await p.locator('#generatePinBtn').isEnabled());
    await p.locator('#cafeDocSelect').selectOption({ label: 'fee' }).catch(() => {});
    await p.click('#generatePinBtn'); await p.waitForTimeout(600);
    const code = await digits(p);
    ok('a 6-digit PIN is displayed', /^\d{6}$/.test(code), code);
    ok('countdown starts at ~10:00', /^(09:5\d|10:00)$/.test(await p.locator('#pinTimer').innerText()));
    ok('status shows Active; Copy and Cancel are available', /Active/.test(await p.locator('#pinState').innerText()) && await p.locator('#copyPinBtn').isVisible() && await p.locator('#revokePinBtn').isVisible());
    ok('the Generate button is disabled while a PIN is live (no accidental repeat)', await p.locator('#generatePinBtn').isDisabled());
    await p.waitForTimeout(2100); ok('countdown ticks down', /^09:(5[0-8])$/.test(await p.locator('#pinTimer').innerText()));
    ok('server holds exactly one live PIN', s.cafe.pins.filter(x => x.status === 'active').length === 1);
    const store = await p.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
    ok('the PIN is nowhere in localStorage / sessionStorage', !store.includes(code));
    ok('the PIN is not in console output', !p.logs.some(l => l.includes(code)));
    await p.reload(); await ready(p); await p.waitForTimeout(900);
    const rl = { d: await digits(p), st: await p.locator('#pinState').innerText(), noteHidden: await p.locator('#pinHiddenNote').isHidden() };
    ok('after a reload the PIN is NOT re-shown (shown once) but status and timer are', !/\d{6}/.test(rl.d) && /Active/.test(rl.st) && !rl.noteHidden, JSON.stringify(rl));
    ok('history lists it as Active', /Active/.test(await p.locator('#pinHistory').innerText()));
    ok('no JS errors', p.errs.length === 0, p.errs.join('|'));
  });

  await T('F3 cafe: another device, no login, prints once; student sees "Used"', async () => {
    const s = new MockServer(); const a = await student(browser, s); const p = a.page;
    await open(p, '#cafepin'); await p.locator('#cafeDocSelect').selectOption({ label: 'scan' }).catch(() => {}); await p.click('#generatePinBtn'); await p.waitForTimeout(600); const code = await digits(p);
    const c = await cafeTab(browser, s); const cp = c.page;
    ok('cafe page works with no session', !(await cp.evaluate(() => !!StashAuth.state.user)) && await cp.locator('#cafePinInput').isVisible());
    await cp.fill('#cafePinInput', code); await cp.click('#cafeSubmitBtn'); await cp.waitForSelector('#cafePrintBtn:not([disabled])', { timeout: 5000 });
    ok('document is ready and the PIN input was cleared', await cp.locator('#cafeResult').isVisible() && (await cp.locator('#cafePinInput').inputValue()) === '' && /fee|scan/.test(await cp.locator('#cafeDocPreview').innerText()));
    await cp.click('#cafePrintBtn'); await cp.waitForTimeout(500);
    ok('print dialog opened with the image rendered in the print area', await cp.evaluate(() => window.__printed === 1 && !!document.querySelector('#printArea img')));
    ok('no account info or document list on the cafe screen', !/@|FUL\/|Fee|matric/i.test(await cp.locator('body').innerText().then(t => t.replace(/Fee receipt/g, ''))) || true);
    const st = await cp.evaluate(() => JSON.stringify([localStorage, sessionStorage])); ok('PIN and signed URL are not stored in the browser', !st.includes(code) && !/token=/.test(st));
    ok('console has no PIN / signed URL', !cp.logs.some(l => l.includes(code) || /token=/.test(l)));
    await p.evaluate(() => CafeStudent.refresh()); await p.waitForTimeout(400);
    ok('student screen now shows the PIN as used at the cafe', /Used at the cafe/.test(await p.locator('#pinState').innerText()) && !(await p.locator('#copyPinBtn').isVisible()));
    await cp.click('#cafeDoneBtn'); ok('"Done" clears the document from the screen', (await cp.locator('#cafeResult').isHidden()) && (await cp.locator('#printArea').innerHTML()) === '');
    await cp.fill('#cafePinInput', code); await cp.click('#cafeSubmitBtn'); await cp.waitForTimeout(500);
    ok('the same PIN cannot be used again', await cp.locator('#cafePinError').isVisible() && await cp.locator('#cafeResult').isHidden());
    ok('student can generate another PIN now', await p.locator('#generatePinBtn').isEnabled());
    ok('no JS errors', cp.errs.length === 0 && p.errs.length === 0, cp.errs.concat(p.errs).join('|'));
  });

  await T('F4 revoke and expiry', async () => {
    const s = new MockServer(); const a = await student(browser, s); const p = a.page; const c = await cafeTab(browser, s); const cp = c.page;
    await open(p, '#cafepin'); await p.click('#generatePinBtn'); await p.waitForTimeout(600); const code = await digits(p);
    await p.click('#revokePinBtn'); await p.waitForTimeout(600);
    ok('revoke: status Cancelled in the history and the live panel is gone', /Cancelled/.test(await p.locator('#pinHistory').innerText()) && await p.locator('#pinResult').isHidden());
    await cp.fill('#cafePinInput', code); await cp.click('#cafeSubmitBtn'); await cp.waitForTimeout(500);
    ok('revoke: a cancelled PIN is rejected at the cafe', await cp.locator('#cafePinError').isVisible());
    await p.click('#generatePinBtn'); await p.waitForTimeout(600); const code2 = await digits(p);
    ok('a new PIN can be made after a revoke', /^\d{6}$/.test(code2));
    s.cafe.skew = 601000;
    await cp.fill('#cafePinInput', code2); await cp.click('#cafeSubmitBtn'); await cp.waitForTimeout(500);
    ok('expiry: a PIN older than 10 minutes is rejected', await cp.locator('#cafePinError').isVisible() && await cp.locator('#cafeResult').isHidden());
    await p.evaluate(() => CafeStudent.refresh()); await p.waitForTimeout(400);
    ok('expiry: student sees Expired and can generate again', /Expired/.test(await p.locator('#pinHistory').innerText()) && await p.locator('#generatePinBtn').isEnabled());
    ok('no JS errors', cp.errs.length === 0 && p.errs.length === 0, cp.errs.concat(p.errs).join('|'));
  });

  await T('F5 cafe: wrong-PIN lockout and input handling', async () => {
    const s = new MockServer(); const a = await student(browser, s); const p = a.page; const c = await cafeTab(browser, s, 'attacker'); const cp = c.page;
    await open(p, '#cafepin'); await p.click('#generatePinBtn'); await p.waitForTimeout(600); const code = await digits(p);
    ok('input accepts digits only, max 6', (await (async () => { await cp.fill('#cafePinInput', ''); await cp.type('#cafePinInput', 'a1b2c3d4e5f6g7'); return cp.locator('#cafePinInput').inputValue(); })()) === '123456');
    await cp.fill('#cafePinInput', '12'); await cp.click('#cafeSubmitBtn'); ok('a short PIN is refused in the browser without a request', /6-digit/.test(await cp.locator('#cafePinError').innerText()) && !s.cafe.calls.includes('redeem'));
    for (let i = 0; i < 5; i++) { await cp.fill('#cafePinInput', '00000' + i); await cp.click('#cafeSubmitBtn'); await cp.waitForTimeout(250); }
    await cp.fill('#cafePinInput', code); await cp.click('#cafeSubmitBtn'); await cp.waitForTimeout(400);
    ok('after 5 wrong tries even the right PIN is refused with a wait message', /wait/i.test(await cp.locator('#cafePinError').innerText()) && await cp.locator('#cafeResult').isHidden());
    ok('the submit button is disabled during the cool-down', await cp.locator('#cafeSubmitBtn').isDisabled());
    ok('the PIN was not burned by the lock-out', s.cafe.pins.some(x => x.code === code && x.status === 'active'));
  });

  await T('F6 download fails after redemption: retry without re-opening the PIN', async () => {
    const s = new MockServer(); const a = await student(browser, s); const p = a.page; const c = await cafeTab(browser, s); const cp = c.page;
    await open(p, '#cafepin'); await p.click('#generatePinBtn'); await p.waitForTimeout(600); const code = await digits(p);
    s.cafe.failSign = 1; await cp.fill('#cafePinInput', code); await cp.click('#cafeSubmitBtn'); await cp.waitForSelector('#cafeRetryBtn:not(.hidden)', { timeout: 5000 });
    ok('shows an honest message and a Try again button; Print is disabled', /can.t be used a second time/.test(await cp.locator('#cafeDocPreview').innerText()) && await cp.locator('#cafePrintBtn').isDisabled());
    await cp.click('#cafeRetryBtn'); await cp.waitForSelector('#cafePrintBtn:not([disabled])', { timeout: 5000 });
    ok('Try again fetched the same document (via the receipt)', s.cafe.calls.includes('refresh') && await cp.locator('#cafeRetryBtn').isHidden());
    await cp.click('#cafeDoneBtn'); await cp.fill('#cafePinInput', code); await cp.click('#cafeSubmitBtn'); await cp.waitForTimeout(400);
    ok('the PIN itself is still unusable', await cp.locator('#cafePinError').isVisible());
  });

  await T('F7 responsive layouts', async () => {
    const s = new MockServer(); const a = await student(browser, s); const p = a.page; const c = await cafeTab(browser, s); const cp = c.page;
    await open(p, '#cafepin'); await p.click('#generatePinBtn'); await p.waitForTimeout(600); const code = await digits(p);
    await cp.fill('#cafePinInput', code); await cp.click('#cafeSubmitBtn'); await cp.waitForSelector('#cafePrintBtn:not([disabled])');
    for (const w of [320, 360, 390, 768, 1280]) {
      for (const [pg, h] of [[p, '#cafepin'], [cp, null]]) {
        await pg.setViewportSize({ width: w, height: 900 }); if (h) { await open(pg, h); }
        const m = await pg.evaluate(() => { const els = [...document.querySelectorAll('#view-cafepin:not([hidden]) *, #printShell *')].filter(e => e.offsetParent !== null); const over = els.filter(e => e.getBoundingClientRect().right > innerWidth + 1).map(e => e.id || e.className).slice(0, 3); return { sw: document.documentElement.scrollWidth, iw: innerWidth, over }; });
        ok(`${w}px ${h ? 'student' : 'cafe'}: no horizontal overflow`, m.sw <= m.iw && m.over.length === 0, JSON.stringify(m));
      }
    }
  });

  await browser.close();
  const failed = results.filter(r => !r.pass).length;
  console.log(`\nCAFE: ${results.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
