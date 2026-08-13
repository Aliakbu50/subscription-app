-- Migration 0004 — a void must actually give the cup back
--
-- THE BUG
-- `redemptions` is append-only, so voiding does not change the row it cancels;
-- it inserts a new row with status='voided' and voids_redemption_id set. The
-- original stays 'completed' forever, which is correct — it IS what happened.
--
-- But every quota calculation counted rows by `status = 'completed'`, which
-- therefore includes redemptions that were voided a minute later. The result:
-- a void recorded a row, showed up in history, and gave the member nothing
-- back. Quota stayed consumed and the day stayed used.
--
-- Found by testing on a real device: voiding a redemption and immediately
-- retrying the member still refused them as "already used today".
--
-- THE FIX
-- Everywhere quota is derived, exclude completed rows that some voiding row
-- points at. Two places have to agree: the view, and the POS lookup function.
--
-- Note this is NOT "delete the row" or "flip the status". The original record
-- is untouched. It simply stops counting, which is exactly what a void means.

-- Makes the "has this been voided?" lookup cheap. Without it every quota
-- calculation scans redemptions looking for voiding rows.
create index if not exists redemptions_voids_redemption_id_idx
  on redemptions (voids_redemption_id)
  where voids_redemption_id is not null;


-- ---------------------------------------------------------------------------
-- 1. The view. Same columns as before — only what counts as "used" changes.
-- ---------------------------------------------------------------------------
-- The lateral is aliased `agg` and the table inside it `red`. An earlier
-- version used `r` for both, which is ambiguous and did not apply cleanly.
create or replace view v_subscription_status as
select
  s.id                  as subscription_id,
  s.member_id,
  s.merchant_id,
  s.plan_id,
  s.status,
  s.starts_at,
  s.ends_at,
  s.quota_total,
  coalesce(agg.used, 0) as quota_used,
  case when s.quota_total is null then null
       else s.quota_total - coalesce(agg.used, 0) end as quota_remaining,
  agg.last_redeemed_at,
  (s.status = 'active'
    and now() between s.starts_at and s.ends_at
    and (s.quota_total is null or coalesce(agg.used, 0) < s.quota_total)
  ) as is_redeemable
from subscriptions s
left join lateral (
  select sum(red.qty) as used, max(red.created_at) as last_redeemed_at
    from redemptions red
   where red.subscription_id = s.id
     and red.status = 'completed'
     and not exists (
       select 1 from redemptions v
        where v.voids_redemption_id = red.id
          and v.status = 'voided'
     )
) agg on true;


-- ---------------------------------------------------------------------------
-- 2. The POS lookup function. Same signature and columns; the three counts it
--    derives now all ignore voided redemptions.
-- ---------------------------------------------------------------------------
create or replace function lookup_member_for_redemption(
  p_member_ref text default null,
  p_phone      text default null
)
returns table (
  member_id                 uuid,
  display_name              text,
  member_ref                text,
  subscription_id           uuid,
  plan_name                 text,
  plan_name_ar              text,
  sub_status                text,
  starts_at                 timestamptz,
  ends_at                   timestamptz,
  quota_total               integer,
  quota_used                integer,
  redeemed_today            integer,
  rules_snapshot            jsonb,
  phone_lookups_this_month  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id    uuid;
  v_merchant_id uuid;
  v_member_id   uuid;
begin
  -- The caller must be active staff. auth.uid() comes from the request's JWT
  -- and cannot be spoofed by the client.
  select s.id, s.merchant_id
    into v_staff_id, v_merchant_id
    from staff_users s
   where s.auth_user_id = auth.uid()
     and s.status = 'active'
   limit 1;

  if v_merchant_id is null then
    raise exception 'caller is not active staff';
  end if;

  if (p_member_ref is null) = (p_phone is null) then
    raise exception 'provide exactly one of member_ref or phone';
  end if;

  select m.id into v_member_id
    from members m
   where (p_member_ref is not null and m.member_ref = p_member_ref)
      or (p_phone      is not null and m.phone_e164 = p_phone)
   limit 1;

  if v_member_id is null then
    return;
  end if;

  insert into audit_log (actor_type, actor_id, action, entity_type, entity_id, payload)
  values (
    'staff', v_staff_id, 'member_lookup', 'member', v_member_id,
    jsonb_build_object(
      'by', case when p_member_ref is not null then 'qr' else 'phone' end,
      'merchant_id', v_merchant_id
    )
  );

  return query
  select
    m.id,
    m.display_name,
    m.member_ref,
    s.id,
    p.name,
    p.name_ar,
    s.status,
    s.starts_at,
    s.ends_at,
    s.quota_total,
    coalesce(used.total, 0)::integer,
    coalesce(today.total, 0)::integer,
    s.rules_snapshot,
    coalesce(fallback.total, 0)::integer
  from members m
  join subscriptions s
    on s.member_id = m.id
   and s.merchant_id = v_merchant_id        -- the tenant boundary
  join plans p
    on p.id = s.plan_id
  -- Quota used, ignoring anything since voided.
  left join lateral (
    select sum(r.qty)::integer as total
      from redemptions r
     where r.subscription_id = s.id
       and r.status = 'completed'
       and not exists (
         select 1 from redemptions v
          where v.voids_redemption_id = r.id and v.status = 'voided'
       )
  ) used on true
  -- Redemptions on the CURRENT business day, ignoring anything since voided.
  -- This is the count the one-per-day cap uses, and the reason a void has to
  -- give the day back: a cashier who voids a mistake must be able to redeem
  -- the member correctly a moment later.
  left join lateral (
    select count(*)::integer as total
      from redemptions r
     where r.subscription_id = s.id
       and r.status = 'completed'
       and r.business_day = business_day(now())
       and not exists (
         select 1 from redemptions v
          where v.voids_redemption_id = r.id and v.status = 'voided'
       )
  ) today on true
  -- Phone-fallback usage this Riyadh calendar month. A voided redemption did
  -- not happen, so it should not count toward the member's monthly allowance
  -- of turning up without their QR either.
  left join lateral (
    select count(*)::integer as total
      from redemptions r
     where r.member_id = m.id
       and r.status = 'completed'
       and r.source = 'phone'
       and not exists (
         select 1 from redemptions v
          where v.voids_redemption_id = r.id and v.status = 'voided'
       )
       and to_char(r.created_at at time zone 'Asia/Riyadh', 'YYYY-MM')
         = to_char(now()          at time zone 'Asia/Riyadh', 'YYYY-MM')
  ) fallback on true
  where m.id = v_member_id;
end;
$$;

revoke execute on function lookup_member_for_redemption(text, text) from public, anon;
grant  execute on function lookup_member_for_redemption(text, text) to authenticated;
