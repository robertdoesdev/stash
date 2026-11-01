# Stash — Phase 1 Handoff Audit

Scope: landing page, hero, login, signup (redesigned) plus a read-only audit of everything behind them. Dashboard and app screens were **not** redesigned. No payment code was written.

> **Update (Phase 2):** sections 5 and 6 below describe the *Phase 1 demo* build. Plain-text passwords, the fake Google login, browser-only accounts and the fake password reset have been replaced by Supabase Auth. See `SETUP_PHASE2.md`. Everything else in this audit (Cafe Print device-only PINs, client-side limits, PWA assets, OCR via CDN) is unchanged.

## 1. What changed in this revision

| Item | Result |
|---|---|
| Mobile hero actions | "Create your vault" and "See how it works" stay **side by side** at 320, 360, 390, 430, 768, 1280, 1440. Measured: same top edge, no clipping, no horizontal scroll. Text is 15–16px on phones. |
| Pricing page | Removed (`#view-pricing` deleted). Pricing is now a band on the landing page (`#pricing-section`), same folder-band system. Nav "Pricing" and footer link scroll to it. Old `#pricing` links redirect to `#landing` and scroll there. |
| Pricing data | ₦2,000 per semester, ₦5,000 per academic level, held in one place: `data.json → pricing`. Amounts are stored in kobo (`amountMinor`). The page renders from it; nothing is hard-coded in HTML or JS. |
| Entitlements | **Not invented.** Both paid options have `entitlements: null`, and their cards say "What's included will be confirmed before payments open." There is no checkout button. See DECISIONS.md D1. |
| Conflicting plan data | Removed the stale `pricingPlans` array (it disagreed with `plans`). Now: `plans.free` = enforced limits, `pricing` = what is displayed. `plans.pro` is still in the file because app code reads it, but **nothing can reach it** (see §6). |

## 2. Test results (this revision)

- Overflow check: landing, login, signup at 360 / 390 / 768 / 1280 / 1440 → no horizontal overflow, no JS errors.
- Flow tests: 46/46 pass (login, signup, validation, forgot modal, remember-me, route guards, logout, Google demo, all 7 app views render, pricing scroll, legacy `#pricing`, FAQ, mobile menu, Cafe Print link).
- Hero buttons: side by side at every width tested (script: measured `getBoundingClientRect().top` equality).
- Not re-run this revision: pixel regression of app screens against the original. App CSS and app markup were not touched this round; only the router/pricing renderer in `script.js`.

## 3. Fonts (Bricolage Grotesque + Figtree)

**Not verified with the real fonts.** The sandbox blocks Google Fonts, jsDelivr and npm, so the real files never loaded. I did not route around the block.

What was done instead:
- The `<link>` to Google Fonts is correct (Bricolage opsz 12..96, wght 500..800; Figtree wght 400..800). Fallback stack is in `landing.css` (`--st-display`, `--st-body`).
- Layout tested with a stand-in (Inter Display), then **stress-tested with DejaVu Sans, which is wider than both target fonts**, at 360, 390 and 1280: no overflow, no clipped buttons/headings/inputs, hero buttons still side by side.
- Bricolage Grotesque is a little narrower at heavy weights than the stand-in used for headings, so wrapping should be equal or better. Figtree is narrower than DejaVu and close to Inter.

**You must confirm on a real device** (30 seconds): open `index.html` online at 360px and desktop and check the headline weight and the two hero buttons. Recommended before launch: **self-host** the two fonts (woff2 in `/fonts`, `@font-face` with `font-display: swap`). That removes a third-party request, helps privacy, and works on flaky campus data. Needs the font files downloaded from a machine with internet.

## 4. PWA: missing assets

`manifest.json` references files that **do not exist**, so installability is broken:

| Asset | Status | Notes |
|---|---|---|
| `icon-192.png` | **Missing** | Required by manifest |
| `icon-512.png` | **Missing** | Required by manifest |
| Maskable icon (512, safe-zone padded) | Missing | Needed so Android doesn't crop the logo |
| `apple-touch-icon.png` (180×180) | Missing | iOS home-screen icon; no `<link>` in `index.html` either |
| `favicon.ico` / `favicon.svg` | Missing | No `<link rel="icon">` in `index.html` |
| Service worker (`sw.js`) | Missing | No offline support; Chrome's install prompt needs one |
| Social share image (`og-image.png`, 1200×630) | Missing | No `og:` tags either |
| Splash/screenshots (optional) | Missing | Optional manifest `screenshots` for richer install UI |

Also: `theme_color`/`background_color` and the `<meta name="theme-color">` are `#0A0F1E` (the old dark navy). The redesigned public pages are light (blue `#3D4BFF`-family and white). The browser bar colour will clash on the landing page. Recommended: change to the brand blue or white. I did **not** change them, because the in-app screens still use the dark/light theme toggle. This is a decision for you (D6).

The Stash logo is an inline SVG in `index.html` (a blue folder with a yellow card). It can be exported to every size above.

## 5. Authentication risks (current demo build)

All of this is by design in the original demo. None of it is safe for real students.

1. **Plain-text passwords.** `DB.createUser` stores `password` as typed, in `localStorage` key `stash_users`. Login compares `user.password !== password` (`script.js` ~1008). Change-password and delete-account also compare plain text (~2652, ~2684). Anyone with the device (or XSS) can read every password.
2. **No server.** Accounts exist only in that browser. Another phone or browser sees no account. Clearing site data deletes the account **and** all documents (IndexedDB `stash_files_db`).
3. **Session is a localStorage/sessionStorage value** with no expiry, signature or revocation.
4. **Google sign-in is fake.** `#googleLoginBtn` creates/opens `google.demo@school.edu` with password `__google__` and name "Google Student", matric `GOOGLE-DEMO`. It never talks to Google. Anyone clicking it gets in.
5. **User IDs** are `Date.now()` + `Math.random()`: predictable, not a security boundary.
6. **No rate limiting / lockout** on login attempts.
7. Passwords are not logged by my changes. Original code does not log them either.

## 6. Password recovery: missing

"Forgot password" opens a modal and shows a confirmation, but **no email is sent and no reset exists**. The confirmation text implies otherwise. A student who forgets their password is permanently locked out of the browser's data. Needs a real flow: Supabase Auth reset email → set-new-password page → session invalidation. (Supabase handles all of this once real auth is in; see ARCHITECTURE.md.) Until then the copy should say it's unavailable. I kept the approved behaviour; flagged as D7.

## 7. Feature audit: working / mockup / unsupported

Legend: **W** works locally in the browser · **M** mockup / demo-only · **U** claim or UI not supported by code · **N** could not be tested here (needs CDN)

| Feature | Status | Detail |
|---|---|---|
| Signup / login by matric or email | W (local only) | Validation, duplicate check, remember-me. Browser-local accounts only. |
| Google login | M | See §5.4 |
| Forgot password | M | See §6 |
| Route guards (signed-out → login, signed-in → dashboard) | W | Tested |
| Upload (images, PDFs, multi-file) | W | Stored in IndexedDB. 10 MB per-file cap (`upload.maxFileSizeMB`). |
| Free-plan limits (50 docs, 2048 MB, 5 OCR/day) | W (client-side) | Enforced in JS only. Trivially bypassed by editing storage. Not real quotas. |
| OCR (Tesseract.js) | N | Loaded from jsDelivr at runtime. Code paths are guarded (`typeof Tesseract === 'undefined'` → toast "OCR engine unavailable offline"). **Fails offline**, which matters on campus data. Accuracy on phone photos of Nigerian receipts is unmeasured. |
| PDF text extraction (pdf.js) | N | cdnjs CDN, worker from CDN. Same offline caveat. |
| Auto-categorise / extract fields | W (heuristic) | Keyword rules from `data.json → extraction`. Not ML. Can mis-file; user can edit. |
| Search | W | Over title, tags, OCR text, local only. |
| Clearance checklist | W | Matches docs to `clearanceRequirements` by category and keywords, per level/semester. Requirements are **sample data** (fees receipt, admission letter, registration…). They are not any specific school's real list. |
| Clearance PDF (jsPDF) | N, and **narrower than it sounds** | Generates one summary PDF ("Clearance Packet": checklist + document list). It does **not** merge the actual files into one packet. Landing copy was corrected to say "summary PDF". |
| Cafe Print: PIN generation | W (local only) | 4-digit PIN, 10-min expiry, stored in the browser's `localStorage`. |
| Cafe Print: PIN redemption | **M** | Redemption reads the *same browser's* storage. A cafe's computer cannot open a PIN made on a student's phone. Only works on one device. This is the biggest gap between the marketing story and the code. |
| Cafe Print: security | U | 4-digit PINs = 9,000 possibilities; reusable until expiry (`consumePin` doesn't delete); `Math.random`. Fine for a demo, not for real documents. Opens one document at a time; "prints" via `window.print()`. |
| Print a single doc | W | `window.print()` with a print area. |
| Plan upgrade / "Pro" | U | `user.plan` is always `free`; there is no code path to Pro. UI strings such as "upgrade to Pro" (documents, OCR quota) point at something that doesn't exist. Left in place (not removing features); flagged D5. |
| Payments | None | Not built, per instruction. |
| PWA install / offline | U | See §4. Manifest present, icons and service worker absent. |
| `dashboard.html` | Orphan | Old standalone file, unlinked. Untouched. |

**Unsupported claims in copy**, status: landing copy was audited and corrected (no fake testimonials, no user counts, no security claims beyond what exists). Remaining FAQ answers were rewritten to match behaviour. Two things to keep honest: don't say "secure" / "private" about stored files until the backend exists, and don't promise Cafe Print across devices until it does.

## 8. Data file (`data.json`)

- `pricingPlans` (stale, conflicting) → removed. `pricing` added (single source for display; amounts in kobo).
- `plans.free` kept as the enforced limit set. `plans.pro` kept (read by `Plans.limits`), flagged unreachable.
- Sample `clearanceRequirements` need real department/school data eventually.

## 9. Files delivered this revision

`index.html`, `script.js`, `landing.css`, `data.json`, `styles.css`, and `docs/` are complete files in the zip. `manifest.json`, `dashboard.html` unchanged.
