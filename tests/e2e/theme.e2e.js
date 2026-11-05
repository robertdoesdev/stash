/* Theme tests (light / dark / system). Run: node tests/e2e/theme.e2e.js
 *   needs `playwright` and a static server:  python3 -m http.server 8767   from the project root
 * Frontend only: the auth backend is the same test double as the other e2e suites; nothing here
 * changes or measures backend behaviour. */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { MockServer, installBackend, BASE, U } = require('./harness');
const ROOT = path.join(__dirname, '..', '..');

const results = []; let current = '';
const ok = (name, cond, extra) => { results.push({ test: current, name, pass: !!cond }); if (!cond) console.log('  FAIL', current, '::', name, extra || ''); };
const theme = p => p.evaluate(() => document.documentElement.getAttribute('data-theme'));
const saved = p => p.evaluate(() => localStorage.getItem('stash_theme'));
const rootBg = p => p.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
const ready = p => p.waitForFunction(() => window.StashAuth && StashAuth.state.ready);

// WCAG contrast audit of every visible text node (runs in the page).
const AUDIT = () => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const over = (t, b) => { const a = t.a + b.a * (1 - t.a); return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: (t.r * t.a + b.r * b.a * (1 - t.a)) / a, g: (t.g * t.a + b.g * b.a * (1 - t.a)) / a, b: (t.b * t.a + b.b * b.a * (1 - t.a)) / a, a }; };
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { const st = []; let e = el; while (e && e.nodeType === 1) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none') return null; const c = parse(cs.backgroundColor); if (c && c.a > 0) { st.push(c); if (c.a === 1) break; } e = e.parentElement; } let acc = { r: 255, g: 255, b: 255, a: 1 }; for (let i = st.length - 1; i >= 0; i--) acc = over(st[i], acc); return acc; };
  const out = []; const seen = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const t = w.currentNode; const txt = t.textContent.trim(); if (txt.length < 2) continue;
    const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    if (el.closest('[hidden],.hidden,script,style,svg,.sprite,.toast,option')) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    let o = 1, e = el; while (e) { o *= +getComputedStyle(e).opacity; e = e.parentElement; } if (o < 0.5) continue;
    const fg = parse(cs.color); const bg = bgOf(el); if (!fg || !bg) continue;
    const f = over({ ...fg, a: fg.a * Math.min(1, o) }, bg); const L1 = lum(f), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700; const need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
    if (ratio < need) out.push(`${txt.slice(0, 30)} (${ratio.toFixed(2)} < ${need})`);
  }
  return out;
};

(async () => {
  // ---------- static: every id the scripts look up still exists in index.html ----------
  current = 'S1 integration hooks';
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const missing = [];
  const made = new Set();   // ids the scripts create themselves (e.g. the PDF preview pane)
  for (const f of ['script.js', 'auth.js', 'cloud.js']) for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/\bid="([A-Za-z0-9_-]+)"/g)) made.add(m[1]);
  for (const f of ['script.js', 'auth.js', 'cloud.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'\s*\)/g)) if (!ids.has(m[1]) && !made.has(m[1])) missing.push(f + ':' + m[1]);
  }
  ok('every getElementById(\'literal\') in script.js/auth.js/cloud.js exists in index.html' + (missing.length ? ' missing: ' + missing.join(',') : ''), missing.length === 0, missing.join(','));
  ok('Supabase / auth / cloud scripts still loaded in the same order', /vendor\/supabase\.js[\s\S]*auth\.js[\s\S]*cloud\.js[\s\S]*script\.js/.test(html));

  const browser = await chromium.launch();
  const mk = async (o = {}) => {
    const s = o.server || new MockServer();
    const ctx = o.context || await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', colorScheme: o.scheme || 'light' });
    if (o.saved) await ctx.addInitScript(t => { try { localStorage.setItem('stash_theme', t); } catch (e) {} }, o.saved);
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await installBackend(page, s); return { s, ctx, page, errs };
  };

  // ---------- T1: correct theme BEFORE any app script runs (no wrong-theme flash) ----------
  current = 'T1 no flash';
  for (const [scheme, savedT, expect] of [['dark', null, 'dark'], ['light', null, 'light'], ['dark', 'light', 'light'], ['light', 'dark', 'dark']]) {
    const { page, ctx } = await mk({ scheme, saved: savedT });
    await page.route('**/script.js', r => r.abort());     // app JS never runs: only the <head> script can have set the theme
    await page.route('**/auth.js', r => r.abort());
    await page.goto(BASE + '#landing', { waitUntil: 'domcontentloaded' });
    const t = await theme(page); const bg = await rootBg(page);
    ok(`OS ${scheme}, saved ${savedT || 'none'} -> ${expect} before app scripts`, t === expect, t);
    ok(`  ... and the page background already matches (${expect})`, expect === 'dark' ? bg === 'rgb(11, 13, 46)' : bg === 'rgb(243, 245, 255)', bg);
    await ctx.close();
  }

  // ---------- T2: toggles on every screen, persistence, accessible names ----------
  current = 'T2 toggle + persistence';
  {
    const { page, s, ctx, errs } = await mk({ scheme: 'light' });
    await page.goto(BASE + '#landing'); await ready(page);
    ok('landing starts light (device preference, nothing saved)', (await theme(page)) === 'light' && (await saved(page)) === null);
    const pub = page.locator('#marketingNav .theme-toggle-public');
    ok('landing toggle is visible and named', await pub.isVisible() && /dark/i.test(await pub.getAttribute('aria-label')));
    await pub.click(); await page.waitForTimeout(100);
    ok('click -> dark, saved, label now offers light', (await theme(page)) === 'dark' && (await saved(page)) === 'dark' && /light/i.test(await pub.getAttribute('aria-label')));
    await page.reload(); await ready(page);
    ok('survives a reload', (await theme(page)) === 'dark');
    await page.evaluate(() => { location.hash = '#login'; }); await page.waitForTimeout(250);
    ok('survives navigation to login', (await theme(page)) === 'dark');
    const auth = page.locator('#authShell .theme-toggle-auth');
    ok('login toggle visible', await auth.isVisible());
    await auth.click(); await page.waitForTimeout(100);
    ok('login toggle flips to light', (await theme(page)) === 'light' && (await saved(page)) === 'light');
    await page.evaluate(() => { location.hash = '#signup'; }); await page.waitForTimeout(250);
    ok('signup keeps the choice', (await theme(page)) === 'light' && await page.locator('#authShell .theme-toggle-auth').isVisible());
    // sign in (same flow as the auth suite) and use the app toggle
    await page.fill('#suName', U.name); await page.fill('#suMatric', U.matric); await page.selectOption('#suLevel', U.level);
    await page.fill('#suEmail', U.email); await page.fill('#suPassword', U.pw); await page.fill('#suConfirmPassword', U.pw);
    await page.click('#signupForm button[type=submit]'); await page.waitForTimeout(400);
    await page.goto([...s.mail].reverse().find(m => m.kind === 'signup').link); await page.waitForFunction(() => location.hash === '#dashboard', null, { timeout: 5000 }).catch(() => {});
    await ready(page);
    ok('app shell reached (existing auth flow unchanged)', (await page.evaluate(() => location.hash)) === '#dashboard');
    ok('choice kept after sign-in', (await theme(page)) === 'light');
    const top = page.locator('#themeToggleBtn');
    ok('topbar toggle visible, id preserved', await top.isVisible());
    await top.click(); await page.waitForTimeout(100);
    ok('topbar toggle -> dark', (await theme(page)) === 'dark' && /light/i.test(await top.getAttribute('aria-label')));
    await page.evaluate(() => { location.hash = '#settings'; }); await page.waitForTimeout(300);
    ok('Settings highlights Night', await page.locator('#segDark').evaluate(e => e.classList.contains('active')));
    await page.click('#segLight'); await page.waitForTimeout(100);
    ok('Settings Daylight -> light', (await theme(page)) === 'light' && (await saved(page)) === 'light');
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ---------- T3: System option follows the device live ----------
  current = 'T3 system';
  {
    const { page, s, ctx } = await mk({ scheme: 'light', saved: 'dark' });
    await page.goto(BASE + '#signup'); await ready(page);
    await page.fill('#suName', U.name); await page.fill('#suMatric', U.matric); await page.selectOption('#suLevel', U.level);
    await page.fill('#suEmail', U.email); await page.fill('#suPassword', U.pw); await page.fill('#suConfirmPassword', U.pw);
    await page.click('#signupForm button[type=submit]'); await page.waitForTimeout(400);
    await page.goto([...s.mail].reverse().find(m => m.kind === 'signup').link); await ready(page);
    await page.evaluate(() => { location.hash = '#settings'; }); await page.waitForTimeout(300);
    ok('saved dark beats a light device', (await theme(page)) === 'dark');
    await page.click('#segSystem'); await page.waitForTimeout(150);
    ok('System clears the saved choice and follows the device (light)', (await saved(page)) === null && (await theme(page)) === 'light');
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(500);
    ok('device switches to dark -> app follows live', (await theme(page)) === 'dark');
    await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(500);
    ok('device back to light -> app follows live', (await theme(page)) === 'light');
    await page.click('#segDark'); await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(300);
    ok('an explicit choice is NOT overridden by device changes', (await theme(page)) === 'dark');
    await ctx.close();
  }

  // ---------- T4: two tabs stay in step ----------
  current = 'T4 cross-tab';
  {
    const a = await mk({ scheme: 'light' });
    await a.page.goto(BASE + '#landing'); await ready(a.page);
    const b = await mk({ context: a.ctx, server: a.s });
    await b.page.goto(BASE + '#landing'); await ready(b.page);
    await a.page.locator('#marketingNav .theme-toggle-public').click(); await a.page.waitForTimeout(400);
    ok('toggle in tab A updates tab B', (await theme(b.page)) === 'dark');
    await a.ctx.close();
  }

  // ---------- T5: contrast (WCAG AA) on every public screen and app view, both themes ----------
  current = 'T5 contrast';
  for (const th of ['light', 'dark']) {
    const { page, s, ctx } = await mk({ scheme: th, saved: th });
    const go = async h => { await page.goto(BASE + h); await ready(page); await page.waitForTimeout(250); };
    const audit = async name => { const bad = await page.evaluate(AUDIT); ok(`${th}: ${name} - no text below AA contrast`, bad.length === 0, bad.slice(0, 5).join(' ; ')); };
    await go('#landing'); await audit('landing');
    await go('#login'); await audit('login');
    await go('#signup'); await audit('signup');
    await go('#login'); await page.click('#openForgotModal'); await page.waitForTimeout(200); await audit('forgot-password modal'); await page.click('#closeForgotModal');
    await go('#signup'); await page.fill('#suName', U.name); await page.fill('#suMatric', U.matric); await page.selectOption('#suLevel', U.level);
    await page.fill('#suEmail', U.email); await page.fill('#suPassword', U.pw); await page.fill('#suConfirmPassword', U.pw);
    await page.click('#signupForm button[type=submit]'); await page.waitForTimeout(400); await audit('signup confirmation');
    await page.goto([...s.mail].reverse().find(m => m.kind === 'signup').link); await ready(page); await page.waitForTimeout(500);
    for (const v of ['dashboard', 'documents', 'upload', 'clearance', 'cafepin', 'profile', 'settings', 'help']) { await go('#' + v); await audit(v); }
    await go('#print-portal'); await audit('cafe print portal');
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log('\n=== SUMMARY ===');
  const by = {}; results.forEach(r => { (by[r.test] = by[r.test] || { ok: 0, bad: 0 })[r.pass ? 'ok' : 'bad']++; });
  for (const [t, c] of Object.entries(by)) console.log((c.bad ? 'FAIL ' : 'PASS ') + t + `  (${c.ok} ok${c.bad ? ', ' + c.bad + ' failed' : ''})`);
  console.log(`\nTHEME: ${results.length} checks, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})();