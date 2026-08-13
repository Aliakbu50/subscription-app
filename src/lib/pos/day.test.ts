import { describe, expect, it } from "vitest";
import { activeRedemptions, voidedRedemptionIds, type DayRow } from "@/lib/pos/day";

function completed(id: string): DayRow {
  return { id, status: "completed", voids_redemption_id: null };
}

function voids(id: string, target: string): DayRow {
  return { id, status: "voided", voids_redemption_id: target };
}

describe("activeRedemptions", () => {
  it("counts an ordinary day", () => {
    const rows = [completed("a"), completed("b"), completed("c")];
    expect(activeRedemptions(rows)).toHaveLength(3);
  });

  /**
   * The bug this file exists for. Voiding does not change the original row —
   * it adds one. Counting `status = 'completed'` therefore never goes down,
   * and a café's headline number stays too high forever.
   */
  it("excludes a redemption that was later voided", () => {
    const rows = [completed("a"), completed("b"), voids("v1", "a")];
    const active = activeRedemptions(rows);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("b");
  });

  it("goes to zero when everything served has been voided", () => {
    const rows = [
      completed("a"),
      completed("b"),
      voids("v1", "a"),
      voids("v2", "b"),
    ];
    expect(activeRedemptions(rows)).toHaveLength(0);
  });

  it("never counts the voiding rows themselves as redemptions", () => {
    const rows = [completed("a"), voids("v1", "a")];
    expect(activeRedemptions(rows).some((r) => r.status === "voided")).toBe(false);
  });

  it("keeps the original row in the data — the void is a fact, not an erasure", () => {
    const rows = [completed("a"), voids("v1", "a")];
    // The caller still has both; only the COUNT excludes the voided one.
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("completed");
  });

  it("handles an empty day", () => {
    expect(activeRedemptions([])).toHaveLength(0);
  });

  it("ignores a void pointing at a redemption from another day", () => {
    // The voiding row carries the original's business_day, so this should not
    // normally happen — but a stray reference must not remove a valid row.
    const rows = [completed("a"), voids("v1", "from-yesterday")];
    expect(activeRedemptions(rows)).toHaveLength(1);
  });
});

describe("voidedRedemptionIds", () => {
  it("collects the ids that voiding rows point at", () => {
    const rows = [completed("a"), completed("b"), voids("v1", "a")];
    expect(voidedRedemptionIds(rows)).toEqual(new Set(["a"]));
  });

  it("is empty when nothing was voided", () => {
    expect(voidedRedemptionIds([completed("a")]).size).toBe(0);
  });
});
