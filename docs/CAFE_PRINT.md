# Cafe Print (Phase 4a): one-time 6-digit PINs

A student picks one **uploaded** document and gets a 6-digit PIN. A cafe computer, with no login and on any device,
types the PIN at `#print-portal` and can print that one document. The PIN works once and lasts 10 minutes.
It replaces the old browser-local `stash_cafe_pins` store, which was removed (the app deletes that legacy key on load and
touches no other local data).

## Architecture

| Piece | Where | Runs as |
|---|---|---|
| Tables, PIN generation, hashing, atomic redeem, rate limits | `supabase/migrations/0004_cafe_print.sql` | Postgres (SECURITY DEFINER functions) |
| `POST /api/cafe/redeem`, `POST /api/cafe/refresh`, `GET /api/cafe/cleanup` | `api/cafe/*.js`, `api/_lib/cafe.js` | Vercel Node functions, **service role (server only)** |
| Student screen (`#cafepin`) | `script.js` `CafeStudent`, `cloud.js` `StashCloud.cafe` | Browser, signed-in student JWT, RPC only |
| Cafe screen (`#print-portal`) | `script.js` `CafePrint`, markup in `index.html` | Browser, anonymous, talks only to `/api/cafe/*` |

The browser never receives the service-role key. Students call three RPCs as themselves (`cafe_create_pin`, `cafe_my_pins`,
`cafe_revoke_pin`). The anonymous cafe page has no direct database access at all; only the Vercel endpoints (service role)
can run `cafe_redeem` / `cafe_refresh` / `cafe_cleanup`.

## PIN lifecycle

`active` -> `redeemed` (used once) | `revoked` (student cancelled) | `expired` (10 minutes, by database time).

* **Create** `cafe_create_pin(document_id)`: requires a signed-in, email-verified student; the document must belong to them,
  be `ready` and really exist in the private `documents` bucket. One live PIN per student (a second request returns
  `active_exists` and never re-shows the digits). Max 12 PINs per student per hour. The PIN is generated in the database with its
  CSPRNG (`gen_random_uuid`, rejection sampling so all 1,000,000 values are equally likely, zero-padded) and returned **once**.
  Only `sha256(pepper:pin)` is stored. Collisions with another live PIN are redrawn.
* **Redeem** (cafe): one `UPDATE ... WHERE status='active' AND expires_at > now() AND document still valid ... RETURNING`.
  Two simultaneous requests cannot both succeed (tested with 25 parallel connections). Unknown, expired, revoked, used and
  "document gone" all return the identical `404 {"error":"invalid"}`.
* **Signed URL**: the endpoint signs exactly one object path for 90 seconds. It grants no listing and no other file.
* **Retrieval failure after redemption**: the PIN stays consumed. The redeem response (and the 502 `retrieval_failed` case)
  carries a *receipt* (256-bit, stored hashed, 5 minutes, max 3 refreshes). `/api/cafe/refresh` re-signs the SAME document. The
  cafe UI offers "Try again". After that the student must make a new PIN. Only the database can enforce this; the receipt can
  never reopen the PIN.

## Abuse protection (all in the database, before any lookup)

* Per client (salted HMAC of the caller IP; IPv6 reduced to /64; raw IPs never stored): max 30 requests/minute and
  5 wrong guesses per 15 minutes, then a 15-minute lock. Correct PINs are refused during a lock. **A success never resets a failure
  counter**, and no API role can write the counter tables.
* Global ceiling: 120 failed guesses per hour across everyone. When reached, redemption is refused for everybody (fail-closed)
  until the window ends. This bounds distributed guessing to about 120 / 1,000,000 per hour per active PIN... but it also means an
  attacker with many IPs can **temporarily block the cafe flow**. That is a deliberate trade-off. Mitigations you can add: Vercel
  Firewall rate rules on `/api/cafe/*`, Vercel BotID/Turnstile on the cafe page, a lower global limit in `cafe_settings`.
* All limits live in the single-row table `cafe_settings` (readable by nobody except the migration owner / SQL editor).
* `CRON_SECRET`-protected daily cleanup (`/api/cafe/cleanup`, scheduled in `vercel.json`) expires lapsed PINs, strips old receipts, deletes
  PIN history older than 7 days and stale throttle rows.

Limits of a 6-digit PIN: it is a convenience credential, not a strong secret. One live PIN per student and the above limits
keep guessing impractical for a single attacker, not impossible for a large, distributed one. The PIN grants a 10-minute,
single-document, single-use read.

## Privileges (verified by tests)

* `anon`: no access to any cafe table or function.
* `authenticated`: may `SELECT` only non-secret columns of their own PIN rows (RLS); no insert/update/delete; no `pin_hash`,
  no `receipt_*`; may call only the 3 student RPCs.
* `service_role`: may call only `cafe_redeem`, `cafe_refresh`, `cafe_cleanup`; no direct table access.
* Responses are `Cache-Control: no-store`; endpoints accept POST only (GET for the cron), same-origin only, ~2 KB body cap.
  Logs contain event names and result codes only: never PINs, receipts, signed URLs, paths, titles or IPs.
* PINs and signed URLs are never put in `localStorage`/`sessionStorage`/IndexedDB or the console. The cafe page holds the signed
  URL and receipt in memory only and drops them on "Done"/page close.

## Setup (development project only)

1. **Database**: in the `stash-dev` project's SQL editor run `supabase/migrations/0004_cafe_print.sql` (after 0001-0003).
   It is idempotent and keeps the existing secret pepper when re-run. Do not run it on production until you have tested here.
2. **Vercel env vars** (Project -> Settings -> Environment Variables; set them for the dev/preview environment first):
   * `SUPABASE_URL` = `https://tjspuzzchjksbxtmmryg.supabase.co`
   * `SUPABASE_SERVICE_ROLE_KEY` = the project's service role / secret key. **Server-only. Do not prefix with anything public,
     never commit it, never put it in `env-config.js`.** The build already fails if a secret key reaches `dist/`.
   * `CAFE_IP_SALT` = a long random string (e.g. `openssl rand -hex 32`).
   * `CRON_SECRET` = a long random string (Vercel then sends it as a Bearer token to the cron).
3. Deploy a **preview** from your branch. `vercel.json` already contains the cron and `/api/*` no-store headers.
4. Optional: instead of (or besides) the Vercel cron you can enable `pg_cron` in Supabase and schedule
   `select public.cafe_cleanup();` daily.
5. The `documents` bucket must stay private (it is). Nothing in this feature changes bucket policies.

The student screen needs cloud sync on for the documents to be PIN-able: only documents that the **server** reports as `ready`
are offered; local-only, pending, failed and deleting documents are listed in a note and cannot get a PIN. Nothing is uploaded
silently and no sync preference is changed.

## Tests

| Command | What it proves | Real or simulated |
|---|---|---|
| `bash tests/db/run.sh` | 0004 on throwaway PostgreSQL 16: privileges/RLS, creation rules, expiry, one-time redeem, revoke, lockouts, global ceiling, receipts, cleanup, cascades, PIN uniformity, collision redraw, idempotent re-apply, **parallel-connection concurrency** (create / redeem / refresh / guessing) | Real PostgreSQL (Supabase auth/storage replaced by minimal stubs) |
| `bash tests/api/run.sh` | The real `api/cafe/*.js` handlers over HTTP against the real database: no-login redeem, signed-URL binding/expiry, private bucket, 20-way concurrent redeem, brute force, flooding, IPv6, validation, CORS, receipt retry, cleanup auth, no secrets in logs | Real handlers and DB; **Supabase REST/Storage is a test double** |
| `node tests/e2e/cafe.e2e.js` (static server on :8767, `BASE=http://localhost:8767/index.html NODE_PATH=$(npm root -g)`) | Student and cafe UI in a real browser, two separate browser contexts, responsive layouts | Real UI, mocked backends |
| existing suites | auth, layout, hardening, cloud, theme, regress, build tests | as before |

**Not verified here** (needs your dev project): the migration on the real Supabase Postgres, real Storage signed URLs (including CORS for
the in-browser download), Vercel function deployment and cron, and a real two-device print. See the report for a checklist.
