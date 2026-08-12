/**
 * Can this member take a coffee right now?
 *
 * This function does NO database work and reads NO clock. Everything it needs
 * is passed in. That is deliberate: it means every rule can be tested against
 * made-up data in milliseconds, including the awkward cases that are painful to
 * reproduce in a real café — a subscription that lapsed three days ago, a
 * member who already came in this morning, the 04:00 rollover.
 *
 * It returns a CODE, not a sentence. Turning the code into Arabic or English
 * belongs in the locale file (see src/lib/i18n/eligibility.ts). That split
 * keeps the rules independent of wording, and lets tests assert on meaning
 * instead of on a string somebody might reword later.
 *
 * IMPORTANT: this is the only authority on eligibility. Do NOT use
 * v_subscription_status.is_redeemable as an answer — the view knows about
 * status, dates and quota, but has no idea a plan allows only one cup per day.
 * A member who already came in today shows is_redeemable = true.
 */
import { businessDay, riyadhHour } from "@/lib/time/riyadh";

export type SubscriptionRules = {
  /** How many redemptions per business day. Almost always 1. */
  per_day_cap?: number;
  /** Earliest Riyadh hour the plan may be used, 0-23. */
  valid_from_hour?: number;
  /** Latest Riyadh hour the plan may be used, 0-23, INCLUSIVE — see below. */
  valid_to_hour?: number;
  /** Business days the plan is not valid, as 'YYYY-MM-DD'. */
  blackout_dates?: string[];
  /** Drinks this plan covers. Enforced by the confirm screen's item picker. */
  eligible_items?: string[];
};

export type SubscriptionForEligibility = {
  id: string;
  status: "pending" | "active" | "expired" | "cancelled";
  startsAt: Date | null;
  endsAt: Date | null;
  /** null means unlimited. */
  quotaTotal: number | null;
  /** Copied from the plan at activation — never read the live plan here. */
  rules: SubscriptionRules;
};

export type EligibilityInput = {
  subscription: SubscriptionForEligibility;
  /** Completed redemptions ever, from v_subscription_status.quota_used. */
  quotaUsed: number;
  /** Completed redemptions for THIS subscription on the current business day. */
  completedOnBusinessDay: number;
  now: Date;
};

export type IneligibleCode =
  | "pending_activation"
  | "not_active"
  | "not_started"
  | "subscription_ended"
  | "quota_exhausted"
  | "already_redeemed_today"
  | "outside_valid_hours"
  | "blackout_date";

export type EligibilityResult =
  | { eligible: true; quotaRemaining: number | null }
  | {
      eligible: false;
      code: IneligibleCode;
      /** Values the message needs, e.g. the date a subscription ended. */
      params: Record<string, string | number>;
      quotaRemaining: number | null;
    };

/**
 * Rules are evaluated in BUILD-SPEC's order and the FIRST failure wins.
 *
 * Order matters for what the cashier is told. A member who is both out of
 * quota and past their end date should hear "your subscription ended", because
 * that is the thing they can act on — renewing fixes both.
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const { subscription: sub, quotaUsed, completedOnBusinessDay, now } = input;

  const quotaRemaining =
    sub.quotaTotal === null ? null : sub.quotaTotal - quotaUsed;

  const fail = (
    code: IneligibleCode,
    params: Record<string, string | number> = {},
  ): EligibilityResult => ({ eligible: false, code, params, quotaRemaining });

  // 1. The subscription has to be active.
  //    'pending' is called out separately because it is not a refusal — it is
  //    an instruction. The member picked a plan and has not paid the café yet,
  //    and the cashier can fix that at the till.
  if (sub.status === "pending") return fail("pending_activation");
  if (sub.status !== "active") return fail("not_active", { status: sub.status });

  // 2. Now has to sit inside the subscription's dates.
  //    Checked BEFORE quota on purpose: a lapsed member is a renewal
  //    conversation, not a "you used all your cups" conversation.
  //
  //    Note this deliberately does not trust `status`. A subscription that
  //    ended yesterday still says 'active' until something marks it expired,
  //    so the dates are the real authority. (Seed member Noura is exactly this
  //    case, and exists to keep this branch honest.)
  if (sub.startsAt && now < sub.startsAt) {
    return fail("not_started", { startsAt: sub.startsAt.toISOString() });
  }
  if (sub.endsAt && now > sub.endsAt) {
    return fail("subscription_ended", { endsAt: sub.endsAt.toISOString() });
  }

  // 3. Quota. null quotaTotal means unlimited, so there is nothing to exhaust.
  if (quotaRemaining !== null && quotaRemaining <= 0) {
    return fail("quota_exhausted", { quotaTotal: sub.quotaTotal ?? 0 });
  }

  // 4. One per business day (or whatever the plan's cap says).
  //    THIS is the rule the database view cannot see, and the most common
  //    real refusal at a counter.
  const perDayCap = sub.rules.per_day_cap ?? 1;
  if (perDayCap > 0 && completedOnBusinessDay >= perDayCap) {
    return fail("already_redeemed_today", { perDayCap });
  }

  // 5. Time-of-day window, if the plan sets one.
  //    valid_to_hour is INCLUSIVE: 6..23 means 06:00 through 23:59, so a plan
  //    "valid 6am to 11pm" still works at 11:30pm. If a café wants a hard 11pm
  //    stop, valid_to_hour should be 22. Flagging this because it is a genuine
  //    judgement call, not an obvious truth.
  const { valid_from_hour: fromHour, valid_to_hour: toHour } = sub.rules;
  if (fromHour !== undefined || toHour !== undefined) {
    const hour = riyadhHour(now);
    const from = fromHour ?? 0;
    const to = toHour ?? 23;
    if (hour < from || hour > to) {
      return fail("outside_valid_hours", { from, to });
    }
  }

  // 6. Blackout days, compared against the BUSINESS day rather than the
  //    calendar date, so a blacked-out day covers the whole café night.
  const today = businessDay(now);
  if (sub.rules.blackout_dates?.includes(today)) {
    return fail("blackout_date", { date: today });
  }

  return { eligible: true, quotaRemaining };
}
