# Phase 2 test report (after independent review and hardening)

Run date: 2026-11-01. Environment: sandbox with **no access** to Supabase, Google, an SMTP provider, a real inbox, Vercel, npm or public CDNs. Every number below was observed in this environment. Nothing here is a real-service result.

## Classification
Legend: **A** automated unit/mocked test · **D** local database test (real PostgreSQL 16, Supabase `auth` schema stubbed) · **R** real Supabase integration test · **M** manual test still required.

| Suite | Class | Result | Proves | Does not prove |
|---|---|---|---|---|
| `tests/db/run.sh` | **D** | **74 / 74** + idempotent re-apply + upgrade path from live 0001 data (3 assertions) | Constraints, triggers, RLS isolation, write lockdown, verified-only profile data, neutral duplicate response, throttle, audited admin correction, email sync, privileges (stub reproduces Supabase's default EXECUTE grants), account deletion | Behaviour inside a real Supabase project (`auth` internals and `auth.uid()` are stubbed) |
| `tests/e2e/auth.e2e.js` | **A** (Supabase test double) | **132 / 132** | App logic: validation, routing guards, callback handling, session persistence, remember-me, no secrets in storage, anti-enumeration screens | That the real `supabase-js`, GoTrue, Google or email behave as the double assumes |
| `tests/e2e/hardening.e2e.js` | **A** (test double) | **19 / 19 on fixed code; 9 / 19 failed on the code as delivered** | Regressions for review findings F1-F4, S1, S2, matric hint | Same as above |
| `tests/e2e/layout.e2e.js` | **A** | **63 / 63** | No overflow/clipping on every auth state at 320-1440 px | Real fonts (Bricolage/Figtree never loaded here) |
| `tests/e2e/regress.e2e.js` | **A** | **9 / 9** | Landing page pixel-identical to approved Phase 1 at 390 and 1280; signed-in dashboard, upload (keyed by auth user id), Cafe PIN, print portal, other screens | OCR / PDF generation (CDN blocked here) |
| `tests/build/build.test.js` | **A** (fake local npm registry) | **35 / 35** | Vendoring + lock, tamper detection, hostile registry cases, key/URL/project/expiry/localhost guards, secret scanning, `env-config.js` contains only two public values | Real npm registry contents; the real `supabase.js` was **never downloaded or hashed** |
| `tests/build/verify.test.js` | **A** (fake server) | **8 / 8** | `scripts/verify-supabase.js` passes a locked-down config and fails a broken one, without printing the key | Anything about a real project |
| `scripts/verify-supabase.js` on your project | **R** | **NOT RUN** | - | - |
| Everything in `SETUP_PHASE2.md` section 6 | **M** | **NOT RUN** | - | - |

**Real Supabase integration tests run: 0. Real Google OAuth: not tested. Real SMTP / email delivery: not tested. Production authentication on Vercel: not tested.** The `supabase-js` UMD file path/global, the exact event emitted for reset links, Supabase's account-linking behaviour and rate-limit wording are assumptions until section 6 is done.

## Evidence that the review fixes matter
The new tests were run against the Phase 2 code **as delivered** first:
| Check | As delivered | Fixed |
|---|---|---|
| H1 logout on device A leaves device B signed in | FAIL | pass |
| H2 reset link in a new tab after a non-remembered login | FAIL | pass |
| H3 `getUser` answering 500/429/503 keeps the session | FAIL (x3) | pass |
| H4 neutral matric message, throttle after 5 | FAIL (x2) | pass |
| H5 verified owner can take a matric an unverified sign-up tried to squat | FAIL | pass |
| H6 refuse sign-up when "Confirm email" is off | pass | pass |
| H7 matric correction hint visible | FAIL | pass |
Note: the test double now mirrors the hardened SQL, so for H4/H5 the as-delivered failures reflect client behaviour only; the server-side proof for S1/S2 is the **D** suite and the pre-fix reproduction below.
Database findings were reproduced with `tests/db/findings_0001.sql` against the original migration before `0002_hardening.sql` was written.

## Earlier report's checklist: status now
Valid/invalid signup, duplicate email, verification, login, refresh persistence, Google callback and onboarding, reset flow, expired links, route guards, no plaintext passwords, `plan` forced to free, demo paths removed: **A** (test double), all still passing. Cross-student profile isolation: **D**. Mobile/desktop/landing regression: **A**. Two changed expectations: before verification a profile holds **no** matric (S1), and a duplicate matric now gives a neutral message (S2).

## Bugs found by this review (fixed): see `SECURITY_REVIEW.md` (S1-S6, F1-F4, B1-B5).
Test-harness issues found along the way (not product bugs): a transaction-scope setting lost under psql autocommit; re-applying 0001 after 0002 needed `drop function if exists`; my own test file tripped the new secret scanner (a literal PEM header), proving the scanner works.

## Still NOT tested / needs you
- **Vendoring the Supabase client** (`node scripts/vendor-deps.js --update`, then commit): not done, and the build fails until it is. The path `dist/umd/supabase.js` inside `@supabase/supabase-js@2.45.4` is unverified.
- `tesseract.js@5.1.1` exact version is unverified against the CDN; OCR and PDF generation must be exercised on the deployed build (also under the report-only CSP).
- All of `SETUP_PHASE2.md` section 6, plus `scripts/verify-supabase.js` on dev and prod.
- Real fonts on a device; Vercel build and environment injection; cross-device email links.
