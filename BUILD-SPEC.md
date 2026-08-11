# Phase 1 build spec

Read `CLAUDE.md` first. Apply `schema.sql` before Slice 1.

Build the slices in order. **Do not start a slice until the previous one has
been used by a real cashier in a real café during a real rush.** The point of
the ordering is that each slice can be tested against reality on its own.

---

## Slice 1 — Cashier redemption screen

The most important screen in the product. Build it first, against seeded fake
members, before signup or dashboards exist.

### Routes

| Route | Purpose |
|---|---|
| `/pos/login` | Staff sign-in (Supabase auth, email+password or magic link) |
| `/pos` | Big "Scan" button, today's redemption count, offline indicator |
| `/pos/scan` | Camera QR scanner |
| `/pos/lookup` | Phone-number fallback with numeric keypad |
| `/pos/confirm/[token]` | Member card, eligibility, one confirm button |
| `/pos/history` | Today's redemptions, with void action |

### Redemption flow

1. Cashier taps Scan. Camera opens immediately — no permission prompt on
   repeat visits, no intermediate screen.
2. QR decodes to a member ID. Client calls
   `POST /api/pos/resolve { memberRef, branchId }`.
3. Server returns: member first name, active subscriptions at this merchant,
   remaining quota, and for each one an `eligible: true|false` plus a
   `reason` string if false.
4. Screen shows a large member name, the plan, remaining count, and ONE
   green confirm button. Ineligible states show a large red card with a
   plain-language reason — never an error code.
5. Confirm calls `POST /api/pos/redeem` with a client-generated
   `idempotency_key` (uuid v4, generated once when the confirm screen mounts,
   reused on retry).
6. Success screen: green, member name, "22 cups left", auto-returns to `/pos`
   after 3 seconds.

### Eligibility rules — evaluate server-side, in this order

1. Subscription exists and `status='active'`
2. `now()` between `starts_at` and `ends_at`
3. `quota_remaining > 0`
4. No completed redemption for this subscription on the current
   `business_day()` (when `rules.per_day_cap = 1`)
5. Current Riyadh hour within `rules.valid_from_hour`/`valid_to_hour` if set
6. Current date not in `rules.blackout_dates`

Each failure returns a specific plain-language reason in Arabic and English.
"Already used today — next cup available tomorrow" not "RULE_VIOLATION_4".

### Phone-number fallback

- Numeric keypad, accepts `05XXXXXXXX` or `+9665XXXXXXXX`, normalise to E.164.
- Never expose the `members` table to the client. Implement a server-side
  `lookup_member_for_redemption(phone, branch_id)` that returns only the
  fields the confirm screen needs, and log every call to `audit_log`.
- Show the member's first name so the cashier can verbally confirm.
- Cap at 3 phone-fallback redemptions per member per calendar month, then
  require QR. Return a clear message when the cap is hit.
- Set `source='phone'` on the redemption.

### Offline behaviour

Café wifi will drop. This is not an edge case.

- Persistent connection indicator in the header: green / amber / red.
- When offline: queue the redemption in IndexedDB and show an amber
  "Saved — will sync" confirmation. Do NOT show a green success.
- Sync queued redemptions on reconnect. The `idempotency_key` makes replay
  safe.
- If a queued redemption is rejected on sync (quota exhausted, duplicate day),
  surface it in `/pos/history` as a flagged item the owner can review.
- Never fail silently. Never show a spinner with no timeout.

### Voids

- A cashier can void a redemption from `/pos/history` within 15 minutes.
- A void inserts a NEW redemption row with `status='voided'` and
  `voids_redemption_id` set. The original row is never touched.
- Voiding restores quota because `v_subscription_status` only counts
  `status='completed'`.

### Acceptance criteria

- Scan-to-confirmation in under 5 seconds on a mid-range Android over 4G.
- Whole flow usable one-handed.
- A barista who has never seen the app completes a redemption unaided within
  60 seconds of being handed the phone.
- Double-tapping confirm produces exactly one redemption row.
- Airplane mode mid-redemption produces a queued item, not a crash.
- Automated tests cover: quota exhaustion, second-attempt-same-day, expired
  subscription, idempotent replay, void-then-redeem-again.

---

## Slice 2 — Member onboarding and pass

### Routes

| Route | Purpose |
|---|---|
| `/j/[branchSlug]` | Landing page the counter QR points to |
| `/m/verify` | Phone entry + OTP |
| `/m/plans` | Plans available at this merchant |
| `/m/card` | The member's QR, remaining quota, expiry, history |
| `/api/pass/[subscriptionId]` | Serves the signed `.pkpass` |

### Flow

1. Member scans the counter tent card → `/j/[branchSlug]`.
2. Enters phone number → OTP via WhatsApp (Unifonic), SMS fallback.
3. Rate limit: 3 OTP requests per phone per 15 minutes, 5 per IP per hour.
   Hash codes in `otp_attempts`, 5-minute expiry, max 5 verify attempts.
4. Picks a plan. Subscription created with `status='pending'`.
5. Member pays the café directly, however that café takes money.
6. Cashier opens `/pos` → pending activations → taps activate. Sets
   `status='active'`, `starts_at=now()`, `ends_at=now()+period_days`,
   copies `quota_total` and `rules` from the plan into the subscription.
7. Member's `/m/card` goes live with their QR.

**Do not build payment collection.** Manual activation is deliberate for the
pilot: zero payment engineering, and we stay out of the money flow.

### The QR code

- Encodes a stable, opaque `member_ref` — a random 22-char id stored on the
  member record. Never the phone number, never a sequential id.
- It does not change. Quota is authoritative server-side, checked at
  redemption. This is what lets a static Wallet pass be correct forever.
- Sharing risk is bounded: 1 cup/day cap, cashier sees the member's name, and
  the member gets a WhatsApp notification on every redemption.

### Apple Wallet pass

Static pass, no PassKit web service in this slice.

- Style: `storeCard`. Barcode: `PKBarcodeFormatQR`, `messageEncoding: iso-8859-1`.
- Library: `passkit-generator`.
- Certificates: Pass Type ID cert (`.p12`) + Apple WWDR intermediate, both
  stored base64 in env vars (`APPLE_PASS_P12_BASE64`, `APPLE_PASS_P12_PASSWORD`,
  `APPLE_WWDR_BASE64`). Never commit them.
- Serve with `Content-Type: application/vnd.apple.pkpass`.
- Fields: merchant name, plan name, member name, expiry date. Back fields
  link to `/m/card` for live quota — the pass itself shows no live count.
- `locations`: the merchant's branch coordinates, max 10, radius 100m, with
  `relevantText` in Arabic. This surfaces the card on the lock screen when the
  member is near the café — a real redemption-frequency lever, and it is just
  JSON.
- Add-to-Wallet button appears only on iOS. Everyone else uses `/m/card` as a
  home-screen web app. `/m/card` is the source of truth for all platforms.

### Acceptance criteria

- Counter QR to working member card in under 60 seconds.
- Full Arabic RTL, correct on iOS Safari and Chrome Android.
- OTP rate limits verified by test.
- A generated `.pkpass` installs on a real iPhone and its QR scans correctly
  from `/pos/scan`.
- `/m/card` works with no app install on Android.

---

## Slice 3 — Merchant dashboard

| Route | Purpose |
|---|---|
| `/dashboard` | Active members, redemptions today, revenue this month |
| `/dashboard/plans` | Create and edit plans |
| `/dashboard/members` | Member list, subscription state, manual activation |
| `/dashboard/staff` | Add and disable cashier accounts |
| `/dashboard/settings` | Branch details, coordinates, counter QR download |

### Plan creation must be opinionated

Do not ship a blank price field. A café owner who prices 30 cups at 149 SAR
loses money and blames the platform.

- Offer 3 templates: Daily Coffee (30/month), Weekday Coffee (22/month),
  Light (12/month).
- Ask for the merchant's average cup price and marginal cost, then show a
  live margin calculator as they type: revenue per redemption at 100%, 70%,
  and 50% redemption, against their stated cost.
- Show a red warning if price ÷ quota falls below their stated marginal cost.
  Do not block it — warn clearly.

### Counter QR

Generate a printable A5 PDF with the branch QR, Arabic and English copy, and
the plan price. This is the merchant's acquisition tool — make it good.

### Acceptance criteria

- An owner creates a plan and gets a printable QR without help.
- The margin calculator matches hand-calculated numbers.
- RLS verified: authenticate as merchant A, attempt to read merchant B's
  members and redemptions, confirm zero rows.

---

## Slice 4 — Reports and ledger

- Redemptions by day, by branch, by hour-of-day.
- Cohort retention: of members who started in month N, how many renewed.
- Breakage: quota sold vs quota redeemed, per plan.
- Anomaly flags: redemption spikes, high phone-fallback usage, a single
  member redeeming across unusual hours.
- CSV export.
- Ledger view: every redemption writes a balanced `ledger_entries` group.
  Nothing depends on it in Phase 1, but it must be correct from day one so
  Phase 2 settlement has real history.

### Acceptance criteria

- Ledger balances: for every `entry_group`, sum of debits equals sum of
  credits. Enforce with a test that runs over all groups.
- Reports match hand-counted values from a seeded dataset.

---

## Before any real merchant goes live

1. Pay a senior developer for a few hours to review auth, RLS, and the OTP
   flow. You are storing phone numbers — PDPL applies.
2. Write a privacy notice in Arabic. Get explicit consent for cross-merchant
   marketing separately from service messages.
3. Load test `/pos/redeem` at 30 requests/second.
4. Have a paper fallback: if the system is down, the cashier writes the phone
   number on a slip and it gets entered later via a manual redemption with
   `source='manual'`.
5. Confirm with an accountant how VAT applies to prepaid subscriptions before
   printing any pricing.

---

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=                  # Settings -> API, "Project URL"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=      # sb_publishable_... safe in client
SUPABASE_SECRET_KEY=                       # sb_secret_... SERVER ONLY, bypasses RLS
UNIFONIC_APP_SID=
UNIFONIC_SENDER_ID=
APPLE_PASS_TYPE_ID=               # pass.com.yourcompany.membership
APPLE_TEAM_ID=
APPLE_PASS_P12_BASE64=
APPLE_PASS_P12_PASSWORD=
APPLE_WWDR_BASE64=
```

---

## First prompt to open Slice 1

> Read CLAUDE.md and BUILD-SPEC.md. We are starting Slice 1. Before writing
> any code, ask me clarifying questions about the redemption screen, then
> propose a plan covering routes, API endpoints, and the eligibility function.
> Do not write code until I approve the plan.
