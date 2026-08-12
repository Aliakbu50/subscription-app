/**
 * Arabic and English wording for every eligibility refusal.
 *
 * These are read ALOUD by a barista to a customer standing at a counter. So:
 *   - never an error code, never a rule number
 *   - say what happens next, not what went wrong
 *   - short enough to fit on a phone at large type
 *
 * "Already used today — next cup tomorrow" tells the member something.
 * "RULE_VIOLATION_4" tells them their café bought bad software.
 */
import type { IneligibleCode } from "@/lib/pos/eligibility";
import type { Locale } from "@/lib/i18n/strings";

type Params = Record<string, string | number>;

/** '2026-08-09' -> '9 Aug' / '٩ أغسطس'. Short, because it sits in a big red card. */
function shortDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(
    locale === "ar" ? "ar-SA" : "en-GB",
    { day: "numeric", month: "short", timeZone: "Asia/Riyadh" },
  );
}

/** 6 -> '6am', 23 -> '11pm'. Baristas do not read 24-hour time at speed. */
function hour12(hour: number, locale: Locale): string {
  if (locale === "ar") {
    if (hour === 0) return "١٢ ص";
    if (hour < 12) return `${hour} ص`;
    if (hour === 12) return "١٢ م";
    return `${hour - 12} م`;
  }
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

const messages: Record<
  IneligibleCode,
  Record<Locale, (p: Params) => string>
> = {
  // Not a refusal — an instruction. The member picked a plan and has not paid
  // the café yet, and the person reading this can fix it at the till.
  pending_activation: {
    ar: () => "لم يتم تفعيل الاشتراك بعد — استلم المبلغ ثم فعّل الاشتراك",
    en: () => "Not activated yet — take payment, then activate",
  },

  not_active: {
    ar: () => "هذا الاشتراك غير فعّال",
    en: () => "This subscription is not active",
  },

  not_started: {
    ar: (p) => `يبدأ الاشتراك في ${shortDate(String(p.startsAt), "ar")}`,
    en: (p) => `Subscription starts ${shortDate(String(p.startsAt), "en")}`,
  },

  subscription_ended: {
    ar: (p) => `انتهى الاشتراك في ${shortDate(String(p.endsAt), "ar")} — يلزم التجديد`,
    en: (p) => `Subscription ended ${shortDate(String(p.endsAt), "en")} — renew to continue`,
  },

  quota_exhausted: {
    ar: (p) => `تم استخدام جميع الأكواب (${p.quotaTotal}) — يلزم التجديد`,
    en: (p) => `All ${p.quotaTotal} cups used — renew to continue`,
  },

  // The most common real refusal at a counter. It must not sound like an
  // accusation, and it must tell the member when to come back.
  already_redeemed_today: {
    ar: () => "تم الاستخدام اليوم — الكوب القادم غدًا",
    en: () => "Already used today — next cup tomorrow",
  },

  outside_valid_hours: {
    ar: (p) =>
      `هذا الاشتراك صالح من ${hour12(Number(p.from), "ar")} إلى ${hour12(Number(p.to), "ar")}`,
    en: (p) =>
      `This plan is valid ${hour12(Number(p.from), "en")} to ${hour12(Number(p.to), "en")}`,
  },

  blackout_date: {
    ar: () => "الاشتراك غير صالح اليوم",
    en: () => "Not valid today",
  },
};

/** Wording for one refusal in one language. */
export function eligibilityMessage(
  code: IneligibleCode,
  params: Params,
  locale: Locale,
): string {
  return messages[code][locale](params);
}

/**
 * Both languages at once. The redemption API returns this so the screen can
 * show the member's own language without a second round trip, and so the
 * reason is readable in audit_log months later regardless of who is reading.
 */
export function eligibilityMessages(
  code: IneligibleCode,
  params: Params,
): { ar: string; en: string } {
  return {
    ar: eligibilityMessage(code, params, "ar"),
    en: eligibilityMessage(code, params, "en"),
  };
}
