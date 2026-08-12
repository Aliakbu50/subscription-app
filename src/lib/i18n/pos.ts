/**
 * Every word the cashier sees. Arabic first — it is the default.
 *
 * These are read at a counter, one-handed, by someone who has never been
 * trained on the app. Short, concrete, no jargon.
 */
import type { Locale } from "@/lib/i18n/strings";

export const pos = {
  ar: {
    signIn: "تسجيل الدخول",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    signInFailed: "البريد الإلكتروني أو كلمة المرور غير صحيحة",
    signingIn: "جارٍ تسجيل الدخول…",
    signOut: "تسجيل الخروج",

    scan: "مسح الرمز",
    lookupByPhone: "البحث برقم الجوال",
    redemptionsToday: "عمليات اليوم",

    online: "متصل",
    syncing: "جارٍ المزامنة",
    offline: "غير متصل",
    queued: (n: number) => `${n} في الانتظار`,

    noStaffRecord:
      "هذا الحساب غير مرتبط بأي متجر. تواصل مع المسؤول.",

    // Phone lookup
    enterPhone: "رقم جوال العميل",
    find: "بحث",
    searching: "جارٍ البحث…",
    invalidPhone: "رقم غير صحيح",
    memberNotFound: "لا يوجد عميل بهذا الرقم",
    clear: "مسح",

    // Confirm
    chooseItem: "اختر المشروب",
    confirm: "تأكيد",
    confirming: "جارٍ التأكيد…",
    cupsLeft: (n: number) => `${n} أكواب متبقية`,
    unlimited: "غير محدود",
    sessionExpired: "انتهت الجلسة — ابدأ من جديد",
    redeemFailed: "تعذّر إتمام العملية — حاول مرة أخرى",
    back: "رجوع",

    // Success
    done: "تم",
  },
  en: {
    signIn: "Sign in",
    email: "Email",
    password: "Password",
    signInFailed: "Email or password is incorrect",
    signingIn: "Signing in…",
    signOut: "Sign out",

    scan: "Scan",
    lookupByPhone: "Find by phone",
    redemptionsToday: "Today",

    online: "Online",
    syncing: "Syncing",
    offline: "Offline",
    queued: (n: number) => `${n} waiting`,

    noStaffRecord:
      "This account is not linked to a merchant. Contact your administrator.",

    // Phone lookup
    enterPhone: "Customer's mobile number",
    find: "Find",
    searching: "Searching…",
    invalidPhone: "Not a valid number",
    memberNotFound: "No member with that number",
    clear: "Clear",

    // Confirm
    chooseItem: "Choose drink",
    confirm: "Confirm",
    confirming: "Confirming…",
    cupsLeft: (n: number) => `${n} cups left`,
    unlimited: "Unlimited",
    sessionExpired: "Session expired — start again",
    redeemFailed: "Could not complete — try again",
    back: "Back",

    // Success
    done: "Done",
  },
} as const;

/**
 * Drink names for the item picker.
 *
 * The plan stores English keys ("americano") because that is what reporting
 * and rules match on. This is only how they are LABELLED on the button, and it
 * falls back to the raw key so a café adding "spanish latte" gets a working
 * button immediately rather than a blank one.
 */
const ITEM_LABELS: Record<string, { ar: string; en: string }> = {
  americano: { ar: "أمريكانو", en: "Americano" },
  latte: { ar: "لاتيه", en: "Latte" },
  cappuccino: { ar: "كابتشينو", en: "Cappuccino" },
  drip: { ar: "قهوة مقطرة", en: "Drip" },
  espresso: { ar: "إسبريسو", en: "Espresso" },
  tea: { ar: "شاي", en: "Tea" },
};

export function itemLabel(key: string, locale: Locale): string {
  return ITEM_LABELS[key]?.[locale] ?? key;
}

export function posStrings(locale: Locale) {
  return pos[locale];
}
