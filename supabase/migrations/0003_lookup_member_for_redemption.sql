-- Migration 0003 — lookup_member_for_redemption()
--
-- WHY A DATABASE FUNCTION RATHER THAN A QUERY
-- RLS on `members` allows exactly one thing: a member reading their own row.
-- Staff cannot select from it at all, and that is correct — a cashier able to
-- query the members table can enumerate every phone number of every member of
-- every merchant on the platform. Under PDPL that is not a small mistake.
--
-- So the POS never touches `members`. It calls this function, which is
-- `security definer` (runs with the definer's rights, bypassing RLS) but hands
-- back ONLY the fields the confirm screen needs, ONLY for subscriptions at the
-- caller's own merchant, and writes an audit_log row for every single call.
--
-- The security of this design rests entirely on the checks at the top of the
-- function. Read them carefully before changing anything.

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
  -- 1. The caller must be active staff. auth.uid() comes from the request's
  --    JWT and cannot be spoofed by the client.
  select s.id, s.merchant_id
    into v_staff_id, v_merchant_id
    from staff_users s
   where s.auth_user_id = auth.uid()
     and s.status = 'active'
   limit 1;

  if v_merchant_id is null then
    raise exception 'caller is not active staff';
  end if;

  -- 2. Exactly one lookup key. Passing both, or neither, is a caller bug and
  --    must not silently return something arbitrary.
  if (p_member_ref is null) = (p_phone is null) then
    raise exception 'provide exactly one of member_ref or phone';
  end if;

  -- 3. Find the member. Note members are GLOBAL — not scoped to a merchant —
  --    so this can match someone who has never visited this café. That is why
  --    step 4 scopes subscriptions to the caller's merchant instead.
  select m.id into v_member_id
    from members m
   where (p_member_ref is not null and m.member_ref = p_member_ref)
      or (p_phone      is not null and m.phone_e164 = p_phone)
   limit 1;

  -- Unknown member: return nothing. Deliberately NOT an exception — "no such
  -- member" is an ordinary thing for a cashier to encounter, not an error.
  if v_member_id is null then
    return;
  end if;

  -- 4. Log every lookup before returning data. This is the record that makes
  --    the bypass auditable: who looked up whom, when, and by which method.
  insert into audit_log (actor_type, actor_id, action, entity_type, entity_id, payload)
  values (
    'staff', v_staff_id, 'member_lookup', 'member', v_member_id,
    jsonb_build_object(
      'by', case when p_member_ref is not null then 'qr' else 'phone' end,
      'merchant_id', v_merchant_id
    )
  );

  -- 5. Return the member with their subscriptions AT THIS MERCHANT ONLY.
  --    A cashier at one café must never see a member's subscription at another.
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
  -- Quota used: summed from redemptions, never a stored counter.
  left join lateral (
    select sum(r.qty)::integer as total
      from redemptions r
     where r.subscription_id = s.id
       and r.status = 'completed'
  ) used on true
  -- Redemptions on the CURRENT business day, which the 04:00 café boundary
  -- makes different from "today". This is the count the per-day cap uses, and
  -- the one v_subscription_status does not know about.
  left join lateral (
    select count(*)::integer as total
      from redemptions r
     where r.subscription_id = s.id
       and r.status = 'completed'
       and r.business_day = business_day(now())
  ) today on true
  -- Phone-fallback usage this Riyadh calendar month, for the 3-per-month cap.
  -- Counted per MEMBER, not per subscription: the cap is about the member
  -- turning up without their QR, whichever plan they are on.
  left join lateral (
    select count(*)::integer as total
      from redemptions r
     where r.member_id = m.id
       and r.status = 'completed'
       and r.source = 'phone'
       and to_char(r.created_at at time zone 'Asia/Riyadh', 'YYYY-MM')
         = to_char(now()          at time zone 'Asia/Riyadh', 'YYYY-MM')
  ) fallback on true
  where m.id = v_member_id;
end;
$$;

-- Only signed-in users may call it, and the function itself then insists on
-- active staff. Revoking from public/anon matters: without it, anyone holding
-- the publishable key could call a function that bypasses RLS.
revoke execute on function lookup_member_for_redemption(text, text) from public, anon;
grant  execute on function lookup_member_for_redemption(text, text) to authenticated;
