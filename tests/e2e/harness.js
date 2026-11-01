/* Shared browser-test harness: installs the Supabase test double into a page. */
const fs = require('fs'); const path = require('path');
const { MockServer } = require('./mock-server');
const SHIM = fs.readFileSync(path.join(__dirname, 'supabase-shim.js'), 'utf8');
const BASE = process.env.BASE || 'http://localhost:8767/index.html';
const U = { name: 'Ada Okafor', matric: '20/1234', level: '200L', email: 'ada@example.com', pw: 'correct-horse-9' };
const JS = body => ({ contentType: 'application/javascript', body });

async function installBackend(page, server, { unconfigured = false } = {}) {
  // anything off-localhost is blocked, except the Supabase client which is replaced by the shim
  await page.route(/^https?:\/\/(?!localhost)/, r => r.request().url().includes('@supabase/supabase-js') ? r.fulfill(JS(SHIM)) : r.abort());
  await page.route('**/vendor/supabase.js', r => r.fulfill(JS(SHIM)));    // self-hosted copy (once vendored)
  await page.route('**/env-config.js', r => r.fulfill(JS(unconfigured
    ? 'window.STASH_ENV={SUPABASE_URL:"",SUPABASE_ANON_KEY:""};'
    : 'window.STASH_ENV={SUPABASE_URL:"https://mock.supabase.co",SUPABASE_ANON_KEY:"sb_publishable_mock"};')));
  await page.exposeFunction('__srv', (op, p) => server.handle(op, p));
  await page.addInitScript(f => { window.__mockEmitRecovery = f; }, !!server.flags.emitRecoveryEvent);
}
module.exports = { MockServer, installBackend, BASE, U, SHIM };
