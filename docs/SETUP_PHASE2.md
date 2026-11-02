# Stash Phase 2: real-service setup and test checklist

**State of this document:** the repository code and migrations are implemented and tested against test doubles and a local PostgreSQL (see `PHASE2_TEST_REPORT.md`). **Nothing has been run against a real Supabase project, Google, an SMTP provider, or Vercel.** Every box in section 6 is a test you still have to perform. Placeholders such as `<project-ref>` are yours to fill in; this guide never invents project URLs or credentials.

Dashboard menu names change between Supabase versions. Where a label below might differ, the setting's *purpose* is given so you can find it.

## 0. Prerequisites
- Two Supabase projects: **dev** and **prod** (never share keys or users between them).
- A Google Cloud project, a Vercel project connected to this repository, a machine with Node 18+ and internet.
- Run once, on that machine, before the first deploy: `node scripts/vendor-deps.js --update` then **commit** `vendor/supabase.js` and the updated `vendor.lock.json`. Compare the printed tarball hash with `npm view @supabase/supabase-js@2.45.4 dist.integrity`. **Status (checked again for Phase 3): still NOT done.** The sandbox could not reach the npm registry (DNS failure) and its proxy returns 403 for jsDelivr, so the real file could not be downloaded or hashed. Until it is done, Vercel builds **fail on purpose** (the page loads `vendor/supabase.js`). If the UMD file is not at `dist/umd/supabase.js` in that package version, the script stops with a clear error; do not work around it silently.

## 1. Supabase

### 1.1 Apply the migrations (in this order, each project)
Dashboard → SQL Editor → run the whole of:
1. `supabase/migrations/0001_profiles.sql`
2. `supabase/migrations/0002_hardening.sql`

Both are idempotent. **Never re-run 0001 on its own after 0002**: it recreates the old `save_my_profile`; if you ever do, run 0002 again straight afterwards.
Then verify: Table Editor → `profiles`, `institutions`, `profile_save_attempts`, `matric_corrections` exist with RLS **enabled** (a lock icon / "RLS enabled"); Database → Functions lists `save_my_profile`, `delete_my_account`, `admin_correct_matric`. Section 5 automates the permission checks.

### 1.2 Authentication settings (Authentication → ...)
| Setting | Value | Why |
|---|---|---|
| Sign In / Providers → Email | Enabled | |
| **Confirm email** | **ON** | The app refuses sign-up if Supabase returns a session; the database also ignores profile data until verified |
| Minimum password length | **8** | The app enforces 8 too |
| Secure password change / Secure email change (names vary) | ON | Requires a recent login or confirmation for these changes |
| Anonymous sign-ins | **OFF** | `scripts/verify-supabase.js` checks this |
| URL Configuration → **Site URL** | your production origin, e.g. `https://<your-domain>` | Default target of email links |
| URL Configuration → **Redirect URLs** | `https://<your-domain>/**`, `http://localhost:8000/**`, and your Vercel preview pattern `https://*-<your-vercel-team-slug>.vercel.app/**` | The app returns to `origin + path`; Supabase refuses anything not listed. Use the **dev** project for localhost and previews |
| Providers → Google | Enabled (section 2) | |

`SUPABASE_URL=https://<project-ref>.supabase.co SITE_URL=https://<your-domain> node scripts/print-setup-values.js` prints these values for your project.

### 1.3 Email templates
The default **Confirm signup** and **Reset password** templates already use `{{ .ConfirmationURL }}`, which is what the app expects (PKCE flow). Customise wording if you wish but **keep that variable** and do not change the link target. No other template change is required.

### 1.4 SMTP (required before real students)
Supabase's built-in sender is for testing, is strictly rate-limited, and only delivers to project team members unless you configure your own SMTP. Authentication → Emails → **SMTP Settings** (Project Settings → Auth in some versions): enable custom SMTP and enter your provider's host, port, username, password, and a sender address on a domain you control. Set up SPF/DKIM for that domain at your provider, or confirmation emails land in spam. The SMTP password lives only in the Supabase dashboard.

### 1.5 Keys (Project Settings → API)
Only two values are used, and both are public: **Project URL** and the **anon / publishable** key. Never copy the `service_role` / secret key into this project, Vercel, or any chat. The build and `check-secrets.js` reject it.

## 2. Google OAuth
1. Google Cloud Console → create a project → **OAuth consent screen**: External; app name; support email; authorised domain; scopes `openid`, `email`, `profile` only. While status is **Testing**, only listed test users can sign in; publish before real students use it.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   - Authorised JavaScript origins: your production origin (and `http://localhost:8000` for the dev client).
   - Authorised redirect URI, **exactly** (this is the callback for *your* Supabase project):
     `https://<project-ref>.supabase.co/auth/v1/callback`
     The same URL is shown in Supabase → Authentication → Providers → Google. Use a separate Google client for dev and prod, or add both callbacks.
3. Copy the **Client ID** and **Client secret** into **Supabase → Authentication → Providers → Google → Save**. That dashboard is the **only** place they go. The secret never appears in this repository, in Vercel variables, or in frontend code (the build fails if it finds `GOCSPX-…`).

Google gives no matric number or level; the app asks for them at onboarding.

## 3. Vercel
`vercel.json` already sets the build command (`node scripts/build.js`) and output folder (`dist`).

| Variable | Value | Public? |
|---|---|---|
| `SUPABASE_URL` | Project URL of the matching Supabase project | Public (shipped to browsers) |
| `SUPABASE_ANON_KEY` | anon / publishable key of the same project | Public by design; RLS protects data |
| `STASH_PROD_SUPABASE_REF` *(optional guard)* | the **prod** project ref | Not secret, but only set it for **Production** |

Settings → Environment Variables, scoped per environment:
- **Production** → prod project values (+ the guard). **Preview** and **Development** → **dev** project values. Do not give Preview the prod keys: preview URLs are less controlled.
- There are no secret variables in this phase. Do not add `service_role`, Google client secret or SMTP password to Vercel.
- Variables are baked into `dist/env-config.js` at build time, so **redeploy after any change** (Deployments → Redeploy; changing a variable does not alter the existing deployment).
- The build prints the environment and project ref, and fails if: variables missing; URL is localhost or not `*.supabase.co`; key is secret/service-role; key's project differs from the URL's; key expired; `vendor/` does not match `vendor.lock.json`; a secret pattern is found in the repo or output.
- Vercel's Hobby plan is for non-commercial use. Check current terms before charging students.

Local dev:
```bash
cp .env.example .env.local             # DEV project values only; never commit
set -a; . ./.env.local; set +a
node scripts/build.js && python3 -m http.server 8000 -d dist
```
(`node scripts/build.js --skip-vendor-check` is allowed **only** locally and only until you have vendored the client.)

## 4. Content-Security-Policy
`vercel.json` sends the CSP as **Report-Only**: it logs violations in the browser console but blocks nothing. After deploying, open every screen (upload, OCR, PDF clearance packet, print) and read the console. Once clean, rename the header key to `Content-Security-Policy` to enforce. It was not tested against real OCR/PDF workers.

## 5. Automated check against your real project
```bash
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_ANON_KEY=<anon key> node scripts/verify-supabase.js
# optional signed-in checks, with a DEDICATED verified test account in the DEV project:
TEST_EMAIL=... TEST_PASSWORD=... (same command)
```
It checks: Confirm email on, anonymous sign-ins off, anon cannot read/write `profiles` or the private tables, anon cannot call any function, a signed-in user sees only their own row, cannot update it directly, cannot call `admin_correct_matric`. It prints no keys. It **cannot** check email delivery or Google. Paste its output into the test report when you have run it.

## 6. Manual acceptance checklist (dev project, real inboxes, real Google)
- [ ] Sign up with a real email → verification email arrives (check spam) → link opens the app signed in → onboarding data present in `profiles` (`profile_complete` true).
- [ ] Before clicking the link, `profiles` row has **no** matric number.
- [ ] Sign up again with the same email → same "Check your email" screen, **no** second email.
- [ ] Log in before confirming → "Please confirm your email" and resend works.
- [ ] Wrong password errors; right password reaches dashboard; refresh keeps you in.
- [ ] Sign in on two devices, log out on one → the other stays signed in.
- [ ] "Remember me" unticked → closing the browser signs you out.
- [ ] Google (new account) → onboarding → dashboard; log out/in → dashboard directly; cancel at Google → login page with a message.
- [ ] Google with an email that already has a password account → one account/profile (Supabase account-linking behaviour; confirm what *your* project does).
- [ ] Forgot password (real account) → email arrives → link opens in a **new tab** → set password → old password fails → link reused shows invalid-link message. Unknown address → same confirmation text, no email.
- [ ] Open a reset/confirmation link in a different browser → friendly message, not signed in.
- [ ] Second account tries an existing matric → neutral message; after 5 tries "too many attempts"; the message never says the number is taken.
- [ ] Try changing the matric on the profile page → read-only with the correction hint. Follow `MATRIC_CORRECTION.md` once.
- [ ] Delete account → auth user and profile gone; `matric_corrections` rows (if any) remain.
- [ ] From the browser console with the anon key, try `from('profiles').update(...)`: denied.
- [ ] Upload, OCR, clearance PDF and Cafe PIN still work on the deployed (vendored) build; console shows no blocking errors; CSP report-only violations reviewed.
- [ ] Real SMTP: emails come from your domain and are not in spam on Gmail and a campus/Outlook address.

## 7. Known limitations
See `SECURITY_REVIEW.md` ("Accepted limitations") and `DECISIONS.md`. Key ones: matric is self-declared; vault data is device-local and unencrypted; no payments or paid entitlements; login is email-only; matric format is a basic shape check until FULAFIA's real format is confirmed; legacy demo accounts are purged, not migrated.

## 8. Layout
```
auth.js  script.js  index.html    app (vanilla JS, hash routing)
vendor/ + vendor.lock.json        pinned Supabase client (populate with scripts/vendor-deps.js --update)
scripts/build.js                  build + guards      scripts/check-secrets.js   secret scan
scripts/vendor-deps.js            vendoring/lock      scripts/verify-supabase.js real-project smoke test
scripts/print-setup-values.js     callback/redirect values for your project
supabase/migrations/0001_profiles.sql  0002_hardening.sql
tests/db  tests/e2e  tests/build  see PHASE2_TEST_REPORT.md
```
Run tests: `tests/db/run.sh`; `node tests/build/build.test.js`; `node tests/build/verify.test.js`; serve the repo root on port 8767 and run `tests/e2e/{auth,layout,hardening,regress}.e2e.js` (`BASE=http://localhost:8767/index.html`, `NODE_PATH=$(npm root -g)`; `regress` also needs the Phase 1 build on 8768).
