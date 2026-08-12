-- Migration 0001 — add members.member_ref
--
-- WHY THIS EXISTS
-- BUILD-SPEC.md has /api/pos/resolve accept a `memberRef`, and describes it as
-- the opaque 22-character id the member's QR code encodes. schema.sql never
-- created that column, so Slice 1 cannot be built without it.
--
-- The point is that the string printed on a card or shown in Apple Wallet is
-- MEANINGLESS on its own. It is not the primary key and not the phone number,
-- so a photographed QR reveals nothing about the person and gives no clue how
-- to guess anyone else's.
--
-- HOW THE ID IS BUILT
-- gen_random_uuid() gives 16 cryptographically random bytes. We strip its
-- dashes, read it back as raw bytes, base64 it, swap the two characters that
-- are awkward in URLs, and drop the padding. Result: 22 characters, 128 bits.
--
-- Deliberately built from gen_random_uuid(), which is BUILT INTO Postgres 13+.
-- An earlier version of this file used pgcrypto's gen_random_bytes() and failed
-- on Supabase, because Supabase installs extensions into the `extensions`
-- schema, which is not always on the search path. Nothing here needs an
-- extension, so nothing here can break that way.

begin;

alter table members
  add column if not exists member_ref text;

-- New members get a ref automatically from here on.
alter table members
  alter column member_ref
  set default rtrim(
    translate(
      encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
      '+/', '-_'),
    '=');

-- Backfill existing rows. A column default is not applied retroactively, and
-- every row needs its OWN value, so this cannot be one scalar update.
update members
   set member_ref = rtrim(
     translate(
       encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
       '+/', '-_'),
     '=')
 where member_ref is null;

alter table members
  alter column member_ref set not null;

-- Two members sharing a ref would let one redeem the other's quota.
create unique index if not exists members_member_ref_key
  on members (member_ref);

commit;

-- Sanity check — run separately. Should return 22.
--   select length(rtrim(translate(encode(decode(replace(gen_random_uuid()::text,'-',''),'hex'),'base64'),'+/','-_'),'='));
