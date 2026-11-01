# Phase 2 independent security review

Scope: the delivered Phase 2 (`stash-main-phase2.zip`) was re-read against its own test report. Every finding below was **reproduced first** (database findings with `tests/db/findings_0001.sql` / `run_old.sh` against the original migration; client findings with `tests/e2e/hardening.e2e.js` run against the original code: **9 of 19 checks failed**), fixed, and re-tested (**19 of 19 pass; 74/74 database checks**). Nothing here was tested against a real Supabase project, Google or an inbox. See `PHASE2_TEST_REPORT.md`.

## Claims in the earlier report that did not hold
| Earlier claim | Reality |
|---|---|
| "Unverified accounts never treated as signed in" | True in the browser, but the **database** let an unverified sign-up reserve any matric number (squatting). |
| "Two accounts cannot register the same matric number" | True, but the error text and lack of throttling made it a yes/no **lookup of other students' matric numbers**. |
| "Log out ends the session" | It ended **every** device's session (global scope). |
| Reset links "must be opened in the same browser" | Also failed in a *new tab of the same browser* after a "don't remember me" login (PKCE verifier lived in sessionStorage). |
| Security headers / dependency pinned | Pinned by version only: no integrity hash, and `tesseract.js@5` floated across 5.x. |

## Findings and fixes
| ID | Severity | Finding | Fix | Evidence |
|---|---|---|---|---|
| S1 | High | Unverified sign-up could claim a matric via signup metadata | Metadata applied only once `email_confirmed_at` is set (insert + update triggers); old claims cleaned by 0002 | DB tests, H5 |
| S2 | High | Matric-in-use was an unthrottled oracle with a revealing message | One neutral status for every conflict; 5 rejected attempts/hour/account then `too_many_attempts`; UI text never says the number is taken | DB tests, H4 |
| S3 | Medium | No safe way to correct a locked matric | `admin_correct_matric()` (service role / postgres only), audited in `matric_corrections`; runbook in `MATRIC_CORRECTION.md` | DB tests |
| S4 | Medium | `profiles.email` could drift from the sign-in email | `on_auth_user_updated` trigger keeps it in sync | DB tests |
| S5 | Low | Control characters accepted in names | CHECK constraint + function check | DB tests |
| S6 | Medium | Supabase grants EXECUTE on new functions to `anon`/`authenticated` by default | Explicit revokes; grants only `save_my_profile`/`delete_my_account` → authenticated, `admin_correct_matric` → service_role | DB tests (stub reproduces Supabase default privileges); `verify-supabase.js` re-checks on a real project |
| F1 | High | Logout revoked every device's session | `signOut({scope:'local'})`; other devices untouched | H1 |
| F2 | Medium | Reset/confirm link in a new tab failed after non-remembered login | PKCE verifier always in localStorage (it is not a session) | H2 |
| F3 | Medium | Any `getUser` error (429/5xx/offline) logged the user out; the matching regex was too broad | Only 401/403 and specific invalid-session codes end the session | H3 |
| F4 | Low | Fail-open if "Confirm email" is switched off in Supabase | Sign-up refuses when a session is returned; no session kept | H6 |
| B1 | Medium | Supabase client loaded from a CDN with no integrity hash | Vendored file locked by sha384 + npm sha512 (`vendor.lock.json`); build fails on any mismatch. **Not yet populated: you must run `node scripts/vendor-deps.js --update` once** | build tests (fake registry) |
| B2 | Low | `tesseract.js@5` floated | Pinned to exact `5.1.1`. **Not verified against the real CDN; OCR must be checked manually** | none (manual) |
| B3 | Medium | Build did not check that URL and key belong to the same project, nor key expiry, nor localhost on Vercel | Added; optional `STASH_PROD_SUPABASE_REF` pin for Production | build tests |
| B4 | Medium | No secret scanning | `scripts/check-secrets.js` runs on source and `dist/` inside the build | build tests |
| B5 | Low | No CSP / HSTS | `Content-Security-Policy-Report-Only` + `Strict-Transport-Security` (1 year, no subdomains) added. CSP is **report-only** because OCR/PDF workers were not tested under it | manual |

## Reviewed and found sound (no change)
RLS: students can only `select` their own profile; no write policies or table write grants; `profile_complete` is generated; `SECURITY DEFINER` functions use `set search_path=''`; `delete_my_account` deletes only `auth.uid()`; PKCE flow; no password or token in storage or console; legacy demo credentials purged on first load; the service-role key is rejected by the build; `plan` is forced to `free` in the browser.

## Accepted limitations (documented, not fixed)
1. Matric numbers are **self-declared**; no institutional verification exists.
2. Throttling is per account. Creating many accounts is limited only by Supabase's own rate limits and email verification. No CAPTCHA.
3. `delete_my_account()` needs only a valid session (no recent-login requirement server-side). Enable Supabase's "secure password/email change" options and treat a stolen unlocked device as out of scope.
4. The document vault is still device-local and unencrypted; the free-plan limits are browser-enforced only.
5. CSP is report-only; third-party scripts (pdf.js, tesseract, jsPDF) still load from CDNs without integrity hashes.
6. HSTS is sent for a year once deployed on an HTTPS domain; make sure the whole site is served over HTTPS first.
