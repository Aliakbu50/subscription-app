import Link from "next/link";
import { getStaffContext } from "@/lib/pos/session";
import { createServerClient } from "@/lib/supabase/server";
import { businessDay } from "@/lib/time/riyadh";
import { DEFAULT_LOCALE } from "@/lib/i18n/strings";
import { posStrings } from "@/lib/i18n/pos";

/**
 * The home screen a cashier looks at all day.
 *
 * One enormous Scan button. Everything else is secondary. A barista holding a
 * phone in one hand with a portafilter in the other should be able to hit it
 * without looking.
 */
export default async function PosHome() {
  const t = posStrings(DEFAULT_LOCALE);
  const staff = await getStaffContext();

  // Signed in, but the auth user has no active staff row. Middleware cannot
  // catch this — it only knows whether someone is signed in, not whether they
  // work anywhere.
  if (!staff) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-sm text-center text-lg">{t.noStaffRecord}</p>
      </main>
    );
  }

  const supabase = await createServerClient();
  const today = businessDay(new Date());

  // RLS scopes this to the cashier's own merchant. No merchant filter needed
  // here, and adding one would give a false sense of where the boundary lives.
  const { count } = await supabase
    .from("redemptions")
    .select("id", { count: "exact", head: true })
    .eq("business_day", today)
    .eq("status", "completed");

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <div className="text-center">
        <div className="text-5xl font-bold tabular-nums">{count ?? 0}</div>
        <div className="text-sm opacity-70">{t.redemptionsToday}</div>
      </div>

      {/* The most important control in the product. Deliberately enormous. */}
      <Link
        href="/pos/scan"
        className="flex flex-1 items-center justify-center rounded-3xl bg-green-600 text-3xl font-bold text-white"
      >
        {t.scan}
      </Link>

      <Link
        href="/pos/lookup"
        className="rounded-xl border border-black/20 dark:border-white/20 px-4 py-4 text-center text-lg"
      >
        {t.lookupByPhone}
      </Link>

      <Link
        href="/pos/history"
        className="rounded-xl border border-black/20 dark:border-white/20 px-4 py-3 text-center"
      >
        {t.history}
      </Link>
    </main>
  );
}
