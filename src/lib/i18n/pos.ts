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
  },
} as const;

export function posStrings(locale: Locale) {
  return pos[locale];
}
