# Matric-number correction process (controlled, audited)

**Why it exists.** A student's matric number is locked after onboarding. Account ownership is the immutable Supabase user ID, not the matric number, but the matric number will later be used to link a student to paid access and institutional records, so it must not be freely editable. `save_my_profile()` refuses any change (`matric_locked`); only the function below can change it, and only an administrator can run it.

**What Stash does NOT do.** It does not know what evidence FULAFIA considers authoritative, and it does not check the number against any university record. *You* decide what proof is required (for example a student ID card or admission letter) and write that decision into your support process. Matric numbers in Stash are **self-declared** until an institutional check exists.

## Procedure

1. **Request.** The student writes to your support contact **from the email address registered on the account**. A request from any other address is not actioned.
2. **Revalidate.** Check the evidence you require for the new number. Do not accept a screenshot of a chat or the number alone.
3. **Look up the account** (Supabase → SQL Editor, runs as `postgres`):
   ```sql
   select id, email, matric_number, level from public.profiles where email = 'student@example.com';
   ```
4. **Apply the correction** with a reason that names the evidence reviewed (minimum 10 characters; it is stored in the audit table):
   ```sql
   select public.admin_correct_matric(
     '<user id from step 3>', '<NEW/MATRIC>', 'Checked student ID card, ref ticket #123, 2026-11-01');
   ```
   The function re-validates the format, requires a **verified-email** account, refuses a no-op, and refuses if another account already holds the number.
5. **If it fails with `matric_in_use_by_another_account`:** two people claim one number. Do **not** tell either student who holds it. Treat it as a dispute: collect evidence from both through their registered emails, decide, and correct the *other* account first if it is the wrong one.
6. **Reply** to the student that the change is made. They do not need to sign out.

## Audit trail
```sql
select corrected_at, user_id, old_matric, new_matric, reason, corrected_by
  from public.matric_corrections order by corrected_at desc;
```
Rows are kept even if the account is later deleted (there is deliberately no foreign key). Students and the browser cannot read this table.

## Rules
- Only the SQL editor (postgres) or the **service role** may call `admin_correct_matric`. It is revoked from `anon` and `authenticated`; `scripts/verify-supabase.js` checks this on your project.
- Never put the service-role key in this repository, in Vercel variables used by the browser build, or in frontend code. The build refuses it.
- Deleting an account frees its matric number for re-registration. That is intended (the student is gone), but note it when investigating disputes.
- Level can be changed by the student; it is not covered by this process.
