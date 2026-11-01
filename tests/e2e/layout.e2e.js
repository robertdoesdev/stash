/* Responsive layout checks for every auth screen state. Saves screenshots to tests/e2e/shots/. */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const { MockServer, installBackend, BASE } = require('./harness'); const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const widths = [320, 360, 390, 430, 768, 1280, 1440];
let fails = 0, checks = 0;
(async () => {
  const browser = await chromium.launch();
  for (const w of widths) {
    const s = new MockServer();
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 700 ? 800 : 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await installBackend(page, s);
    const go = async h => { await page.goto('about:blank'); await page.goto(BASE + h); await page.waitForFunction(() => window.StashAuth && window.StashAuth.state.ready); await page.waitForTimeout(250); };
    const measure = async (name, visibleSel) => {
      checks++;
      const r = await page.evaluate(sel => {
        const vw = document.documentElement.clientWidth;
        const el = document.querySelector(sel);
        const rect = el && el.getBoundingClientRect();
        const wide = [...document.querySelectorAll('#authShell .auth-panel *')].filter(e => { const b = e.getBoundingClientRect(); return b.width && getComputedStyle(e).display !== 'none' && (b.right > vw + 1 || b.left < -1); }).slice(0, 3).map(e => e.tagName + '#' + e.id + '.' + e.className);
        const clipped = [...document.querySelectorAll('#authShell .auth-panel .btn, #authShell .auth-panel input, #authShell .auth-panel select')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && e.tagName === 'BUTTON').map(e => e.textContent.trim().slice(0, 20));
        const small = [...document.querySelectorAll('#authShell .auth-panel input:not([type=checkbox]), #authShell .auth-panel select, #authShell .auth-panel button.btn')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 40).map(e => e.id || e.className);
        return { sw: document.documentElement.scrollWidth, vw, shown: !!(rect && rect.width > 0), wide, clipped, small };
      }, visibleSel);
      const bad = r.sw > r.vw || !r.shown || r.wide.length || r.clipped.length;
      if (bad || r.small.length) { fails += bad ? 1 : 0; console.log(`${bad ? 'FAIL' : 'NOTE'} ${w}px ${name}`, JSON.stringify(r)); }
      await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: true });
    };
    await go('#login'); await measure('login', '#loginForm');
    await go('#error=access_denied&error_code=otp_expired&error_description=x'); await measure('login-notice', '#loginNotice');
    await go('#signup'); await measure('signup', '#signupForm');
    await page.fill('#suName', 'Ada Okafor'); await page.fill('#suMatric', '20/1234'); await page.selectOption('#suLevel', '200L'); await page.fill('#suEmail', 'ada@example.com'); await page.fill('#suPassword', 'correct-horse-9'); await page.fill('#suConfirmPassword', 'nomatch-9999'); await page.click('#signupForm button[type=submit]'); await page.waitForTimeout(150);
    await measure('signup-error', '#signupError');
    await page.fill('#suConfirmPassword', 'correct-horse-9'); await page.click('#signupForm button[type=submit]'); await page.waitForTimeout(300);
    await measure('signup-success', '#signupSuccess');
    await go('#login'); await page.click('#openForgotModal'); await page.waitForTimeout(150);
    checks++; const m = await page.evaluate(() => { const b = document.querySelector('#forgotModal .modal').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; }); if (!m) { fails++; console.log('FAIL forgot modal off-screen', w); }
    await page.screenshot({ path: path.join(OUT, `forgot-${w}.png`) });
    await page.click('#closeForgotModal');
    await go('#login'); await page.click('#googleLoginBtn'); await page.waitForFunction(() => location.hash === '#onboarding'); await page.waitForTimeout(250); await measure('onboarding', '#onboardingForm');
    await page.click('#obLogout'); await page.waitForTimeout(300);
    // recovery screen
    s.users.forEach(u => { u.confirmed = true; });
    await go('#login'); await page.fill('#loginId', 'ada@example.com'); await page.click('#openForgotModal'); await page.click('#forgotForm button[type=submit]'); await page.waitForTimeout(300);
    await page.click('#closeForgotModal');
    const link = [...s.mail].reverse().find(m => m.kind === 'recovery');
    if (link) { await page.goto(link.link); await page.waitForFunction(() => location.hash === '#reset-password'); await page.waitForTimeout(250); await measure('reset', '#resetForm'); } else { checks++; fails++; console.log('FAIL no recovery mail at', w); }
    checks++; if (errs.length) { fails++; console.log('FAIL js errors', w, errs); }
    await ctx.close();
  }
  await browser.close();
  console.log(`\nLAYOUT: ${checks} checks, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
