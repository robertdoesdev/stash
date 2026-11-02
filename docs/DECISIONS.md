# Decisions needed from you

Nothing below has been implemented. Each item blocks the work noted.

## Blocking payments

**D1. What does each paid option actually unlock, and when does it expire?** (the plan-coverage decision you asked me to flag)
The landing page shows only the two prices and says "What's included will be confirmed before payments open." Please decide:
- What does **₦2,000 / semester** unlock? What does **₦5,000 / academic level** unlock? (Higher document cap? More storage? Unlimited scans? Cafe Print features? Something else.)
- Does "per semester" end on a fixed calendar date, or N days after payment? Which semester dates?
- Does "per academic level" cover both semesters of that level only? What if the student repeats the level or changes level mid-year?
- Is the ₦5,000 level option meant to be cheaper than two semesters (₦4,000 is cheaper, ₦5,000 is not)? Currently the level option costs **more** than two semesters, so the 2-semester case makes the level price look like a worse deal. Please confirm the prices are right or explain the intended difference (e.g. it may cover more than two semesters, or more entitlements).
- If a student buys both, do they stack, extend, or does the higher one win?
- Refund policy.
- What happens to documents above the free cap when a paid period ends (read-only, kept, deleted after N days)?

**D2. Free plan numbers.** Current enforced values: 50 documents, 2048 MB, 5 OCR scans/day. Keep, or change?

## Blocking Google onboarding

**D3. Matric number rules.** What format does your school use (length, letters/digits, faculty prefix)? Is one deployment for one school, or many (then we need a `school` table and a school picker)? Should email be restricted to a school domain, or any Google account?

## Blocking infrastructure

**D4. Storage budget.** 2 GB free per student is expensive at scale (see ARCHITECTURE.md §10). Keep 2 GB, reduce it, or compress uploads?

**D8. Existing demo accounts.** They live only in testers' browsers, with plain-text passwords. Proposed: don't migrate; students sign up fresh with Google. OK?

**D9. Approve the stack** (Supabase + Paystack + Vercel) and the two-environment plan (dev/test and prod/live). Confirm you have, or will create, the accounts in ARCHITECTURE.md §9, especially Paystack business activation (slow, start early).

## Product / copy

**D5. "Pro" wording in the app.** Upload and OCR-limit messages say "upgrade to Pro", but no Pro plan exists. I left them (no features removed). Reword once D1 is settled?

**D6. PWA/theme colour.** The manifest and `theme-color` are dark navy `#0A0F1E`; the new public pages are light/blue. Change to brand blue or white? Also: who supplies the icon artwork, or should I export the existing SVG logo into the required sizes?

**D7. Forgot-password text.** The modal confirms "sent" though nothing is sent. Until real auth exists, should it say "not available yet"? (I preserved the approved behaviour.)

**D10. Cafe Print promise.** It only works on one device today. Keep the landing page claim as written until the backend exists, or soften it now?

**D11. Fonts.** Confirm the look on a real device with Bricolage Grotesque + Figtree, and approve self-hosting them.

## Not done (by your instruction)

Phase 2, payment processing, auth backend, redesign of approved pages or app screens, removal of any existing feature.

---

# Phase 2 decisions (authentication)

**P2-1. Matric number format.** Not documented anywhere in the project. Currently accepted: 4–24 characters of A–Z, 0–9, `/`, `-`, `_` (upper-cased, spaces removed). Send the real FULAFIA format and I will tighten the database constraint.

**P2-2. Matric number is locked once saved (decided).** Students cannot edit it. Corrections go through `admin_correct_matric()`, run by an administrator after revalidation, with a mandatory reason and an audit row. Process: `MATRIC_CORRECTION.md`. The number is **self-declared**: Stash does not verify it against FULAFIA records.

**P2-3. Email-only login (decided).** Matric-number login was removed because resolving a matric to an email reveals which students exist.

**P2-4. Supabase client is vendored and hash-locked (decided).** Reason: a CDN file with only a version number has no integrity check, and this script handles every student's session. Not "self-hosting for its own sake": a pinned CDN with SRI would also work, but the SRI hash cannot be produced without downloading the file, and vendoring gives the same guarantee plus one fewer third-party request. `scripts/vendor-deps.js --update` produces `vendor/supabase.js` + `vendor.lock.json`; the build fails on any mismatch. **Open action: run it once and commit.** pdf.js, tesseract.js and jsPDF stay on CDNs (unchanged; `tesseract.js` pinned to an exact version).

**P2-5. Production email.** Supabase's built-in email sender is test-only. Pick an SMTP provider before real students sign up.

**P2-6. Level is student-editable** (students progress each year). If paid access later depends on level, we will need a rule (e.g. changes allowed only between semesters).

**P2-7. Vault data is still device-local and unencrypted** (documents, settings, usage). Moving it to private Supabase Storage with server-side limits is the natural next phase. Until then, shared computers need "clear site data" after logout.

**P2-8. Initial target: FULAFIA students.** One institution row; the matric check is a basic shape check only. No university-specific rules are invented. When the real format is confirmed, tighten the CHECK constraint, `save_my_profile` and `admin_correct_matric` together.

**P2-9. Account ownership is the Supabase user ID** (UUID, immutable), never the matric. Local vault records are keyed by it.

**P2-10. Duplicate matric handling.** Uniqueness is enforced in the database (`unique (institution, matric_number)`). The browser only ever sees a neutral "couldn't register that matric" message, and a student gets 5 rejected attempts per hour before `too_many_attempts`. A genuine conflict is resolved by a human through the correction process.

**P2-11. Profile data from sign-up is applied only after email verification**, so an unverified sign-up cannot reserve a matric number. Pre-existing claims were cleared by the 0002 migration (the matric is re-applied if that user verifies later and nobody else owns it).

**P2-12. Deleting an account frees its matric number** and deletes its throttle log; the `matric_corrections` audit trail is kept. The server requires only a valid session for deletion (no recent-login check); revisit with payments.

**P2-13. CSP ships as Report-Only** until OCR/PDF are tested under it; HSTS (1 year, no subdomains) is on.

**P2-14. No paid access.** Nothing in this phase grants or checks entitlements; `plan` is forced to `free`. Payments, entitlements and cloud storage are not started.

(Phase 1 items D1 to D4 remain open and still block payments.)


---

# Phase 3 decisions (cloud storage)

**P3-1. Server enforces the quota** (1 GiB free / 5 GiB paid, `storage_limit_bytes`), counting real object bytes, including pending, failed and deleting rows until the object is verified gone. The browser's own limit check is advisory.
**P3-2. Cloud backup is opt-in per account;** local copies are never deleted by sync; verification = downloaded back and size + SHA-256 matched.
**P3-3. Paid tier is administrator-set only** (`user_entitlements`, no app-role grants). No payment code. Storage size is the first decided entitlement; the other plan entitlements remain undecided.
**P3-4. Two-phase upload and delete** so that crashes leave resumable states, never silent orphans or free quota.
**P3-5. Account deletion** queues Storage paths (`storage_deletion_queue`); an operator runs `scripts/cleanup-orphans.js` (service-role key stays off the website).
**P3-6. Document-count limit (50 on Free) is still browser-only;** the server enforces bytes. Decide if it should be server-enforced.
**P3-7. Documents search box stays local-over-synced-metadata;** server search exists but is not wired to the UI. Decide if you want it switched.
**P3-8. A document deleted on another device is flagged, not removed here,** to honour "never delete local copies automatically".
