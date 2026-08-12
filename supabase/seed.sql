-- Seed data for Slice 1 (cashier redemption screen)
--
-- Creates one fake café, one branch, one plan, and five members that sit in the
-- five states the redemption screen has to handle correctly.
--
-- SAFE TO RE-RUN. It deletes its own previous rows first, so the "redeemed
-- today" member is always actually today. Run it again any morning.
--
-- It only ever touches rows belonging to merchant a0000000-...-000000000001.
-- Real merchant data is untouched.

begin;

-- ---------------------------------------------------------------------------
-- 0. Clear any previous run of this seed
--
-- redemptions is append-only and a trigger blocks DELETE. That protection is
-- correct and must stay. We switch it off for exactly the length of this
-- delete, for seed rows only, then switch it straight back on.
--
-- NOTHING IN THE APPLICATION MAY EVER DO THIS. If you see `disable trigger`
-- anywhere outside this seed file, it is a bug.
-- ---------------------------------------------------------------------------
alter table redemptions disable trigger redemptions_no_update;

delete from redemptions    where merchant_id = 'a0000000-0000-0000-0000-000000000001';
delete from ledger_entries where merchant_id = 'a0000000-0000-0000-0000-000000000001';

alter table redemptions enable trigger redemptions_no_update;

delete from subscriptions where merchant_id = 'a0000000-0000-0000-0000-000000000001';
delete from members       where phone_e164 like '+96650000000%';
delete from plans         where merchant_id = 'a0000000-0000-0000-0000-000000000001';
delete from branches      where merchant_id = 'a0000000-0000-0000-0000-000000000001';
delete from merchants     where id          = 'a0000000-0000-0000-0000-000000000001';


-- ---------------------------------------------------------------------------
-- 1. Merchant and branch
-- ---------------------------------------------------------------------------
insert into merchants (id, name, name_ar, status) values
  ('a0000000-0000-0000-0000-000000000001',
   'Sharq Coffee', 'قهوة الشرق', 'active');

insert into branches (id, merchant_id, name, name_ar, address, latitude, longitude, status) values
  ('b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'Main Branch', 'الفرع الرئيسي',
   'King Saud St, Dammam',
   26.4207, 50.0888,          -- Dammam. Used later for Wallet pass geofencing.
   'active');


-- ---------------------------------------------------------------------------
-- 2. Plan — 22 cups over 30 days, 179 SAR
--
-- WHY 22 AND NOT 30. CLAUDE.md's headline example is "30 coffees for 199/mo",
-- but with per_day_cap = 1 a member can physically take at most 30 cups in a
-- 30-day period. Quota can then only run out on the very last day, so the
-- "quota exhausted" branch of the redemption screen would be nearly unreachable
-- in real life and effectively untested.
--
-- 22 cups over 30 days (BUILD-SPEC's "Weekday Coffee" template) is both a real
-- product and a plan where quota genuinely binds. Worth discussing separately —
-- see the note I left you about the 30/30 plan shape.
--
-- 179 SAR = 17900 halalas. Money is always integer halalas, never a float.
-- ---------------------------------------------------------------------------
insert into plans (id, merchant_id, name, name_ar, description,
                   price_halalas, period_days, quota_total, rules, status) values
  ('c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'Weekday Coffee', 'قهوة أيام العمل',
   '22 cups per month, one per day',
   17900, 30, 22,
   '{"per_day_cap":1,"valid_from_hour":6,"valid_to_hour":23,"blackout_dates":[]}'::jsonb,
   'active');


-- ---------------------------------------------------------------------------
-- 3. Members
--
-- Phone numbers are all +96650000000X so the cleanup above can find them.
-- member_ref is left to its column default (migration 0001) — a random 22-char
-- id, which is what the QR code will carry.
--
-- Names are English for readability while developing, EXCEPT فهد. Real members
-- in Dammam will overwhelmingly have Arabic names, and the confirm screen
-- prints the member's name in large type — the one place a script or direction
-- bug is guaranteed to show up. Keeping one Arabic name means every run of the
-- redemption flow exercises that path instead of us discovering it in a café.
--
-- `locale` is the member's UI language and is separate from the script their
-- name happens to be written in. It stays 'ar' for all of them.
-- ---------------------------------------------------------------------------
insert into members (id, phone_e164, display_name, locale) values
  ('d0000000-0000-0000-0000-000000000001', '+966500000001', 'Sara',     'ar'),
  ('d0000000-0000-0000-0000-000000000002', '+966500000002', 'Khalid',   'ar'),
  ('d0000000-0000-0000-0000-000000000003', '+966500000003', 'Noura',    'ar'),
  ('d0000000-0000-0000-0000-000000000004', '+966500000004', 'فهد',      'ar'),
  ('d0000000-0000-0000-0000-000000000005', '+966500000005', 'Abdullah', 'ar');


-- ---------------------------------------------------------------------------
-- 4. Subscriptions — one per member, each in a different state
--
-- quota_total and rules_snapshot are COPIED from the plan, never referenced.
-- If the café later edits the plan, what an existing member was sold must not
-- change underneath them.
-- ---------------------------------------------------------------------------
insert into subscriptions (id, member_id, plan_id, merchant_id, status,
                           starts_at, ends_at, quota_total, price_paid_halalas,
                           rules_snapshot, activation_method) values

  -- (1) Sara — ACTIVE, QUOTA LEFT. The normal happy path.
  --     22 total, 5 used below, 17 remaining. Last redemption was 2 days ago,
  --     so she is eligible right now.
  ('e0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'active', now() - interval '10 days', now() + interval '20 days',
   22, 17900,
   '{"per_day_cap":1,"valid_from_hour":6,"valid_to_hour":23,"blackout_dates":[]}'::jsonb,
   'manual'),

  -- (2) Khalid — QUOTA EXHAUSTED. Subscription still active and still inside its
  --     date window, but all 22 cups are gone. Tests eligibility rule 3 in
  --     isolation, with nothing else also failing.
  ('e0000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'active', now() - interval '25 days', now() + interval '5 days',
   22, 17900,
   '{"per_day_cap":1,"valid_from_hour":6,"valid_to_hour":23,"blackout_dates":[]}'::jsonb,
   'manual'),

  -- (3) Noura — EXPIRED. Note status is still 'active' while ends_at is in the
  --     past. That is deliberate: it is the real state of every subscription
  --     between the moment it lapses and the moment some future job marks it
  --     expired. The redemption screen must reject her on the DATE WINDOW
  --     (rule 2), not on status, because status will often still say active.
  ('e0000000-0000-0000-0000-000000000003',
   'd0000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'active', now() - interval '40 days', now() - interval '3 days',
   22, 17900,
   '{"per_day_cap":1,"valid_from_hour":6,"valid_to_hour":23,"blackout_dates":[]}'::jsonb,
   'manual'),

  -- (4) فهد — ALREADY REDEEMED TODAY. Plenty of quota left (21 of 22) and well
  --     inside his dates. The ONLY thing stopping him is the one-per-day cap.
  --     This is the most common real rejection at a counter, so its message
  --     matters most: "next cup tomorrow", never an error code.
  ('e0000000-0000-0000-0000-000000000004',
   'd0000000-0000-0000-0000-000000000004',
   'c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'active', now() - interval '5 days', now() + interval '25 days',
   22, 17900,
   '{"per_day_cap":1,"valid_from_hour":6,"valid_to_hour":23,"blackout_dates":[]}'::jsonb,
   'manual'),

  -- (5) Abdullah — PENDING ACTIVATION. He picked a plan but has not paid the
  --     café yet. No dates, no quota, nothing paid. A cashier scanning him
  --     should be told to activate him, not told he is invalid.
  ('e0000000-0000-0000-0000-000000000005',
   'd0000000-0000-0000-0000-000000000005',
   'c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'pending', null, null,
   null, 0,
   '{}'::jsonb,
   'manual');


-- ---------------------------------------------------------------------------
-- 5. Redemption history
--
-- Every row sets business_day explicitly from business_day(created_at), because
-- the café day runs 04:00-04:00 Riyadh. A 01:30 redemption belongs to the
-- PREVIOUS business day, and the unique index enforcing one-per-day is built on
-- this column, not on the raw timestamp.
--
-- idempotency_key is deterministic here ('seed-...') purely so a re-run is
-- predictable. Real redemptions use a client-generated uuid v4.
-- ---------------------------------------------------------------------------

-- Sara: 5 redemptions, 2 to 6 days ago. Nothing today, so she is eligible now.
insert into redemptions (subscription_id, member_id, merchant_id, branch_id,
                         business_day, item_label, qty, source, status,
                         idempotency_key, created_at)
select
  'e0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  business_day(now() - (d || ' days')::interval),
  'americano', 1, 'qr', 'completed',
  'seed-sara-' || lpad(d::text, 2, '0'),
  now() - (d || ' days')::interval
from generate_series(2, 6) as d;

-- Khalid: 22 redemptions on 22 consecutive days, 1 to 22 days ago. Uses the whole
-- quota. All fall inside his 25-day-old subscription window.
insert into redemptions (subscription_id, member_id, merchant_id, branch_id,
                         business_day, item_label, qty, source, status,
                         idempotency_key, created_at)
select
  'e0000000-0000-0000-0000-000000000002',
  'd0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  business_day(now() - (d || ' days')::interval),
  'latte', 1, 'qr', 'completed',
  'seed-khalid-' || lpad(d::text, 2, '0'),
  now() - (d || ' days')::interval
from generate_series(1, 22) as d;

-- Noura: 4 redemptions from while her subscription was still valid.
insert into redemptions (subscription_id, member_id, merchant_id, branch_id,
                         business_day, item_label, qty, source, status,
                         idempotency_key, created_at)
select
  'e0000000-0000-0000-0000-000000000003',
  'd0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  business_day(now() - (d || ' days')::interval),
  'americano', 1, 'qr', 'completed',
  'seed-noura-' || lpad(d::text, 2, '0'),
  now() - (d || ' days')::interval
from generate_series(10, 13) as d;

-- فهد: exactly one redemption, TODAY. created_at and business_day are both
-- taken from the same now() so they can never disagree across the 04:00 rollover.
insert into redemptions (subscription_id, member_id, merchant_id, branch_id,
                         business_day, item_label, qty, source, status,
                         idempotency_key, created_at)
values
  ('e0000000-0000-0000-0000-000000000004',
   'd0000000-0000-0000-0000-000000000004',
   'a0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   business_day(now()), 'cappuccino', 1, 'qr', 'completed',
   'seed-fahad-today', now());

-- Abdullah: none. He has never been activated.

commit;


-- ---------------------------------------------------------------------------
-- 6. Check what you just created
--
-- Run this on its own afterwards. Expect exactly:
--   Sara    active    17 of 22 left   redeemable
--   Khalid    active     0 of 22 left   NOT redeemable (quota gone)
--   Noura    active    18 of 22 left   NOT redeemable (dates passed)
--   فهد     active    21 of 22 left   redeemable by the view, but the screen
--                                     must still refuse — the view does not
--                                     know about the one-per-day rule
--   Abdullah pending        no quota   NOT redeemable
--
-- That فهد row is the important one. v_subscription_status deliberately does
-- not implement the per-day cap, so the eligibility function has to. If you
-- ever see the app trusting is_redeemable on its own, that is the bug.
-- ---------------------------------------------------------------------------
-- select m.display_name, v.status, v.quota_remaining, v.quota_total,
--        v.is_redeemable, business_day(v.last_redeemed_at) as last_day
--   from v_subscription_status v
--   join members m on m.id = v.member_id
--  where v.merchant_id = 'a0000000-0000-0000-0000-000000000001'
--  order by m.display_name;
