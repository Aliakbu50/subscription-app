/**
 * When may a redemption be voided?
 *
 * A void is for the mistake a cashier notices immediately — wrong member,
 * double-scanned, customer changed their mind at the counter. It is not an
 * undo button for yesterday.
 *
 * The 15-minute window is BUILD-SPEC's. It matters because a void restores
 * quota: an unbounded window would let a cashier hand out a free coffee and
 * quietly return the cup to the member's balance an hour later, with nothing
 * in the day's numbers looking wrong.
 */
export const VOID_WINDOW_MINUTES = 15;

export type VoidRefusal = "too_old" | "already_voided" | "is_a_void";

export type VoidCheck =
  | { allowed: true }
  | { allowed: false; because: VoidRefusal };

export function canVoid(
  redemption: {
    createdAt: Date;
    status: "completed" | "voided";
    /** Set when this row is itself a void of something else. */
    voidsRedemptionId?: string | null;
    /** Set when some other row has already voided this one. */
    voidedBy?: string | null;
  },
  now: Date,
): VoidCheck {
  // A void is itself append-only. Voiding a void would mean re-consuming
  // quota through a row that exists to release it.
  if (redemption.voidsRedemptionId) {
    return { allowed: false, because: "is_a_void" };
  }

  if (redemption.status === "voided" || redemption.voidedBy) {
    return { allowed: false, because: "already_voided" };
  }

  const minutesElapsed =
    (now.getTime() - redemption.createdAt.getTime()) / 60_000;

  if (minutesElapsed > VOID_WINDOW_MINUTES) {
    return { allowed: false, because: "too_old" };
  }

  return { allowed: true };
}

/** Whole minutes left, for a countdown next to the void button. */
export function voidMinutesRemaining(createdAt: Date, now: Date): number {
  const elapsed = (now.getTime() - createdAt.getTime()) / 60_000;
  return Math.max(0, Math.ceil(VOID_WINDOW_MINUTES - elapsed));
}
