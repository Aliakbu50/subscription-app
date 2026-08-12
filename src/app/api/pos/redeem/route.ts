/**
 * POST /api/pos/redeem
 *
 * Writes the redemption. The one endpoint in the slice that costs a café money
 * if it is wrong.
 *
 * Body: { memberRef | phone, subscriptionId, itemLabel, idempotencyKey,
 *         clientCreatedAt }
 *
 * WHERE THE TRUTH LIVES
 * Eligibility is re-evaluated here from scratch. The resolve result the client
 * saw is a display hint: it may be minutes stale, and it arrived over a network
 * the client controls.
 *
 * But the final authority is the DATABASE, not this check. Between evaluating
 * and inserting there is always a gap, and on a laggy café connection two taps
 * can land inside it. `redemptions_one_per_business_day` and the unique
 * `idempotency_key` close that gap. This code's job is to turn those constraint
 * violations into a sentence a barista can read, never a 500.
 */
import { NextResponse } from "next/server";
import { getStaffContext } from "@/lib/pos/session";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeSaudiPhone } from "@/lib/pos/phone";
import { resolveMember, type LookupRow } from "@/lib/pos/resolve";
import {
  isItemAllowed,
  isValidIdempotencyKey,
  resolveRedemptionTime,
} from "@/lib/pos/redeem";
import { businessDay } from "@/lib/time/riyadh";

/** Postgres unique-violation. Both of our safety nets surface as this. */
const UNIQUE_VIOLATION = "23505";

export async function POST(request: Request) {
  const staff = await getStaffContext();
  if (!staff) {
    return NextResponse.json({ error: "not_staff" }, { status: 401 });
  }
  if (!staff.branchId) {
    // Redemptions require a branch and we will not guess one. A staff member
    // covering all branches needs a branch picker, which is Phase 1b.
    return NextResponse.json({ error: "no_branch_assigned" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const memberRef = typeof body.memberRef === "string" ? body.memberRef.trim() : "";
  const rawPhone = typeof body.phone === "string" ? body.phone : "";
  const subscriptionId =
    typeof body.subscriptionId === "string" ? body.subscriptionId : "";
  const itemLabel = typeof body.itemLabel === "string" ? body.itemLabel : null;

  if (!isValidIdempotencyKey(body.idempotencyKey)) {
    return NextResponse.json({ error: "invalid_idempotency_key" }, { status: 400 });
  }
  const idempotencyKey = body.idempotencyKey;

  if (!subscriptionId) {
    return NextResponse.json({ error: "subscription_id_required" }, { status: 400 });
  }
  if (!memberRef && !rawPhone) {
    return NextResponse.json({ error: "member_ref_or_phone_required" }, { status: 400 });
  }

  const now = new Date();
  const when = resolveRedemptionTime(body.clientCreatedAt, now);
  if (!when.ok) {
    return NextResponse.json(
      { error: "invalid_timestamp", detail: when.reason },
      { status: 400 },
    );
  }
  const happenedAt = when.at;

  const supabase = await createServerClient();

  // ---------------------------------------------------------------------
  // Idempotent replay.
  //
  // Checked BEFORE doing any work. A double-tap, a retried offline sync, or a
  // client that never saw our first response must all get the same answer:
  // success, with the redemption that already exists. Returning an error here
  // would tell a barista the cup failed when it did not.
  // ---------------------------------------------------------------------
  const { data: existing } = await supabase
    .from("redemptions")
    .select("id, business_day, subscription_id, item_label, created_at")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { redemption: existing, replayed: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ---------------------------------------------------------------------
  // Re-resolve and re-evaluate. Never trust the verdict the client was shown.
  // ---------------------------------------------------------------------
  let phone: string | null = null;
  if (rawPhone) {
    phone = normalizeSaudiPhone(rawPhone);
    if (!phone) {
      return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
    }
  }

  const { data: rows, error: lookupError } = await supabase.rpc(
    "lookup_member_for_redemption",
    { p_member_ref: memberRef || null, p_phone: phone },
  );

  if (lookupError) {
    console.error("redeem: lookup failed", lookupError.message);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  // Evaluated as of when the cup was actually handed over, not now. For a
  // queued offline redemption those differ, and the plan's time-of-day rules
  // should be judged against the moment it happened.
  const member = resolveMember((rows ?? []) as LookupRow[], {
    now: happenedAt,
    via: memberRef ? "qr" : "phone",
  });

  if (!member) {
    return NextResponse.json({ error: "member_not_found" }, { status: 404 });
  }

  const subscription = member.subscriptions.find(
    (s) => s.subscriptionId === subscriptionId,
  );
  if (!subscription) {
    // The subscription is not this member's, or not at this merchant. Either
    // way the client sent something it should not have.
    return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });
  }

  if (!subscription.eligible) {
    return NextResponse.json(
      { error: "not_eligible", reason: subscription.reason },
      { status: 409 },
    );
  }

  if (!isItemAllowed(itemLabel, subscription.eligibleItems)) {
    return NextResponse.json(
      { error: "item_not_allowed", eligibleItems: subscription.eligibleItems },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------
  // Write it.
  //
  // business_day comes from when it HAPPENED. branch and staff come from the
  // session, never from the client.
  // ---------------------------------------------------------------------
  const { data: inserted, error: insertError } = await supabase
    .from("redemptions")
    .insert({
      subscription_id: subscriptionId,
      member_id: member.memberId,
      merchant_id: staff.merchantId,
      branch_id: staff.branchId,
      staff_user_id: staff.staffUserId,
      business_day: businessDay(happenedAt),
      item_label: itemLabel,
      qty: 1,
      source: memberRef ? "qr" : "phone",
      status: "completed",
      idempotency_key: idempotencyKey,
      created_at: happenedAt.toISOString(),
    })
    .select("id, business_day, subscription_id, item_label, created_at")
    .single();

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      // Two taps raced. Which constraint fired tells us which answer is true.
      if (insertError.message.includes("idempotency_key")) {
        const { data: raced } = await supabase
          .from("redemptions")
          .select("id, business_day, subscription_id, item_label, created_at")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();

        if (raced) {
          return NextResponse.json(
            { redemption: raced, replayed: true },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
      }

      // The one-per-business-day index. The member got their cup a moment ago
      // on another device, or a queued redemption already covers this day.
      return NextResponse.json(
        {
          error: "not_eligible",
          reason: {
            code: "already_redeemed_today",
            ar: "تم الاستخدام اليوم — الكوب القادم غدًا",
            en: "Already used today — next cup tomorrow",
          },
        },
        { status: 409 },
      );
    }

    console.error("redeem: insert failed", insertError.message);
    return NextResponse.json({ error: "redeem_failed" }, { status: 500 });
  }

  // Quota is derived from redemptions, so the remaining count is simply one
  // fewer than what we resolved a moment ago. Recomputing would cost a round
  // trip to tell us the same thing.
  const quotaRemaining =
    subscription.quotaRemaining === null ? null : subscription.quotaRemaining - 1;

  return NextResponse.json(
    {
      redemption: inserted,
      replayed: false,
      member: { firstName: member.firstName },
      quotaRemaining,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
