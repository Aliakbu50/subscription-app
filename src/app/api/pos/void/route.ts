/**
 * POST /api/pos/void
 *
 * Body: { redemptionId, idempotencyKey }
 *
 * A void NEVER touches the original row. `redemptions` is append-only and a
 * database trigger enforces it — this inserts a NEW row with status='voided'
 * and voids_redemption_id pointing at what it cancels.
 *
 * Quota comes back automatically because everything that counts quota counts
 * only status='completed'. Nothing has to be decremented, which means nothing
 * can be decremented twice.
 */
import { NextResponse } from "next/server";
import { getStaffContext } from "@/lib/pos/session";
import { createServerClient } from "@/lib/supabase/server";
import { isValidIdempotencyKey } from "@/lib/pos/redeem";
import { canVoid } from "@/lib/pos/void";

const UNIQUE_VIOLATION = "23505";

export async function POST(request: Request) {
  const staff = await getStaffContext();
  if (!staff) {
    return NextResponse.json({ error: "not_staff" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const redemptionId = typeof body.redemptionId === "string" ? body.redemptionId : "";
  if (!redemptionId) {
    return NextResponse.json({ error: "redemption_id_required" }, { status: 400 });
  }
  if (!isValidIdempotencyKey(body.idempotencyKey)) {
    return NextResponse.json({ error: "invalid_idempotency_key" }, { status: 400 });
  }
  const idempotencyKey = body.idempotencyKey;

  const supabase = await createServerClient();

  // Idempotent: a double-tap on "void" must not insert two voiding rows.
  const { data: existingVoid } = await supabase
    .from("redemptions")
    .select("id, voids_redemption_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingVoid) {
    return NextResponse.json({ void: existingVoid, replayed: true });
  }

  // RLS scopes this to the cashier's own merchant, so a redemption belonging
  // to another café simply is not visible here.
  const { data: original, error: readError } = await supabase
    .from("redemptions")
    .select("id, subscription_id, member_id, branch_id, business_day, item_label, qty, source, status, voids_redemption_id, created_at")
    .eq("id", redemptionId)
    .maybeSingle();

  if (readError) {
    console.error("void: read failed", readError.message);
    return NextResponse.json({ error: "void_failed" }, { status: 500 });
  }
  if (!original) {
    return NextResponse.json({ error: "redemption_not_found" }, { status: 404 });
  }

  // Has something already voided it? Checked separately because the original
  // row cannot be updated to record that — it is append-only.
  const { data: priorVoid } = await supabase
    .from("redemptions")
    .select("id")
    .eq("voids_redemption_id", redemptionId)
    .maybeSingle();

  const check = canVoid(
    {
      createdAt: new Date(original.created_at),
      status: original.status,
      voidsRedemptionId: original.voids_redemption_id,
      voidedBy: priorVoid?.id ?? null,
    },
    new Date(),
  );

  if (!check.allowed) {
    return NextResponse.json({ error: "cannot_void", because: check.because }, { status: 409 });
  }

  // The voiding row carries the ORIGINAL's business_day so a day's rows net
  // out against each other in reporting, rather than a void landing on the
  // day it was noticed.
  const { data: inserted, error: insertError } = await supabase
    .from("redemptions")
    .insert({
      subscription_id: original.subscription_id,
      member_id: original.member_id,
      merchant_id: staff.merchantId,
      branch_id: original.branch_id,
      staff_user_id: staff.staffUserId,
      business_day: original.business_day,
      item_label: original.item_label,
      qty: original.qty,
      source: original.source,
      status: "voided",
      voids_redemption_id: original.id,
      idempotency_key: idempotencyKey,
    })
    .select("id, voids_redemption_id, created_at")
    .single();

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      const { data: raced } = await supabase
        .from("redemptions")
        .select("id, voids_redemption_id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (raced) return NextResponse.json({ void: raced, replayed: true });
    }
    console.error("void: insert failed", insertError.message);
    return NextResponse.json({ error: "void_failed" }, { status: 500 });
  }

  return NextResponse.json({ void: inserted, replayed: false });
}
