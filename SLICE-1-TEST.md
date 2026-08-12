# Slice 1 — test script

Everything here needs a real phone. That is the point: the three things nobody
has verified — the camera, the offline queue, and voids — all behave
differently on a device than at a desk.

Roughly 20 minutes. Do it on `talahco.com`, signed in as `ali@lunartech.sa`.

---

## 0. Reset the data first

The seeded members have been used up by earlier testing, and "already redeemed
today" drifts as days pass. Re-run the seed so every case is fresh.

Open `supabase/seed.sql`, copy the whole file, run it in the Supabase SQL
Editor. **It will trip the "destructive operations" warning** — expected. It
deletes only its own fake merchant's rows, and it briefly disables the
append-only trigger to do so, which is the one place in the whole project that
is allowed to.

Then confirm the five states are back:

```sql
select m.display_name, v.quota_remaining, v.is_redeemable
  from v_subscription_status v
  join members m on m.id = v.member_id
 where v.merchant_id = 'a0000000-0000-0000-0000-000000000001'
 order by m.display_name;
```

Expect: Sara 17 true · Khalid 0 false · Noura 18 false · Fahad 21 true ·
Abdullah null false.

---

## 1. Make a QR code — nothing generates one yet

`/m/card` is Slice 2, so no member can show you a code. Get Sara's ref:

```sql
select display_name, member_ref from members where phone_e164 = '+966500000001';
```

Put that string into any QR generator and display it on a laptop screen. The
scanner also accepts `https://talahco.com/m/<ref>`, which is the shape Slice 2
will actually use — worth generating both.

---

## 2. Camera

| Do | Expect |
|---|---|
| `/pos` → مسح الرمز | Camera opens straight away. No intermediate screen. |
| First ever visit | One permission prompt. **Allow.** |
| Point at Sara's QR | Jumps to the confirm screen within a second or two |
| Go back, scan again | **No second permission prompt** |
| Scan any other QR (a wifi code, a poster) | "هذا ليس رمز اشتراك" and it keeps scanning |
| Deny the permission (reset in browser settings) | Message plus a button to phone lookup — never a dead end |

**The one that matters most:** hand the unlocked phone to someone who has never
seen the app and say "redeem this customer's coffee". BUILD-SPEC's bar is 60
seconds unaided. If they hesitate, note exactly where — that hesitation is the
finding, not a failure.

---

## 3. A real redemption

| Do | Expect |
|---|---|
| Scan Sara → confirm screen | Her name large, plan, **17 أكواب متبقية**, four drink buttons |
| Pick a drink → تأكيد | Green screen, **16 أكواب متبقية**, returns on its own after 3s |
| `/pos` | Counter went up by one |

**Time it from tapping مسح الرمز to the green screen.** BUILD-SPEC's bar is
under 5 seconds on 4G. Write down what you actually get.

---

## 4. Double-tap — the money one

On the confirm screen, **tap تأكيد twice, fast.**

- One green screen
- `/pos` counter goes up by **exactly one**

Check the database:

```sql
select count(*) from redemptions
 where member_id = 'd0000000-0000-0000-0000-000000000001'
   and business_day = business_day(now())
   and status = 'completed';
```

Must be **1**. If it is 2, stop and tell me — that is quota leaking, and every
café in the pilot loses money on it.

---

## 5. Refusals

Use phone lookup (faster than making four more QR codes).

| Number | Who | Expect |
|---|---|---|
| 0500000004 | Fahad | Red — already used today. He has 21 cups left; only the daily cap stops him |
| 0500000002 | Khalid | Red — all 22 cups used |
| 0500000003 | Noura | Red — subscription ended. Note she still says `active` in the database |
| 0500000005 | Abdullah | Red — not activated, take payment |
| 0512345678 | nobody | "لا يوجد عميل بهذا الرقم" |

**Read each one out loud as if to a customer.** If any sentence would be
awkward or embarrassing to say across a counter, that is a bug worth fixing —
it is cheaper to reword now than after ten cafés have seen it.

---

## 6. Offline queue

The part nobody has run. Do it in this order.

| Do | Expect |
|---|---|
| Resolve Sara **while online** (scan or phone) | Confirm screen appears |
| Now turn on **airplane mode** | Header dot goes red |
| Tap تأكيد | **Amber** screen, "تم الحفظ — ستتم المزامنة". Never green. |
| Header | Amber, showing 1 waiting |
| Turn airplane mode **off** | Within ~30s the badge clears on its own |
| `/pos` | Counter has gone up |
| `/pos/history` | The redemption is there, no longer amber |

Then the failure case, which is what history exists for:

| Do | Expect |
|---|---|
| Resolve **Fahad** while online | Red card — he is not eligible, so you cannot even reach confirm |

That is correct: an ineligible member is refused before the queue is involved.
A queued rejection only happens when eligibility changes *while* an item is
waiting — hard to stage by hand, and the code path is unit-tested.

---

## 7. Voids

| Do | Expect |
|---|---|
| Redeem Sara | Green |
| `/pos/history` | Today's rows, newest first, with a **إلغاء** button and minutes remaining |
| Tap إلغاء | Row goes faded, marked **ملغاة** |
| `/pos` | Counter went **down** by one |
| Redeem Sara again | **Allowed** — the void gave the day back |

Confirm the original row was never touched:

```sql
select id, status, voids_redemption_id, created_at
  from redemptions
 where business_day = business_day(now())
 order by created_at;
```

You should see the original still `completed`, plus a **new** row with
`status='voided'` pointing at it. Two rows, not one edited row. If the original
changed, the append-only guarantee is broken and the ledger cannot be trusted.

---

## What to send back

- The scan-to-green **time** in seconds
- Anything the untrained person hesitated over
- Any refusal sentence that felt wrong to say out loud
- Whether the double-tap produced exactly one row
- Whether the queue drained on reconnect

Anything that fails, send what you saw. The database queries above are usually
enough to tell what happened.
