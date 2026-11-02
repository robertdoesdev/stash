# Phase 3 setup and real-service test checklist

Everything below is **to be done by you on a DEV Supabase project first**. None of it has been run. No new Vercel variables or secrets are needed by the website.

## 0. Prerequisites
Phase 2 setup complete (`SETUP_PHASE2.md`), including `node scripts/vendor-deps.js --update` (still **not done**: the sandbox could not reach the npm registry).

## 1. Apply the migration (dev project, SQL Editor)
Run in order if not already applied: `0001_profiles.sql`, `0002_hardening.sql`, then **`0003_documents.sql`**. It is idempotent. It creates tables, functions, the **private** bucket `documents` (10 MiB, PDF/JPEG/PNG) and the three Storage policies on `storage.objects`.
Check in the dashboard: Storage → bucket `documents` exists and is **not** public; Storage → Policies lists `docs_select_own`, `docs_insert_pending`, `docs_delete_removable`; Table Editor → `documents`, `user_entitlements`, `storage_deletion_queue` show RLS enabled.
If the SQL editor refuses the `storage.objects` policies, create the same three policies in Storage → Policies using the SQL in the migration, and tell me; that is assumption 2 in `PHASE3_PLAN.md`.

## 2. Automated check against the real project
```bash
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_ANON_KEY=<anon key> \
TEST_EMAIL=... TEST_PASSWORD=... TEST2_EMAIL=... TEST2_PASSWORD=... node scripts/verify-supabase.js
```
Use two dedicated, email-verified **dev** accounts. It uploads, finalizes, downloads and deletes a 12-byte test PDF, probes account B against account A, and checks anon lockout and the private bucket. Expect every line `PASS`. A `FAIL` on "finalize_upload reads the REAL object size" means assumption 6 is wrong for your project: stop and report it.

## 3. Choose who is "paid" (testing only, no payment code exists)
```sql
insert into public.user_entitlements(user_id, tier) values ('<user uuid>', 'paid')
on conflict (user_id) do update set tier = 'paid', updated_at = now();
```
Run in the SQL editor only. The app has no way to set this.

## 4. Manual checklist (dev, real browser)
- [ ] Settings → Cloud storage is **off**; uploading a document sends nothing to the cloud.
- [ ] Switch it on → confirmation text → documents upload; Settings shows "N of N backed up and verified" and "x of 1 GB used".
- [ ] Storage → `documents` → `<your user id>/<doc id>`: objects exist, you cannot open one without a signed-in session (public URL fails).
- [ ] Open/preview/download a document after clearing site data on that device (file comes from the cloud).
- [ ] Second browser/device, same account: switch on → documents appear; opening one downloads it.
- [ ] Edit a document's name/category on one device → appears on the other after Sync now.
- [ ] Set your account's limit tiny to test quota (in `storage_limit_bytes`, **dev only**) or fill 1 GB; confirm a file over quota stays local with the "storage full" message and nothing exceeds the limit (`select * from public.my_storage_usage()` equivalent: Settings line).
- [ ] Turn Wi-Fi off during an upload → retries, resumes on reconnect, no duplicate rows (`select count(*), local_ref from documents group by 2`).
- [ ] Delete a document → row and object disappear; usage drops.
- [ ] Account B cannot see A's documents (covered by step 2; repeat by hand once).
- [ ] Delete account → documents/objects gone; run `node scripts/cleanup-orphans.js` (dry run) and confirm it lists nothing unexpected.
- [ ] Layout of the new Settings row on a phone.

## 5. Operator job: orphan cleanup
```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=<secret> node scripts/cleanup-orphans.js          # dry run
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=<secret> node scripts/cleanup-orphans.js --apply
```
The service-role key is **never** committed, never given to Vercel, never in frontend code; run this from your own machine or a private scheduler. Run weekly, and after any bulk account deletion. It removes objects of deleted accounts and objects with no row, refuses large batches without `--max`, and only *reports* ready rows missing their object and failed/deleting rows stuck over a day.

## 6. Production
Repeat sections 1-2 on the prod project; verify the CSP report-only console is clean on upload/download (Storage calls go to `https://<ref>.supabase.co`, covered by `connect-src https://*.supabase.co`).
