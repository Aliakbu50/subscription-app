import { describe, expect, it } from "vitest";
import {
  PHONE_FALLBACK_MONTHLY_CAP,
  resolveMember,
  type LookupRow,
} from "@/lib/pos/resolve";

const NOW = new Date("2026-08-12T09:00:00Z"); // 12:00 Riyadh

const RULES = {
  per_day_cap: 1,
  valid_from_hour: 6,
  valid_to_hour: 23,
  blackout_dates: [] as string[],
  eligible_items: ["americano", "latte"],
};

function row(overrides: Partial<LookupRow> = {}): LookupRow {
  return {
    member_id: "member-1",
    display_name: "Sara",
    member_ref: "abc123",
    subscription_id: "sub-1",
    plan_name: "Weekday Coffee",
    plan_name_ar: "قهوة أيام العمل",
    sub_status: "active",
    starts_at: "2026-08-02T09:00:00Z",
    ends_at: "2026-09-01T09:00:00Z",
    quota_total: 22,
    quota_used: 5,
    redeemed_today: 0,
    rules_snapshot: RULES,
    phone_lookups_this_month: 0,
    ...overrides,
  };
}

describe("resolveMember", () => {
  it("returns null for an unknown member rather than an empty shell", () => {
    expect(resolveMember([], { now: NOW, via: "qr" })).toBeNull();
  });

  it("resolves an eligible member with quota left", () => {
    const result = resolveMember([row()], { now: NOW, via: "qr" })!;
    expect(result.firstName).toBe("Sara");
    expect(result.subscriptions).toHaveLength(1);
    expect(result.subscriptions[0]).toMatchObject({
      eligible: true,
      quotaRemaining: 17,
      planName: "Weekday Coffee",
    });
    expect(result.subscriptions[0].reason).toBeUndefined();
  });

  it("carries the plan's eligible items through for the item picker", () => {
    const result = resolveMember([row()], { now: NOW, via: "qr" })!;
    expect(result.subscriptions[0].eligibleItems).toEqual(["americano", "latte"]);
  });

  it("gives an empty item list when the plan does not restrict items", () => {
    const noItems = row({ rules_snapshot: { per_day_cap: 1 } });
    const result = resolveMember([noItems], { now: NOW, via: "qr" })!;
    expect(result.subscriptions[0].eligibleItems).toEqual([]);
  });
});

describe("the name shown to the cashier", () => {
  it("shows only the first name — it is said out loud with a queue watching", () => {
    const full = row({ display_name: "سارة عبدالله محمد الدوسري" });
    expect(resolveMember([full], { now: NOW, via: "qr" })!.firstName).toBe("سارة");
  });

  it("copes with a member who has no name recorded", () => {
    const nameless = row({ display_name: null });
    expect(resolveMember([nameless], { now: NOW, via: "qr" })!.firstName).toBe("");
  });
});

describe("refusals carry a real sentence, not a code", () => {
  it("explains an already-used-today member in both languages", () => {
    const usedToday = row({ redeemed_today: 1 });
    const result = resolveMember([usedToday], { now: NOW, via: "qr" })!;
    const sub = result.subscriptions[0];

    expect(sub.eligible).toBe(false);
    expect(sub.reason?.code).toBe("already_redeemed_today");
    expect(sub.reason?.en).toBe("Already used today — next cup tomorrow");
    expect(sub.reason?.ar).toBe("تم الاستخدام اليوم — الكوب القادم غدًا");
  });

  it("still reports remaining quota on a refusal, so the screen can show it", () => {
    const usedToday = row({ redeemed_today: 1, quota_used: 1 });
    const sub = resolveMember([usedToday], { now: NOW, via: "qr" })!.subscriptions[0];
    expect(sub.quotaRemaining).toBe(21);
  });
});

describe("a member with more than one plan at the same café", () => {
  it("evaluates each subscription independently", () => {
    const good = row({ subscription_id: "sub-good" });
    const exhausted = row({
      subscription_id: "sub-empty",
      plan_name: "Light",
      quota_used: 22,
    });

    const result = resolveMember([good, exhausted], { now: NOW, via: "qr" })!;

    expect(result.subscriptions).toHaveLength(2);
    expect(result.subscriptions[0]).toMatchObject({ eligible: true });
    expect(result.subscriptions[1]).toMatchObject({
      eligible: false,
      reason: expect.objectContaining({ code: "quota_exhausted" }),
    });
  });
});

describe("phone-fallback cap", () => {
  it("allows phone lookup below the cap", () => {
    const under = row({ phone_lookups_this_month: PHONE_FALLBACK_MONTHLY_CAP - 1 });
    const sub = resolveMember([under], { now: NOW, via: "phone" })!.subscriptions[0];
    expect(sub.eligible).toBe(true);
  });

  it("refuses at the cap and asks for the QR", () => {
    const atCap = row({ phone_lookups_this_month: PHONE_FALLBACK_MONTHLY_CAP });
    const sub = resolveMember([atCap], { now: NOW, via: "phone" })!.subscriptions[0];
    expect(sub.eligible).toBe(false);
    expect(sub.reason?.code).toBe("phone_fallback_cap");
    expect(sub.reason?.en).toContain("scan the QR");
  });

  it("does NOT apply the cap when the member scanned their QR", () => {
    const atCap = row({ phone_lookups_this_month: 99 });
    const sub = resolveMember([atCap], { now: NOW, via: "qr" })!.subscriptions[0];
    expect(sub.eligible).toBe(true);
  });

  /**
   * Ordering matters for what the cashier says. Telling someone to fetch their
   * QR code, and only then discovering their subscription expired last week,
   * wastes everyone's time in front of a queue.
   */
  it("reports the real problem ahead of the cap when both apply", () => {
    const lapsedAndOverCap = row({
      ends_at: "2026-08-09T09:00:00Z",
      phone_lookups_this_month: 99,
    });
    const sub = resolveMember([lapsedAndOverCap], { now: NOW, via: "phone" })!
      .subscriptions[0];
    expect(sub.reason?.code).toBe("subscription_ended");
  });
});
