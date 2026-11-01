/* Regression: landing page vs approved Phase 1 build (pixel diff) + signed-in vault smoke test. */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const { MockServer, installBackend } = require('./harness');
const NEW = 'http://localhost:8767/index.html', OLD = 'http://localhost:8768/index.html'; const OUT = path.join(__dirname, 'shots');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let failed = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) failed++; };
(async () => {
  const b = await chromium.launch(); const { PNG: P } = { PNG };
  const PixelDiff = (a, c) => { const { PNG: PNGlib } = require('pngjs'); };
  for (const w of [390, 1280]) {
    const shots = {};
    for (const [tag, url] of [['old', OLD], ['new', NEW]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' }); const p = await ctx.newPage();
      await p.route(/^https?:\/\/(?!localhost)/, r => r.abort());
      await p.goto(url + '#landing'); await p.waitForTimeout(900);
      shots[tag] = await p.screenshot({ fullPage: true }); fs.writeFileSync(path.join(OUT, `landing-${tag}-${w}.png`), shots[tag]); await ctx.close();
    }
    const pyr = require('child_process').spawnSync('python3', ['-c', `
from PIL import Image, ImageChops
a=Image.open('${OUT}/landing-old-${w}.png').convert('RGB'); b=Image.open('${OUT}/landing-new-${w}.png').convert('RGB')
if a.size!=b.size: print('SIZE',a.size,b.size)
else:
    d=ImageChops.difference(a,b); bb=d.getbbox(); print('IDENTICAL' if not bb else 'DIFF %s'%(bb,))`]);
    ok(`landing @${w}px identical to approved Phase 1`, /IDENTICAL/.test(pyr.stdout.toString()), pyr.stdout.toString().trim());
  }
  // vault smoke test as a signed-in student
  const s = new MockServer(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await installBackend(p, s);
  await p.goto(NEW + '#signup'); await p.fill('#suName', 'Ada Okafor'); await p.fill('#suMatric', '20/1234'); await p.selectOption('#suLevel', '200L'); await p.fill('#suEmail', 'ada@example.com'); await p.fill('#suPassword', 'correct-horse-9'); await p.fill('#suConfirmPassword', 'correct-horse-9'); await p.click('#signupForm button[type=submit]'); await p.waitForTimeout(300);
  await p.goto(s.mail[0].link); await p.waitForFunction(() => location.hash === '#dashboard'); await p.waitForTimeout(300);
  ok('dashboard renders with real session', /Ada/.test(await p.locator('#greeting').innerText()));
  await p.goto(NEW + '#upload'); await p.waitForTimeout(400);
  fs.writeFileSync('/tmp/claude-0/-home-claude/2ab04c2a-1abe-5095-8e13-e2afc7e7dd8d/scratchpad/tiny.png', PNG);
  const inputs = await p.locator('input[type=file]').count(); ok('upload screen has file input', inputs > 0);
  await p.locator('input[type=file]').first().setInputFiles('/tmp/claude-0/-home-claude/2ab04c2a-1abe-5095-8e13-e2afc7e7dd8d/scratchpad/tiny.png'); await p.waitForTimeout(1500);
  await p.goto(NEW + '#documents'); await p.waitForTimeout(500);
  const docCount = await p.evaluate(async () => (await DB.getDocuments((await Auth.currentUser()).id)).length);
  ok('document uploaded and stored under the Supabase user id', docCount === 1, 'docs=' + docCount);
  const uid = await p.evaluate(async () => (await Auth.currentUser()).id);
  ok('local record is keyed by the auth user id (UUID) and has no password', /^[0-9a-f-]{36}$/.test(uid) && !(await p.evaluate(() => localStorage.getItem('stash_users').includes('password'))));
  await p.goto(NEW + '#cafepin'); await p.waitForTimeout(500);
  const sel = await p.locator('#cafeDocSelect, #cafeSelect, select').first().evaluate(e => e.id).catch(() => '');
  const pinBtn = p.locator('#generatePinBtn, #cafeGenerateBtn, button:has-text("Generate")').first();
  if (await pinBtn.count()) { await p.locator('select').first().selectOption({ index: 1 }).catch(() => {}); await pinBtn.click(); await p.waitForTimeout(500); }
  const pins = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('stash_cafe_pins') || '{}')).length);
  ok('Cafe PIN generation still works', pins === 1, 'pins=' + pins);
  await p.goto(NEW + '#print-portal'); await p.waitForTimeout(300);
  ok('public Cafe Print portal reachable signed-in', (await p.evaluate(() => location.hash)) === '#print-portal');
  for (const r of ['clearance', 'settings', 'help', 'profile']) { await p.goto(NEW + '#' + r); await p.waitForTimeout(350); }
  ok('clearance/settings/help/profile render without JS errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(failed ? `\nREGRESSION: ${failed} FAILED` : '\nREGRESSION: all passed'); process.exit(failed ? 1 : 0);
})();
