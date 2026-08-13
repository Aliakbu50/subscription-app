/**
 * What actually happened today, once voids are taken into account.
 *
 * `redemptions` is append-only, so a void does NOT change the row it cancels —
 * it inserts a new row pointing at it. That means "count the completed rows"
 * over-reports: a redemption that was voided a minute later still says
 * `completed`, forever, because that is the honest record of what happened.
 *
 * So anything showing a NUMBER for the day has to subtract the voided ones,
 * and it has to do it the same way everywhere. This is that one way.
 *
 * The bug this exists to prevent was real: /pos counted completed rows while
 * /pos/history derived voided-ness properly, so after a void the two screens
 * disagreed about the same day and the café's headline number was too high.
 */

export type DayRow = {
  id: string;
  status: "completed" | "voided";
  /** Set only on a voiding row, naming the redemption it cancels. */
  voids_redemption_id: string | null;
};

/**
 * The redemptions that still stand: completed, and not since voided.
 *
 * Returns the rows rather than a count so callers that need to render them —
 * the history list — and callers that only need the number can share exactly
 * the same definition.
 */
export function activeRedemptions<T extends DayRow>(rows: T[]): T[] {
  const voidedIds = voidedRedemptionIds(rows);
  return rows.filter((row) => row.status === "completed" && !voidedIds.has(row.id));
}

/** Ids of redemptions that some other row has voided. */
export function voidedRedemptionIds(rows: DayRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.voids_redemption_id) ids.add(row.voids_redemption_id);
  }
  return ids;
}
