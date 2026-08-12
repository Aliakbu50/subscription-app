import { describe, expect, it } from "vitest";
import {
  evaluateEligibility,
  type EligibilityInput,
  type SubscriptionForEligibility,
} from "@/lib/pos/eligibility";
import { eligibilityMessages } from "@/lib/i18n/eligibility";

const NOW = new Date("2026-08-12T09:00:00Z"); // 12:00 Riyadh, an ordinary lunchtime

const PLAN_RULES = {
  per_day_cap: 1,
  valid_from_hour: 6,
  valid_to_hour: 23,
  blackout_dates: [] as string[],
};

function subscription(
  overrides: Partial<SubscriptionForEligibility> = {},
): SubscriptionForEligibility {
  return {
    id: "sub-1",
    status: "active",
    startsAt: new Date("2026-08-02T09:00:00Z"),
    endsAt: new Date("2026-09-01T09:00:00Z"),
    quotaTotal: 22,
    rules: PLAN_RULES,
    ...overrides,
  };
}

function input(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    subscription: subscription(),
    quotaUsed: 5,
    completedOnBusinessDay: 0,
    now: NOW,
    ...overrides,
  };
}

describe("the happy path", () => {
  it("allows a member with quota left who has not come in today", () => {
    const result = evaluateEligibility(input());
    expect(result.eligible).toBe(true);
    expect(result.quotaRemaining).toBe(17);
  });

  it("allows an unlimited plan, which has no quota to exhaust", () => {
    const result = evaluateEligibility(
      input({
        subscription: subscription({ quotaTotal: null }),
        quotaUsed: 500,
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.quotaRemaining).toBeNull();
  });
});

// --- The cases BUILD-SPEC requires -----------------------------------------

describe("quota exhaustion", () => {
  it("refuses when every cup is gone", () => {
    const result = evaluateEligibility(input({ quotaUsed: 22 }));
    expect(result).toMatchObject({ eligible: false, code: "quota_exhausted" });
  });

  it("still allows the very last cup", () => {
    expect(evaluateEligibility(input({ quotaUsed: 21 })).eligible).toBe(true);
  });

  it("refuses if quota somehow went negative rather than allowing a free cup", () => {
    const result = evaluateEligibility(input({ quotaUsed: 25 }));
    expect(result).toMatchObject({ eligible: false, code: "quota_exhausted" });
  });
});

describe("second attempt on the same day", () => {
  it("refuses a member who already came in today", () => {
    const result = evaluateEligibility(input({ completedOnBusinessDay: 1 }));
    expect(result).toMatchObject({
      eligible: false,
      code: "already_redeemed_today",
    });
  });

  it("refuses even with plenty of quota left — this is the seeded Fahad case", () => {
    const result = evaluateEligibility(
      input({ quotaUsed: 1, completedOnBusinessDay: 1 }),
    );
    expect(result).toMatchObject({ eligible: false, code: "already_redeemed_today" });
    expect(result.quotaRemaining).toBe(21);
  });

  it("honours a plan that allows more than one per day", () => {
    const twoADay = subscription({
      rules: { ...PLAN_RULES, per_day_cap: 2 },
    });
    expect(
      evaluateEligibility(input({ subscription: twoADay, completedOnBusinessDay: 1 }))
        .eligible,
    ).toBe(true);
    expect(
      evaluateEligibility(input({ subscription: twoADay, completedOnBusinessDay: 2 }))
        .eligible,
    ).toBe(false);
  });
});

describe("expired subscription", () => {
  it("refuses once the end date has passed", () => {
    const result = evaluateEligibility(
      input({ subscription: subscription({ endsAt: new Date("2026-08-09T09:00:00Z") }) }),
    );
    expect(result).toMatchObject({ eligible: false, code: "subscription_ended" });
  });

  /**
   * The seeded Noura case. A subscription that lapsed three days ago still says
   * status = 'active' until something marks it expired. If this rule ever reads
   * status instead of dates, every lapsed member keeps drinking free.
   */
  it("refuses on dates even when status still says active", () => {
    const lapsed = subscription({
      status: "active",
      endsAt: new Date("2026-08-09T09:00:00Z"),
    });
    const result = evaluateEligibility(input({ subscription: lapsed }));
    expect(result).toMatchObject({ eligible: false, code: "subscription_ended" });
  });

  it("refuses before the start date", () => {
    const result = evaluateEligibility(
      input({ subscription: subscription({ startsAt: new Date("2026-08-20T09:00:00Z") }) }),
    );
    expect(result).toMatchObject({ eligible: false, code: "not_started" });
  });
});

describe("void, then redeem again", () => {
  /**
   * A void does not update the original row — it inserts a voiding row, and
   * quota_used stops counting the original. So from this function's point of
   * view a void simply means smaller numbers arriving. Both counters move.
   */
  it("becomes eligible again once the voided cup stops counting", () => {
    const afterRedeeming = evaluateEligibility(
      input({ quotaUsed: 22, completedOnBusinessDay: 1 }),
    );
    expect(afterRedeeming.eligible).toBe(false);

    const afterVoiding = evaluateEligibility(
      input({ quotaUsed: 21, completedOnBusinessDay: 0 }),
    );
    expect(afterVoiding.eligible).toBe(true);
    expect(afterVoiding.quotaRemaining).toBe(1);
  });
});

// --- Status, hours, blackouts ----------------------------------------------

describe("subscription status", () => {
  it("tells the cashier to activate a pending member rather than refusing them", () => {
    const result = evaluateEligibility(
      input({ subscription: subscription({ status: "pending" }) }),
    );
    expect(result).toMatchObject({ eligible: false, code: "pending_activation" });
  });

  it.each(["expired", "cancelled"] as const)("refuses a %s subscription", (status) => {
    const result = evaluateEligibility(
      input({ subscription: subscription({ status }) }),
    );
    expect(result).toMatchObject({ eligible: false, code: "not_active" });
  });
});

describe("time-of-day window", () => {
  const at = (riyadhHour: number) =>
    new Date(Date.UTC(2026, 7, 12, riyadhHour - 3, 0));

  it("refuses before opening", () => {
    const result = evaluateEligibility(input({ now: at(5) }));
    expect(result).toMatchObject({ eligible: false, code: "outside_valid_hours" });
  });

  it("allows exactly on the opening hour", () => {
    expect(evaluateEligibility(input({ now: at(6) })).eligible).toBe(true);
  });

  /** valid_to_hour is inclusive: 23 means through 23:59. Documented in eligibility.ts. */
  it("allows during the final permitted hour", () => {
    expect(evaluateEligibility(input({ now: at(23) })).eligible).toBe(true);
  });

  it("ignores the window when the plan does not set one", () => {
    const anyTime = subscription({ rules: { per_day_cap: 1 } });
    expect(
      evaluateEligibility(input({ subscription: anyTime, now: at(3) })).eligible,
    ).toBe(true);
  });
});

describe("blackout dates", () => {
  it("refuses on a blacked-out business day", () => {
    const blacked = subscription({
      rules: { ...PLAN_RULES, blackout_dates: ["2026-08-12"] },
    });
    const result = evaluateEligibility(input({ subscription: blacked }));
    expect(result).toMatchObject({ eligible: false, code: "blackout_date" });
  });

  /**
   * 01:30 on the 13th is still business day the 12th, so a blackout on the 12th
   * covers it. Checking the calendar date here instead would let a blacked-out
   * night reopen at midnight.
   */
  it("uses the business day, so a blackout covers the whole café night", () => {
    const blacked = subscription({
      rules: { ...PLAN_RULES, blackout_dates: ["2026-08-12"], valid_from_hour: undefined, valid_to_hour: undefined },
    });
    const lateNight = new Date(Date.UTC(2026, 7, 12, 22, 30)); // 01:30 Riyadh on the 13th
    const result = evaluateEligibility(input({ subscription: blacked, now: lateNight }));
    expect(result).toMatchObject({ eligible: false, code: "blackout_date" });
  });
});

// --- Ordering ---------------------------------------------------------------

describe("which reason the member hears when several rules fail at once", () => {
  it("says the subscription ended rather than that quota is gone", () => {
    const lapsedAndEmpty = subscription({ endsAt: new Date("2026-08-09T09:00:00Z") });
    const result = evaluateEligibility(
      input({ subscription: lapsedAndEmpty, quotaUsed: 22 }),
    );
    // Renewing fixes both, so that is the thing worth saying out loud.
    expect(result).toMatchObject({ eligible: false, code: "subscription_ended" });
  });

  it("says quota is gone rather than that they came in today", () => {
    const result = evaluateEligibility(
      input({ quotaUsed: 22, completedOnBusinessDay: 1 }),
    );
    expect(result).toMatchObject({ eligible: false, code: "quota_exhausted" });
  });
});

// --- Wording ----------------------------------------------------------------

describe("what the barista actually reads out", () => {
  it("gives a real sentence in both languages, never a code", () => {
    const result = evaluateEligibility(input({ completedOnBusinessDay: 1 }));
    if (result.eligible) throw new Error("expected a refusal");

    const message = eligibilityMessages(result.code, result.params);
    expect(message.en).toBe("Already used today — next cup tomorrow");
    expect(message.ar).toBe("تم الاستخدام اليوم — الكوب القادم غدًا");
  });

  it("names the number of cups when quota runs out", () => {
    const result = evaluateEligibility(input({ quotaUsed: 22 }));
    if (result.eligible) throw new Error("expected a refusal");
    expect(eligibilityMessages(result.code, result.params).en).toBe(
      "All 22 cups used — renew to continue",
    );
  });

  it("has non-empty Arabic and English for every refusal code", () => {
    const cases: Array<Partial<EligibilityInput>> = [
      { subscription: subscription({ status: "pending" }) },
      { subscription: subscription({ status: "cancelled" }) },
      { subscription: subscription({ startsAt: new Date("2026-08-20T09:00:00Z") }) },
      { subscription: subscription({ endsAt: new Date("2026-08-09T09:00:00Z") }) },
      { quotaUsed: 22 },
      { completedOnBusinessDay: 1 },
      { now: new Date(Date.UTC(2026, 7, 12, 2, 0)) },
      { subscription: subscription({ rules: { ...PLAN_RULES, blackout_dates: ["2026-08-12"] } }) },
    ];

    const seen = new Set<string>();
    for (const override of cases) {
      const result = evaluateEligibility(input(override));
      if (result.eligible) throw new Error("expected a refusal");
      const message = eligibilityMessages(result.code, result.params);
      expect(message.ar.length).toBeGreaterThan(0);
      expect(message.en.length).toBeGreaterThan(0);
      expect(message.en).not.toMatch(/undefined|NaN|\[object/);
      expect(message.ar).not.toMatch(/undefined|NaN|\[object/);
      seen.add(result.code);
    }
    expect(seen.size).toBe(8);
  });
});
