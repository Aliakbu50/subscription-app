-- Phase 1 schema — subscription backend for KSA merchants
-- Target: Supabase Postgres
-- Money is ALWAYS integer halalas. 199.00 SAR = 19900.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Business day helper
-- The café day runs 04:00 -> 04:00 Asia/Riyadh. A redemption at 01:30 belongs
-- to the previous business day. Every per-day rule must use this function.
-- ---------------------------------------------------------------------------
create or replace function business_day(ts timestamptz)
returns date
language sql
immutable
as $$
  select (((ts at time zone 'Asia/Riyadh') - interval '4 hours'))::date;
$$;


-- ---------------------------------------------------------------------------
-- Merchants and branches
-- ---------------------------------------------------------------------------
create table merchants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  name_ar     text,
  status      text not null default 'active'
              check (status in ('active','paused','churned')),
  created_at  timestamptz not null default now()
);

create table branches (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchants(id) on delete cascade,
  name         text not null,
  name_ar      text,
  address      text,
  latitude     double precision,
  longitude    double precision,
  status       text not null default 'active'
               check (status in ('active','closed')),
  created_at   timestamptz not null default now()
);
create index on branches (merchant_id);


-- ---------------------------------------------------------------------------
-- Staff — links a Supabase auth user to a merchant with a role
-- ---------------------------------------------------------------------------
create table staff_users (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchants(id) on delete cascade,
  branch_id     uuid references branches(id) on delete set null, -- null = all branches
  auth_user_id  uuid not null unique,      -- references auth.users(id)
  display_name  text not null,
  phone_e164    text,
  role          text not null default 'cashier'
                check (role in ('owner','manager','cashier')),
  status        text not null default 'active'
                check (status in ('active','disabled')),
  created_at    timestamptz not null default now()
);
create index on staff_users (merchant_id);
create index on staff_users (auth_user_id);


-- ---------------------------------------------------------------------------
-- Plans
-- rules jsonb example:
--   {"per_day_cap":1,"valid_from_hour":6,"valid_to_hour":23,
--    "eligible_items":["americano","latte"],"blackout_dates":[]}
-- Phase 1: a plan is valid at all branches of its merchant.
-- Multi-branch scoping is a Phase 1b concern — do not add it yet.
-- ---------------------------------------------------------------------------
create table plans (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references merchants(id) on delete cascade,
  name            text not null,
  name_ar         text,
  description     text,
  price_halalas   integer not null check (price_halalas >= 0),
  period_days     integer not null default 30 check (period_days > 0),
  quota_total     integer check (quota_total is null or quota_total > 0), -- null = unlimited
  rules           jsonb not null default '{"per_day_cap":1}'::jsonb,
  status          text not null default 'active'
                  check (status in ('active','archived')),
  created_at      timestamptz not null default now()
);
create index on plans (merchant_id);


-- ---------------------------------------------------------------------------
-- Members — GLOBAL identity, never scoped to a merchant.
-- This is what makes Phase 2 cross-merchant bundles possible.
-- ---------------------------------------------------------------------------
create table members (
  id           uuid primary key default gen_random_uuid(),
  phone_e164   text not null unique,
  display_name text,
  locale       text not null default 'ar' check (locale in ('ar','en')),
  auth_user_id uuid unique,             -- references auth.users(id)
  created_at   timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- Subscriptions
-- quota_total is COPIED from the plan at activation so that later plan edits
-- never retroactively change what an existing member was sold.
-- ---------------------------------------------------------------------------
create table subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  member_id           uuid not null references members(id) on delete restrict,
  plan_id             uuid not null references plans(id) on delete restrict,
  merchant_id         uuid not null references merchants(id) on delete restrict,
  status              text not null default 'pending'
                      check (status in ('pending','active','expired','cancelled')),
  starts_at           timestamptz,
  ends_at             timestamptz,
  quota_total         integer,
  price_paid_halalas  integer not null check (price_paid_halalas >= 0),
  rules_snapshot      jsonb not null default '{}'::jsonb,
  activation_method   text not null default 'manual'
                      check (activation_method in ('manual','payment_link')),
  activated_by        uuid references staff_users(id),
  payment_ref         text,
  created_at          timestamptz not null default now()
);
create index on subscriptions (member_id);
create index on subscriptions (merchant_id, status);

-- A member may hold only one active subscription per plan at a time.
create unique index subscriptions_one_active_per_plan
  on subscriptions (member_id, plan_id)
  where status = 'active';


-- ---------------------------------------------------------------------------
-- Redemptions — APPEND ONLY.
-- Never UPDATE. Never DELETE. A void is a NEW row with status='voided'
-- and voids_redemption_id pointing at the original.
-- ---------------------------------------------------------------------------
create table redemptions (
  id                   uuid primary key default gen_random_uuid(),
  subscription_id      uuid not null references subscriptions(id) on delete restrict,
  member_id            uuid not null references members(id) on delete restrict,
  merchant_id          uuid not null references merchants(id) on delete restrict,
  branch_id            uuid not null references branches(id) on delete restrict,
  staff_user_id        uuid references staff_users(id),
  business_day         date not null,
  item_label           text,
  qty                  integer not null default 1 check (qty > 0),
  tokens               integer not null default 3,   -- forward-compat for Phase 2
  source               text not null default 'qr'
                       check (source in ('qr','phone','pos','manual')),
  status               text not null default 'completed'
                       check (status in ('completed','voided')),
  voids_redemption_id  uuid references redemptions(id),
  idempotency_key      text not null unique,
  created_at           timestamptz not null default now()
);
create index on redemptions (subscription_id, status);
create index on redemptions (merchant_id, business_day);
create index on redemptions (branch_id, created_at desc);

-- Database-level safety net for the default 1-per-day rule.
-- If you ever ship a plan allowing multiple redemptions per day, this index
-- must be replaced with a per-plan check in application code first.
create unique index redemptions_one_per_business_day
  on redemptions (subscription_id, business_day)
  where status = 'completed';

-- Block accidental mutation of the append-only table.
create or replace function forbid_redemption_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'redemptions is append-only; insert a voiding row instead';
end;
$$;

create trigger redemptions_no_update
  before update or delete on redemptions
  for each row execute function forbid_redemption_mutation();


-- ---------------------------------------------------------------------------
-- Ledger — append-only double entry. Unused in Phase 1 reporting, but every
-- redemption writes to it so the Phase 2 settlement engine has real history.
-- ---------------------------------------------------------------------------
create table ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  entry_group     uuid not null,          -- one group = one balanced transaction
  redemption_id   uuid references redemptions(id),
  subscription_id uuid references subscriptions(id),
  merchant_id     uuid references merchants(id),
  account         text not null
                  check (account in ('member_quota','merchant_payable','platform_revenue')),
  direction       text not null check (direction in ('debit','credit')),
  amount_halalas  integer not null check (amount_halalas >= 0),
  memo            text,
  created_at      timestamptz not null default now()
);
create index on ledger_entries (entry_group);
create index on ledger_entries (merchant_id, created_at);


-- ---------------------------------------------------------------------------
-- Audit log and OTP throttling
-- ---------------------------------------------------------------------------
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_type  text not null check (actor_type in ('staff','member','system')),
  actor_id    uuid,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index on audit_log (entity_type, entity_id);

create table otp_attempts (
  id           uuid primary key default gen_random_uuid(),
  phone_e164   text not null,
  code_hash    text not null,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  attempts     integer not null default 0,
  request_ip   inet,
  created_at   timestamptz not null default now()
);
create index on otp_attempts (phone_e164, created_at desc);


-- ---------------------------------------------------------------------------
-- Derived subscription state. ALWAYS read quota from here.
-- Never store a mutable quota_used column.
-- ---------------------------------------------------------------------------
create or replace view v_subscription_status as
select
  s.id                as subscription_id,
  s.member_id,
  s.merchant_id,
  s.plan_id,
  s.status,
  s.starts_at,
  s.ends_at,
  s.quota_total,
  coalesce(r.used, 0) as quota_used,
  case when s.quota_total is null then null
       else s.quota_total - coalesce(r.used, 0) end as quota_remaining,
  r.last_redeemed_at,
  (s.status = 'active'
    and now() between s.starts_at and s.ends_at
    and (s.quota_total is null or coalesce(r.used, 0) < s.quota_total)
  ) as is_redeemable
from subscriptions s
left join lateral (
  select sum(qty) as used, max(created_at) as last_redeemed_at
  from redemptions
  where subscription_id = s.id and status = 'completed'
) r on true;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- Enable on every table. Merchants must never read each other's rows.
-- ---------------------------------------------------------------------------
alter table merchants      enable row level security;
alter table branches       enable row level security;
alter table staff_users    enable row level security;
alter table plans          enable row level security;
alter table members        enable row level security;
alter table subscriptions  enable row level security;
alter table redemptions    enable row level security;
alter table ledger_entries enable row level security;
alter table audit_log      enable row level security;
alter table otp_attempts   enable row level security;

-- Which merchant does the current auth user work for?
create or replace function current_merchant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select merchant_id from staff_users
  where auth_user_id = auth.uid() and status = 'active'
  limit 1;
$$;

create policy staff_read_own_merchant on merchants
  for select using (id = current_merchant_id());

create policy staff_rw_own_branches on branches
  for all using (merchant_id = current_merchant_id())
  with check (merchant_id = current_merchant_id());

create policy staff_rw_own_plans on plans
  for all using (merchant_id = current_merchant_id())
  with check (merchant_id = current_merchant_id());

create policy staff_rw_own_subscriptions on subscriptions
  for all using (merchant_id = current_merchant_id())
  with check (merchant_id = current_merchant_id());

create policy staff_insert_own_redemptions on redemptions
  for insert with check (merchant_id = current_merchant_id());

create policy staff_read_own_redemptions on redemptions
  for select using (merchant_id = current_merchant_id());

-- Members read only their own record and their own subscriptions.
create policy member_read_self on members
  for select using (auth_user_id = auth.uid());

create policy member_read_own_subscriptions on subscriptions
  for select using (
    member_id in (select id from members where auth_user_id = auth.uid())
  );

-- Staff may look up a member ONLY via a server-side function, never by
-- selecting the members table directly. Enumerating phone numbers is a
-- PDPL problem. Implement lookup_member_for_redemption() in Slice 1.
