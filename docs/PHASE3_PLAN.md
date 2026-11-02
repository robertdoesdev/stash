# Phase 3: cloud document storage (design, assumptions, open decisions)

Branch `phase3-cloud-storage`. Scope: private Supabase Storage, PostgreSQL metadata with per-user ownership, secure upload/preview/download/delete, cloud-backed search and organisation, server-side quota (1 GB Free, 5 GB paid), safe migration of existing local data. **Authentication, payments and existing screens are unchanged** (the only UI addition is one "Cloud storage" row in Settings built from the existing panel/switch styles).
**Nothing here has been applied to a live Supabase project or tested against real Supabase Storage.** See `PHASE3_TEST_REPORT.md`.

## Architecture
```
 browser (vanilla JS)                                   Supabase
 ┌───────────────────────────┐   rpc / storage API    ┌───────────────────────────────┐
 │ script.js  (unchanged UI) │                        │ public.documents  (RLS: own)  │
 │  DB.saveDocuments ──┐     │  begin_upload ───────► │ public.user_entitlements      │
 │  FileStore.get ◄─┐  │     │  PUT object  ────────► │ storage bucket "documents"    │
 │ cloud.js (new)   │  ▼     │  finalize_upload ────► │   private, 10 MiB, pdf/jpg/png│
 │  diff → queue → sync      │  download/verify ◄──── │   path  <user_id>/<doc_id>    │
 └───────────────────────────┘                        └───────────────────────────────┘
```
`cloud.js` wraps two existing seams (`DB.saveDocuments`, `FileStore.get`), so no screen was rewritten. Local IndexedDB/localStorage remains the working copy.

## Data model (`supabase/migrations/0003_documents.sql`)
- `documents`: owner `user_id` (FK to `auth.users`, cascade), `status` (`pending` → `ready`; `failed`; `deleting`), title/original name/mime, `declared_size` vs real `size_bytes`, `sha256`, `category`, `tags`, `notes`, `ocr_text`, free-form `metadata` (≤16 KB), `storage_path = <user_id>/<id>` (CHECK-enforced), generated full-text vector (title A, name/category/tags B, notes C, OCR D), `local_ref` (client id, unique per user → idempotent retries/migration).
- `user_entitlements(user_id, tier free|paid)`: **no grants to any app role**; only an administrator/service role can write it. Absent row = free.
- `storage_deletion_queue`: paths an operator job must remove (account deletion). Private.
- Browsers can only `SELECT` their own `documents` rows. Every write is a `SECURITY DEFINER` function (`set search_path=''`), execute granted to `authenticated` only.

## Flows
- **Upload (two-phase):** `begin_upload` validates (verified email, type, ≤10 MiB, sizes, metadata), checks quota **including pending reservations**, creates a `pending` row (1 h expiry) → client uploads to that exact path (Storage RLS permits only the caller's live pending path; no overwrite) → `finalize_upload` reads the **real** object size/type from `storage.objects`; mismatch ⇒ row `failed`, object removed. Client then downloads the object and compares size + SHA-256 before marking it *verified*.
- **Quota:** `used = Σ rows` using the real object size when larger than declared; `failed`/`deleting`/expired rows keep counting until their object is confirmed gone, so quota can't be dodged by abandoning or half-deleting uploads. Free 1 GiB, paid 5 GiB, decided only on the server.
- **Delete (two-phase):** `begin_delete` → client removes the object (Storage RLS only allows removal of rows that are `deleting/failed/pending`, never `ready`) → `confirm_removed` deletes the row only if the object is verifiably absent. Interrupted deletes are stored on the device and resumed.
- **Search/organisation:** `update_document_meta` (title/category/tags/notes/OCR/metadata) and `search_my_documents` (prefix, AND of ≤8 terms, category filter, ranked, ≤100 rows, no OCR text in results).
- **Migration:** opt-in toggle in Settings; every existing local document is queued, uploaded, verified. **Local copies are never deleted by sync.** Progress and per-document state survive reloads; failed items retry with backoff and on "Sync now".
- **Other devices:** on start/Sync now, cloud-only documents appear in the local list; their files download on first open and are cached.
- **Account deletion:** client best-effort removes objects; `delete_my_account()` also queues every remaining path in `storage_deletion_queue`; `scripts/cleanup-orphans.js` (service role, run by an operator) removes them.

## Assumptions (please confirm or correct)
1. **1 GB = 1 GiB (1,073,741,824 bytes); 5 GB = 5 GiB.** Changing it is one function (`storage_limit_bytes`).
2. Per-file cap stays **10 MiB** and types stay PDF/JPEG/PNG (the existing client limits), now also enforced by the bucket and the database.
3. **Paid tier is set only by an administrator** (SQL/service role) until payments exist. This phase grants nobody paid access and adds no payment code. Pricing-card text is unchanged ("What's included will be confirmed"): storage size is the first decided entitlement; the rest stay undecided.
4. **Cloud backup is opt-in per account**, not automatic. Existing documents upload only after the student switches it on.
5. "Clear local vault" clears **this device only**; cloud copies stay and return on the next Sync. Deleting a document deletes its cloud copy. A document deleted on another device is **not** removed locally (it is flagged "no longer in the cloud", kept here).
6. Supabase Storage populates `storage.objects.metadata->>'size'` and `->>'mimetype'` once an upload completes, and the SQL-editor role may create policies on `storage.objects`. `scripts/verify-supabase.js` tests the first on your project; the second shows up when you apply the migration.
7. Quota counts file bytes only (not database text such as OCR).
8. The free plan's **50-document limit is still enforced only in the browser** (as before). The server enforces bytes, not document count.
9. Uploads run in the background after the existing local save, so the Upload screen still says "Saved" first; cloud problems (quota full, retrying) appear as a toast and in Settings, not on the Upload screen.
10. `data.json` plan sizes were changed to 1024 / 5120 MB to match the server. This changes the free-plan storage figure shown on the landing page's pricing note ("2 GB" → "1 GB"); nothing else on the landing page changed (pixel-compared).

## Deliberate non-goals / decisions for you
- **Search UI:** the Documents search box still filters the local list, which now mirrors cloud metadata including OCR text. The server search function exists and is tested but is **not** wired into the screen, to avoid changing the approved UI. Say if you want the box switched to server search when online.
- No sharing, no public links, no signed URLs (downloads use authenticated requests into blob URLs), no versioning, no virus scanning, no server-side OCR.
- Conflict handling is last-writer-wins on metadata only when the local copy was not edited since the last sync.
