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
    <main className="flex flex-1 flex-col p-4">
      {/* The day's count as a spec cell — a label sitting on the box it
          describes, the way BLACK TEA sits on the product title. */}
      <div className="flex justify-center">
        <span className="tag relative top-px z-10">{t.redemptionsToday}</span>
      </div>
      <div className="cell flex items-center justify-center py-7">
        <span className="display text-7xl tabular-nums">{count ?? 0}</span>
      </div>

      {/* The most important control in the product. Deliberately enormous —
          findable by thumb without looking. Solid navy, like ADD TO CART. */}
      <Link
        href="/pos/scan"
        className="mt-4 flex flex-1 items-center justify-center border border-ink bg-brand text-3xl font-bold text-white active:bg-brand-strong"
      >
        {t.scan}
      </Link>

      {/* Butted against each other with a shared edge — one grid, not two
          floating buttons. -mt-px collapses the doubled stroke. */}
      <Link
        href="/pos/lookup"
        className="cell mt-4 px-4 py-5 text-center text-lg"
      >
        {t.lookupByPhone}
      </Link>
      <Link
        href="/pos/history"
        className="cell -mt-px px-4 py-4 text-center text-muted"
      >
        {t.history}
      </Link>
    </main>
  );
}
