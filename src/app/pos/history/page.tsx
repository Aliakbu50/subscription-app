import { getStaffContext } from "@/lib/pos/session";
import { createServerClient } from "@/lib/supabase/server";
import { businessDay } from "@/lib/time/riyadh";
import { voidedRedemptionIds } from "@/lib/pos/day";
import { DEFAULT_LOCALE } from "@/lib/i18n/strings";
import { posStrings } from "@/lib/i18n/pos";
import { HistoryList, type HistoryRow } from "@/components/pos/HistoryList";

/**
 * Today's redemptions.
 *
 * Rendered on the server: the rows are already behind an authenticated
 * session and RLS, so fetching them here avoids a round trip and means the
 * screen has content on first paint rather than after a spinner.
 *
 * Voids are shown as their own fact rather than folded away. `redemptions` is
 * append-only, and the honest view of a day is "a cup was taken, then it was
 * cancelled" — not "nothing happened".
 */
export default async function HistoryPage() {
  const t = posStrings(DEFAULT_LOCALE);
  const staff = await getStaffContext();

  if (!staff) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-center text-lg">{t.noStaffRecord}</p>
      </main>
    );
  }

  const supabase = await createServerClient();
  const today = businessDay(new Date());

  // RLS scopes this to the cashier's own merchant.
  const { data } = await supabase
    .from("redemptions")
    .select("id, status, voids_redemption_id, item_label, source, created_at")
    .eq("business_day", today)
    .order("created_at", { ascending: false });

  const all = data ?? [];

  // Which completed rows have since been voided? Derived from the voiding
  // rows, because the original can never be marked — that is the point.
  // Shared with /pos so the count there and this list cannot disagree.
  const voidedIds = voidedRedemptionIds(all);

  const rows: HistoryRow[] = all
    .filter((r) => r.status === "completed")
    .map((r) => ({
      id: r.id,
      itemLabel: r.item_label,
      createdAt: r.created_at,
      voided: voidedIds.has(r.id),
    }));

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">{t.history}</h1>
      <HistoryList rows={rows} />
    </main>
  );
}
