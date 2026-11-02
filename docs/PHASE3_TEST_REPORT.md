# Phase 3 test report

Run date: 2026-11-01/02. Sandbox with **no access** to Supabase, Google, SMTP, Vercel, npm or CDNs. All numbers were observed here.
Legend: **A** automated/mocked · **D** local database test (real PostgreSQL 16; Supabase `auth` and `storage` schemas **stubbed**) · **R** real Supabase integration · **M** manual, still required.

**Real Supabase integration tests run: 0. Real Supabase Storage behaviour: untested. Migration 0003 has not been applied to any live project.**

| Suite | Class | Result | What it proves |
|---|---|---|---|
| `tests/db/run.sh` (Phase 2 part) | D | 74/74 | No regression in 0001/0002 behaviour |
| `tests/db/run.sh` (0003, `docs_test.sql`) | D | **96/96**, migration applied repeatedly and after re-running 0002; Phase 2 data survives the upgrade | Per-user RLS on documents and Storage policies; no direct writes; validation; two-phase upload; real-size finalize; size/type mismatch; idempotent retries (`local_ref`); expiry; quota at the exact boundary (free 1 GiB, paid 5 GiB); user cannot set own tier; pending cap; oversize objects counted; two-phase delete (ready files can't be removed directly, quota freed only after the object is gone); failed-upload cleanup; search isolation, prefix/AND/category, hostile input; metadata edits; account deletion queues files; orphan report; privileges |
| `tests/e2e/cloud.e2e.js` | A (test double of the backend) | **79/79** | Opt-in; migration keeps local copies; retries; failed uploads leave no orphan; offline→online; quota stays server-side; cross-account isolation (download, list, delete, finalize, update, search, overwrite); delete resume; clear-local-vault; second-device pull + lazy download; edits sync; corrupted copy never "verified"; account deletion; Settings layout 320-1280 px |
| `tests/e2e/auth|layout|hardening|regress` | A | 132 / 63 / 19 / 9, all pass | Phase 2 behaviour and UI unchanged; landing page pixel-identical to Phase 1 except the intended "1 GB" storage figure (reference copy patched for that one number) |
| `tests/build/build.test.js` | A (fake npm registry) | 35/35 | Build/vendor/secret guards (now also copies `cloud.js`) |
| `tests/build/verify.test.js` | A (fake server) | 12/12 | `verify-supabase.js` incl. signed-in storage cycle and cross-account probe pass a correct setup and fail broken ones |
| `tests/build/cleanup.test.js` | A (fake server) | 8/8 | Cleanup job: dry run deletes nothing; removes only queue + row-less objects; keeps queue rows on failure; size guard; key never printed |
| `scripts/verify-supabase.js` on your project | R | **NOT RUN** | - |
| `SETUP_PHASE3.md` section 4 | M | **NOT RUN** | - |

## Mutation checks (do the tests notice weakened rules?)
Five deliberate weakenings of 0003 were run against `docs_test.sql`: quota check removed (5 failures), ready objects deletable directly (4), finalize ignoring the real size (4), search ignoring the owner (2) were all **caught**. Removing the owner condition from the Storage insert policy was **not** caught because it is an equivalent mutant: the policy's subquery reads `documents` under that table's own RLS, so ownership is enforced twice (defence in depth).

## Test-authoring defects found and fixed along the way (not product bugs)
Checks that did an action and read its result in one statement saw a stale snapshot; two tautological assertions (`|| true`) were removed; one DB check was too weak to fail and was split.

## Product bugs found by the new tests and fixed
1. A cloud pull ran after every local change, so "Clear local vault" was undone within a second. Pulls now happen only on start-up, reconnect, enabling, and Sync now.
2. Delete steps had no retry/backoff, so repeated transient errors left deletes pending longer than needed. They now retry.
3. A document deleted locally while its upload was in flight could be left in the cloud (and later reappear). The in-flight upload now queues its own removal.
4. Plan sizes in `data.json` (2 GB/20 GB) disagreed with the server (1 GB/5 GB); aligned, and stale "2 GB" placeholders fixed.

## Not tested / unverified
Everything real: Storage API response shapes (409 text for duplicates, `remove` of hidden objects, download errors) are modelled on documentation and the test double; `storage.objects.metadata` population; policy creation by the SQL-editor role; throughput/large libraries (pull pages 500 rows; 10 MiB files are held in memory for hashing); real network failure modes; CSP report-only behaviour with Storage; mobile Safari quirks with blob downloads; the vendored Supabase client (still not populated: registry unreachable).
