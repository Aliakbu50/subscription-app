/**
 * POST /api/pos/resolve
 *
 * The cashier has a member ref from a QR scan, or a phone number typed on the
 * keypad. This answers: who is this, what do they hold at THIS café, and may
 * they take a coffee right now.
 *
 * Body: { memberRef } or { phone }
 *
 * Note what is NOT in the body: branchId. It comes from the signed-in staff
 * record, server-side. A client-supplied branch id would let anyone aim a
 * redemption at another merchant's branch by editing a request.
 *
 * The answer here is for DISPLAY. /api/pos/redeem re-evaluates everything from
 * scratch — this response may be minutes stale by the time confirm is pressed,
 * and it arrives over a network the client controls.
 */
import { NextResponse } from "next/server";
import { getStaffContext } from "@/lib/pos/session";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeSaudiPhone } from "@/lib/pos/phone";
import { resolveMember, type LookupRow } from "@/lib/pos/resolve";

export async function POST(request: Request) {
  const staff = await getStaffContext();
  if (!staff) {
    return NextResponse.json({ error: "not_staff" }, { status: 401 });
  }

  let body: { memberRef?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const memberRef = typeof body.memberRef === "string" ? body.memberRef.trim() : "";
  const rawPhone = typeof body.phone === "string" ? body.phone : "";

  if (!memberRef && !rawPhone) {
    return NextResponse.json({ error: "member_ref_or_phone_required" }, { status: 400 });
  }
  if (memberRef && rawPhone) {
    return NextResponse.json({ error: "provide_only_one" }, { status: 400 });
  }

  let phone: string | null = null;
  if (rawPhone) {
    phone = normalizeSaudiPhone(rawPhone);
    if (!phone) {
      // A number that cannot be a Saudi mobile. Say so plainly rather than
      // reporting "member not found", which sends the cashier hunting for a
      // problem that is in front of them on the keypad.
      return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
    }
  }

  const supabase = await createServerClient();

  // Never selects from `members`. The function is the only way in, it checks
  // the caller is active staff, and it writes an audit_log row per call.
  const { data, error } = await supabase.rpc("lookup_member_for_redemption", {
    p_member_ref: memberRef || null,
    p_phone: phone,
  });

  if (error) {
    console.error("resolve: lookup failed", error.message);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  const member = resolveMember((data ?? []) as LookupRow[], {
    now: new Date(),
    via: memberRef ? "qr" : "phone",
  });

  if (!member) {
    return NextResponse.json({ error: "member_not_found" }, { status: 404 });
  }

  return NextResponse.json({ member }, {
    // A resolution is about one moment. Caching it, anywhere, would let a
    // member redeem twice from a stale eligible verdict.
    headers: { "Cache-Control": "no-store" },
  });
}
