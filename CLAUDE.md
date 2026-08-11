# Project: Subscription backend for cafés and service merchants (KSA)

## What this is

A white-label subscription system merchants sell to their own customers.
A café sells "30 coffees for 199 SAR/month". We provide the plumbing: plans,
member signup, quota tracking, and a fast counter-side redemption screen.

Pilot: 10 independent cafés, Dammam–Khobar, Eastern Province, Saudi Arabia.

## The single most important constraint

**We never touch customer money.** The member pays the merchant directly
(cash, their card terminal, or the merchant's own payment link). We record
that a subscription was activated; we do not process, hold, or settle funds.
This keeps us outside SAMA payment-services regulation during Phase 1.

Never add code that collects payment into a platform account. If a task seems
to require it, stop and ask.

## Tech stack

- Next.js (App Router, TypeScript) — one app, three surfaces
- Supabase — Postgres, Auth (phone OTP), Row Level Security, Storage
- Vercel — hosting
- Tailwind CSS
- `passkit-generator` for Apple Wallet `.pkpass` files
- Unifonic (or Twilio fallback) for WhatsApp/SMS OTP

No native mobile app. No POS integration in Phase 1.

## The three surfaces

| Route | User | Device |
|---|---|---|
| `/m/*` | Member | Their own phone browser |
| `/pos/*` | Cashier | Cashier's phone or shop tablet |
| `/dashboard/*` | Merchant owner | Laptop |

`/pos/redeem` is the most important screen in the product. It must work in
under 5 seconds, one-handed, on a cracked Android phone, on bad café wifi,
by a barista who has never seen it before.

## Non-negotiable data rules

1. **`redemptions` is append-only.** Never UPDATE or DELETE a redemption.
   A void is a new row with `status='voided'` and `voids_redemption_id` set.
2. **Never store a mutable `quota_used` counter.** Derive it from
   `redemptions`. Use the `v_subscription_status` view.
3. **Every redemption needs an `idempotency_key`.** A double-tap on a laggy
   connection must not burn two cups.
4. **Money is always integer halalas.** 199 SAR = `19900`. Never floats,
   never `numeric` for currency.
5. **All business dates go through `business_day()`.** The café day runs
   04:00–04:00 Asia/Riyadh, not midnight. A 1:30am redemption belongs to the
   previous business day.
6. **`members.phone_e164` is the global identity.** One member record across
   all merchants — this is what makes Phase 2 (cross-merchant bundles)
   possible. Never scope members to a merchant.

## Security rules

- RLS on every table. A merchant must never read another merchant's rows.
- Supabase uses the new API key format. The publishable key
  (`sb_publishable_...`) goes in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and is
  safe in client code because RLS still gates every query. The secret key
  (`sb_secret_...`) bypasses RLS entirely — server-side only, never in a
  `NEXT_PUBLIC_*` variable, never in a client component, never committed.
- Apple `.p12` certificate lives in an env var as base64, never in the repo.
- Rate-limit OTP requests per phone and per IP.
- Log every redemption and every plan change to `audit_log`.

## Conventions

- Arabic and English UI. Arabic is the default; support RTL from day one.
- All user-facing strings in a locale file, never hardcoded in components.
- Times stored as `timestamptz`, displayed in Asia/Riyadh.
- Commit after every working feature. Small commits.

## How to work with me

I am not an experienced programmer. So:

- Explain what you're about to do in plain language before writing code.
- Prefer boring, well-documented approaches over clever ones.
- When something breaks, explain the cause in plain language before fixing.
- Write tests for anything touching quota, redemption, or the ledger.
- If a task is ambiguous, ask before building.

## Build order

Slices must be finished and tested in a real café before moving on.
See `BUILD-SPEC.md`. Current slice: **1 — cashier redemption screen**.

## Deferred to Phase 1b (do not build yet)

- Google Wallet passes
- Apple PassKit web service (live pass updates via APNs)
- Payment link integration and auto-renewal
- Foodics or any POS integration
- Multi-branch plan scoping

## Deferred to Phase 2 (do not build yet)

- Cross-merchant bundles, token pricing, merchant settlement runs
- Consumer-facing café discovery
- Anything that involves us holding funds
