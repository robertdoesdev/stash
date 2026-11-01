# Stash — Proposed Architecture (not implemented)

Status: **proposal only.** No backend, payment or auth code has been written. Everything below needs your approval (see DECISIONS.md). Cost and limit figures are from memory and **must be re-checked on each vendor's pricing page before you commit**; vendors change them.

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Auth | Supabase Auth, Google OAuth (+ email/password later if wanted) | Hosted, handles sessions, reset emails, token refresh. Removes the plain-text password problem entirely. |
| Database | Supabase PostgreSQL with Row Level Security | Per-user data isolation enforced by the database, not by browser JS. |
| Files | Supabase Storage, **private bucket**, signed URLs | Replaces IndexedDB so files follow the student across devices. Never public. |
| Payments | Paystack (NGN: cards, bank transfer, USSD) | Standard for Nigerian payments. |
| Server code | Vercel serverless functions (`/api/*`) | Holds secret keys. Payment init, verify, webhook live here. |
| Hosting | Vercel (static front-end + `/api`) | Matches your stated target. |

The current static SPA keeps working. The change is to swap the `DB` layer (`script.js`) from localStorage/IndexedDB to Supabase calls, and add `/api` for anything that needs a secret.

## 2. Google sign-in and onboarding (your required flow)

Google gives us: a verified email, a display name, an avatar. Google does **not** give us a matric number or academic level, and we do not assume it does.

```
Student taps "Continue with Google"
  → supabase.auth.signInWithOAuth({ provider: 'google' })
  → Google consent → redirect back with a session
  → App loads the user's row from `profiles` (by auth.uid())
       ├─ no row, or any required field empty
       │     → route to #onboarding  (app routes blocked until complete)
       │        collect: full name, matric number, academic level
       │        validate client-side (fast feedback) AND server-side (authoritative)
       │        upsert into `profiles`
       │        → #dashboard
       └─ complete profile → #dashboard
```

Rules:
1. **Gate is server-enforced.** `profiles.onboarded` is set by the database (a `CHECK` plus trigger/RPC) only when `full_name`, `matric_number` and `level` are all valid. RLS policies on app tables require `onboarded = true`, so a user who skips the screen via dev tools still can't read or write app data.
2. Router guard: if signed in and not onboarded → force `#onboarding`; if onboarded and visits `#login/#signup/#onboarding` → `#dashboard`.
3. Validation: full name 2–80 chars; matric number format per your school (**needs your rule**, D3), trimmed, upper-cased, unique per school; level ∈ {100L…500L}.
4. Matric uniqueness: unique index on `(school_id, matric_number)` so two accounts can't claim the same matric. Handle the collision with a clear message ("That matric number is already linked to another account").
5. Email/password signup (the existing form) remains an option; it would also pass through onboarding if any field is missing.
6. Existing demo-account data in localStorage cannot be migrated safely (plain-text passwords, no verified identity). Decision D8.

## 3. Database (outline)

```
profiles          id (= auth.users.id), email, full_name, matric_number, level,
                  school_id, onboarded, created_at, updated_at
documents         id, user_id, title, category, level, semester, tags[], ocr_text,
                  storage_path, size_bytes, created_at
cafe_pins         id, user_id, document_id, code_hash, expires_at, used_at   (see §7)
plans             id, code, label, price_minor, currency, interval, active   (config in DB, not code)
plan_entitlements plan_id, key, value                                          (EMPTY until D1 is decided)
payments          id, user_id, plan_id, reference (unique), amount_minor, currency,
                  status (pending|success|failed|abandoned), provider, raw_event jsonb,
                  verified_at, created_at
entitlements      id, user_id, plan_id, payment_id, starts_at, expires_at, status
usage_counters    user_id, day, kind, count
```

RLS: every table filters `user_id = auth.uid()`. `payments` and `entitlements` are **read-only for users**; only the server (service role) writes them.

## 4. Payments — Paystack, server-verified

Hard rule: **a browser redirect never grants access.** Only a server-side verified transaction does.

```
1. Student chooses an option (semester or academic level).
2. POST /api/payments/initialize   (needs a valid Supabase session)
     - server reads the plan and price from DB (never trusts a price from the browser)
     - creates a `payments` row: status=pending, unique reference
     - calls Paystack "initialize transaction" with the secret key
     - returns the authorization URL → browser redirects to Paystack
3. Student pays on Paystack. Paystack redirects to /pay/return?reference=…
     - This page is **display only**: it asks the server "what's the status?" and shows it.
       It does not grant anything.
4. Paystack sends a webhook → POST /api/payments/webhook
     - verify the `x-paystack-signature` HMAC (SHA-512 of the raw body with the secret key)
     - ignore unsigned/invalid requests
     - re-verify with Paystack "verify transaction" API by reference
     - check: status = success, amount == expected, currency == NGN, reference known
     - in ONE database transaction: mark payment success (idempotent on reference)
       and create the `entitlements` row
     - safe to receive the same event many times
5. /api/payments/verify?reference=… (called by the return page / app on load) does the
   same verification, so access appears even if the webhook is delayed. Also idempotent.
6. The app reads `entitlements` to decide what's unlocked. Client-side checks are for UX
   only; the database/API enforce limits.
```

Edge cases to handle: duplicate webhooks, amount mismatch (reject + log), abandoned payments (leave `pending`, expire), user closes tab after paying (webhook + verify-on-load recover it), refunds/chargebacks (webhook → revoke or flag), a student paying twice for the same period (decision D1 covers stacking vs. extending).

**Entitlements and expiry are intentionally undefined.** `plan_entitlements` stays empty and no payment code ships until you confirm D1 (below). Schema supports either answer.

## 5. Environment variables (names only — no values anywhere in this repo)

Set in Vercel → Project → Settings → Environment Variables, **separately for Preview/Development and Production**:

| Variable | Exposed to browser? | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes (public) | Project URL |
| `SUPABASE_ANON_KEY` | yes (public, RLS-protected) | Client access |
| `SUPABASE_SERVICE_ROLE_KEY` | **never** | Server-only; bypasses RLS. Used in `/api` for payment writes. |
| `PAYSTACK_SECRET_KEY` | **never** | `sk_test_…` in dev/preview, `sk_live_…` in production only |
| `PAYSTACK_PUBLIC_KEY` | yes | Only if you use Paystack inline popup; not needed for redirect flow |
| `APP_BASE_URL` | server | Builds the return URL |
| `PAYSTACK_WEBHOOK_URL` (documented, set in Paystack dashboard) | – | Paystack has one webhook URL per mode (test / live) |

Google OAuth Client ID/Secret are configured **inside the Supabase dashboard** (Auth → Providers → Google), not in your code.

Rules: `.env*` is git-ignored; a `.env.example` lists names with blank values; never prefix secrets with `NEXT_PUBLIC_`/`VITE_`/anything that ships to the browser; rotate any key that was ever pasted into chat or committed.

## 6. Test vs live

- **Two Paystack modes, two key pairs.** Development and Vercel Preview use *test* keys and the test webhook URL. Production uses *live* keys only after your business is activated.
- Two Supabase projects (`stash-dev`, `stash-prod`) so test data and real student data never mix.
- Test-mode checklist before going live: successful card, declined card, abandoned payment, closed tab, duplicate webhook, bad signature, wrong amount, expired period, refund. Only then switch the production env vars.
- A visible "TEST MODE" banner whenever the test key is active, so nobody confuses the two.

## 7. Other parts of the app that need the backend to be honest

| Feature | Today | With backend |
|---|---|---|
| Cafe Print | PIN in the student's browser only | PIN issued by `/api`, stored hashed with expiry and **single use**, cafe page calls `/api/cafe/redeem` and gets a short-lived signed URL. Rate-limited. Use a longer code (6+ chars) than a 4-digit PIN. This is what makes the landing promise true. |
| Free limits | JS checks | Enforced in DB/API (document count, storage bytes, daily OCR counter) |
| OCR | CDN scripts, runs in browser | Keep in browser for now but **self-host** Tesseract/pdf.js/jsPDF (or bundle) so it works offline/on bad data. Optionally move OCR server-side later. |
| Password reset | Fake | Supabase Auth reset email |
| Files | IndexedDB | Private Storage bucket, path `user_id/doc_id`, signed URLs, storage policies mirroring RLS |

## 8. Proposed project structure

```
stash/
├─ index.html  styles.css  landing.css  script.js  data.json  manifest.json
├─ assets/
│  ├─ icons/            icon-192.png icon-512.png maskable-512.png apple-touch-icon.png favicon.svg
│  └─ fonts/            Bricolage Grotesque + Figtree woff2 (self-hosted)
├─ vendor/              pdf.js, tesseract.js (+ lang data), jspdf  (self-hosted)
├─ sw.js
├─ api/                 Vercel serverless functions
│  ├─ payments/initialize.js  verify.js  webhook.js
│  ├─ cafe/create.js  redeem.js
│  └─ _lib/  supabaseAdmin.js  paystack.js  auth.js
├─ supabase/
│  ├─ migrations/       0001_profiles.sql  0002_documents.sql  0003_payments.sql  …
│  └─ policies/         RLS + storage policies
├─ docs/                PHASE1_AUDIT.md  ARCHITECTURE.md  DECISIONS.md
├─ .env.example         names only
├─ vercel.json
└─ README.md
```

Today's repo is the top row plus `docs/`. Nothing else exists yet.

## 9. Accounts you will need

1. **Supabase** (two projects: dev, prod).
2. **Google Cloud Console**: OAuth consent screen + OAuth Web Client (authorized redirect = your Supabase callback URL). App "publishing status" must be moved from Testing to Production before students outside your test list can sign in.
3. **Paystack** (test mode immediately; live needs business activation: business registration documents, a Nigerian settlement bank account, and directors' ID. Allow days to weeks).
4. **Vercel**.
5. **GitHub** (for Vercel deploys).
6. A **domain** (optional but recommended; needed for a professional OAuth consent screen and email).
7. An **email sender** for transactional mail if you go beyond Supabase's built-in (the built-in is rate-limited and for testing; use your own SMTP, e.g. Resend/Brevo, for production).

## 10. Cost and free-tier considerations (verify before committing)

- **Supabase Free**: small database (~500 MB), ~1 GB file storage, monthly active user cap in the tens of thousands, and **projects pause after about a week of inactivity**. Fine for development. **Not fine for production**: a paused project means every student is locked out. Supabase Pro is roughly US$25/month per project and includes much more storage.
- **Storage is the real cost driver.** The free plan promises 2 GB per student. Ten students at the cap already exceed 1 GB. Either lower the per-student quota, compress images client-side before upload, or budget for Pro storage. Decision D4.
- **Vercel Hobby** is free but its terms limit it to **non-commercial** use. Charging students is commercial, so plan on Vercel Pro (roughly US$20/month) for production. Verify the current terms.
- **Paystack** charges per successful transaction (as I recall about 1.5% plus ₦100 on local cards, with the flat fee waived below a small amount and a fee cap). On a ₦2,000 payment that is roughly ₦30 (verify). No monthly fee. Settlement is to your Nigerian bank account on a rolling schedule.
- **Google OAuth**: free.
- **Domain**: a few US dollars to tens per year.
- **Email (SMTP)**: free tiers exist and are enough at small scale.
- Budget summary at launch scale: roughly **US$45/month** (Supabase Pro + Vercel Pro) plus Paystack per-transaction fees. Development can run at **$0** on free tiers.
