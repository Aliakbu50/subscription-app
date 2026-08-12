-- Migration 0002 — let a signed-in staff member read their own staff row
--
-- THE BUG THIS FIXES
-- schema.sql enables row level security on staff_users but never creates a
-- policy for it. In Postgres that means deny-all: with RLS on and no policy,
-- every row is invisible to everyone except roles that bypass RLS.
--
-- The result is that a cashier signs in successfully, and then the app cannot
-- tell which café they work for. /pos shows "this account is not linked to a
-- merchant" for a correctly configured account.
--
-- It is easy to miss because current_merchant_id() keeps working — it is
-- declared `security definer`, so it runs with the definer's rights and reads
-- staff_users regardless. Anything querying the table directly does not.
--
-- SCOPE
-- Deliberately narrow: a staff member may read THEIR OWN row and nothing else.
-- Reading colleagues' rows is not needed by the redemption screen, and the
-- staff list belongs to the merchant dashboard in Slice 3, where it can get a
-- policy written for that purpose.

create policy staff_read_self on staff_users
  for select
  using (auth_user_id = auth.uid());


-- Deliberately still deny-all, for the record:
--   audit_log       — written server-side, never read by the POS
--   ledger_entries  — written server-side, read by reporting in Slice 4
--   otp_attempts    — nothing may ever read this from a client
-- Those three are correct as they are. staff_users was the odd one out.
