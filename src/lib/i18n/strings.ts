/**
 * All user-facing strings live here, never hardcoded in components.
 * Arabic is the default locale; English is the fallback.
 *
 * This is deliberately a plain object for now. When the surfaces grow we can
 * split it per-route, but the rule stays the same: no literal user-facing text
 * inside a component.
 */

export type Locale = "ar" | "en";

export const DEFAULT_LOCALE: Locale = "ar";

export const strings = {
  ar: {
    appName: "نظام الاشتراكات",
    setupTitle: "التهيئة تمت بنجاح",
    setupBody: "المشروع يعمل. الشاشة التالية: شاشة الاسترداد للكاشير.",
    envReady: "مفاتيح Supabase مضبوطة",
    envMissing: "مفاتيح Supabase غير مضبوطة بعد — عبّئ ملف ‎.env.local",
  },
  en: {
    appName: "Subscription system",
    setupTitle: "Setup complete",
    setupBody: "The project is running. Next up: the cashier redemption screen.",
    envReady: "Supabase keys are configured",
    envMissing: "Supabase keys not set yet — fill in .env.local",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export function t(locale: Locale = DEFAULT_LOCALE) {
  return strings[locale];
}
