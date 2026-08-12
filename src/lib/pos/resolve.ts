/**
 * Turning rows from lookup_member_for_redemption() into what the confirm
 * screen shows.
 *
 * Kept free of database and network calls so the interesting cases — a member
 * with two plans, one eligible and one not; a member over the phone-fallback
 * cap — can be tested against plain objects.
 */
import {
  evaluateEligibility,
  type SubscriptionRules,
} from "@/lib/pos/eligibility";
import { eligibilityMessages } from "@/lib/i18n/eligibility";

/** One row as returned by the database function. Snake case, straight from SQL. */
export type LookupRow = {
  member_id: string;
  display_name: string | null;
  member_ref: string;
  subscription_id: string;
  plan_name: string;
  plan_name_ar: string | null;
  sub_status: "pending" | "active" | "expired" | "cancelled";
  starts_at: string | null;
  ends_at: string | null;
  quota_total: number | null;
  quota_used: number;
  redeemed_today: number;
  rules_snapshot: SubscriptionRules | null;
  phone_lookups_this_month: number;
};

export type ResolvedSubscription = {
  subscriptionId: string;
  planName: string;
  planNameAr: string | null;
  quotaTotal: number | null;
  quotaRemaining: number | null;
  eligible: boolean;
  /** Absent when eligible. Always a real sentence, never a code, when not. */
  reason?: { code: string; ar: string; en: string };
  /** Drinks this plan covers. Empty means the plan does not restrict items. */
  eligibleItems: string[];
};

export type ResolvedMember = {
  memberId: string;
  memberRef: string;
  /** First name only — enough for a cashier to say it out loud. */
  firstName: string;
  subscriptions: ResolvedSubscription[];
};

/**
 * BUILD-SPEC caps phone-fallback redemptions at 3 per member per calendar
 * month, after which the member must produce their QR. The point is to stop
 * the fallback quietly becoming the main path — it is the route with the
 * weakest identity check.
 */
export const PHONE_FALLBACK_MONTHLY_CAP = 3;

/**
 * The cashier says the name out loud to confirm they have the right person.
 * "سارة" is easier to say than "سارة عبدالله محمد الدوسري", and showing less
 * is also the more private choice with a queue watching.
 */
function firstNameOf(displayName: string | null): string {
  if (!displayName) return "";
  return displayName.trim().split(/\s+/)[0] ?? "";
}

export function resolveMember(
  rows: LookupRow[],
  options: { now: Date; via: "qr" | "phone" },
): ResolvedMember | null {
  if (rows.length === 0) return null;

  const first = rows[0];

  // Over the fallback cap, every subscription is refused regardless of quota.
  // Checked here rather than inside evaluateEligibility because it is a
  // property of HOW the member was identified, not of their subscription.
  const overPhoneCap =
    options.via === "phone" &&
    first.phone_lookups_this_month >= PHONE_FALLBACK_MONTHLY_CAP;

  const subscriptions = rows.map((row): ResolvedSubscription => {
    const rules = row.rules_snapshot ?? {};
    const eligibleItems = rules.eligible_items ?? [];

    const verdict = evaluateEligibility({
      subscription: {
        id: row.subscription_id,
        status: row.sub_status,
        startsAt: row.starts_at ? new Date(row.starts_at) : null,
        endsAt: row.ends_at ? new Date(row.ends_at) : null,
        quotaTotal: row.quota_total,
        rules,
      },
      quotaUsed: row.quota_used,
      completedOnBusinessDay: row.redeemed_today,
      now: options.now,
    });

    const base = {
      subscriptionId: row.subscription_id,
      planName: row.plan_name,
      planNameAr: row.plan_name_ar,
      quotaTotal: row.quota_total,
      quotaRemaining: verdict.quotaRemaining,
      eligibleItems,
    };

    // The cap overrides an otherwise-eligible subscription. It does NOT
    // override a more fundamental refusal: telling someone to fetch their QR
    // when their subscription expired last week wastes everybody's time.
    if (!verdict.eligible) {
      return {
        ...base,
        eligible: false,
        reason: {
          code: verdict.code,
          ...eligibilityMessages(verdict.code, verdict.params),
        },
      };
    }

    if (overPhoneCap) {
      return {
        ...base,
        eligible: false,
        reason: {
          code: "phone_fallback_cap",
          ar: `تم استخدام البحث بالجوال ${PHONE_FALLBACK_MONTHLY_CAP} مرات هذا الشهر — يلزم مسح الرمز`,
          en: `Phone lookup used ${PHONE_FALLBACK_MONTHLY_CAP} times this month — please scan the QR`,
        },
      };
    }

    return { ...base, eligible: true };
  });

  return {
    memberId: first.member_id,
    memberRef: first.member_ref,
    firstName: firstNameOf(first.display_name),
    subscriptions,
  };
}
