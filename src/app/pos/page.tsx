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
    <main className="flex flex-1 flex-col gap-5 p-5">
      <div className="pt-2 text-center">
        <div className="text-6xl font-bold tabular-nums leading-none">{count ?? 0}</div>
        <div className="mt-2 text-xs uppercase tracking-widest text-muted">
          {t.redemptionsToday}
        </div>
      </div>

      {/* The most important control in the product. Deliberately enormous —
          it should be findable by thumb without looking. */}
      <Link
        href="/pos/scan"
        className="flex flex-1 items-center justify-center rounded-3xl bg-brand text-3xl font-bold text-white active:bg-brand-strong"
      >
        {t.scan}
      </Link>

      <Link
        href="/pos/lookup"
        className="rounded-2xl border border-rule bg-surface px-4 py-4 text-center text-lg"
      >
        {t.lookupByPhone}
      </Link>

      <Link
        href="/pos/history"
        className="rounded-2xl px-4 py-3 text-center text-muted"
      >
        {t.history}
      </Link>
    </main>
  );
}
