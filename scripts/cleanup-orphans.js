#!/usr/bin/env node
/* Operator job: removes Storage objects that no longer belong to any document row.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<secret> node scripts/cleanup-orphans.js            (dry run)
 *   ... node scripts/cleanup-orphans.js --apply [--max=500]
 *
 * Needs the SERVICE-ROLE key, so run it ONLY from your own machine or a private scheduler. NEVER put that key in
 * this repository, in Vercel variables that reach the build, or in frontend code. The key is read from the
 * environment, sent only to your Supabase project, and never printed.
 *
 * Removes: (1) objects of deleted accounts (public.storage_deletion_queue) and (2) objects with no document row.
 * Only REPORTS (never changes): ready rows whose object is missing, and failed/deleting rows stuck for over a day. */
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const apply = process.argv.includes('--apply'); const maxArg = process.argv.find(a => a.startsWith('--max=')); const MAX = maxArg ? Number(maxArg.slice(6)) : 500;
if (!URL_ || !KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(2); }
if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(URL_) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(URL_)) { console.error('SUPABASE_URL does not look like a Supabase project URL.'); process.exit(2); }
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
(async () => {
  const r = await fetch(URL_ + '/rest/v1/rpc/orphan_report', { method: 'POST', headers: H, body: '{}' });
  if (!r.ok) { console.error('orphan_report failed: HTTP ' + r.status + ' (is migration 0003 applied, and is this the service-role key?)'); process.exit(2); }
  const rep = await r.json();
  const queue = rep.deletion_queue || [], loose = rep.objects_without_row || [];
  const targets = [...new Set([...queue, ...loose])];
  console.log('objects of deleted accounts : ' + queue.length + '\nobjects without a row       : ' + loose.length);
  console.log('REPORT ONLY - ready rows missing their object: ' + (rep.ready_rows_without_object || []).length + ' | failed/deleting rows older than a day: ' + (rep.stale_failed_rows || []).length);
  if (!targets.length) { console.log('Nothing to remove.'); return; }
  if (targets.length > MAX) { console.error('Refusing to remove ' + targets.length + ' objects (limit ' + MAX + '). Investigate, then re-run with --max=' + targets.length + '.'); process.exit(1); }
  if (!apply) { console.log('Dry run: ' + targets.length + ' object(s) WOULD be removed. Re-run with --apply.'); return; }
  let removed = 0, failed = 0;
  for (let i = 0; i < targets.length; i += 100) {
    const batch = targets.slice(i, i + 100);
    const d = await fetch(URL_ + '/storage/v1/object/documents', { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: batch }) });
    if (!d.ok) { failed += batch.length; console.error('storage delete failed for a batch: HTTP ' + d.status); continue; }
    removed += batch.length;
    const inQueue = batch.filter(p => queue.includes(p));
    if (inQueue.length) await fetch(URL_ + '/rest/v1/storage_deletion_queue?storage_path=in.(' + inQueue.map(p => '"' + p + '"').join(',') + ')', { method: 'DELETE', headers: H });
  }
  console.log('Removed ' + removed + ' object(s); ' + failed + ' failed (queue rows kept for the next run).'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('cleanup-orphans: ' + e.message); process.exit(2); });
