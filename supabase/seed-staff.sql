-- Link a Supabase Auth user to Lunar Cafe as staff.
--
-- Separate from seed.sql because it depends on an auth user that must be
-- created by hand in Supabase -> Authentication -> Users. Nothing automated
-- can create that account or set its password.
--
-- The insert looks the auth user up BY EMAIL rather than making you copy a
-- UUID around. If the email is wrong, it inserts nothing rather than inserting
-- something broken — check the row count.

insert into staff_users (merchant_id, branch_id, auth_user_id, display_name, role, status)
select
  'a0000000-0000-0000-0000-000000000001',   -- Lunar Cafe
  'b0000000-0000-0000-0000-000000000001',   -- Main Branch
  u.id,
  'Lunar Cafe',
  'owner',
  'active'
from auth.users u
where u.email = 'ali@lunartech.sa'
on conflict (auth_user_id) do nothing;

-- Check it worked. Expect exactly one row.
select s.display_name, s.role, s.status, m.name as merchant, b.name as branch
  from staff_users s
  join merchants m on m.id = s.merchant_id
  left join branches b on b.id = s.branch_id
 where s.merchant_id = 'a0000000-0000-0000-0000-000000000001';
