import { describe, expect, it } from "vitest";
import {
  isItemAllowed,
  isValidIdempotencyKey,
  MAX_BACKDATE_HOURS,
  MAX_CLOCK_SKEW_MINUTES,
  resolveRedemptionTime,
} from "@/lib/pos/redeem";
import { businessDay } from "@/lib/time/riyadh";

const NOW = new Date("2026-08-12T09:00:00Z"); // 12:00 Riyadh
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;

describe("resolveRedemptionTime", () => {
  it("accepts a redemption happening right now", () => {
    const result = resolveRedemptionTime(NOW.toISOString(), NOW);
    expect(result).toEqual({ ok: true, at: NOW });
  });

  it.each([
    [undefined, "missing"],
    ["", "missing"],
    [12345, "missing"],
    ["not a date", "unparseable"],
  ])("rejects %s as %s", (input, reason) => {
    expect(resolveRedemptionTime(input, NOW)).toEqual({ ok: false, reason });
  });

  describe("clock skew", () => {
    it("tolerates a phone running slightly fast", () => {
      const slightlyAhead = new Date(NOW.getTime() + minutes(MAX_CLOCK_SKEW_MINUTES - 1));
      expect(resolveRedemptionTime(slightlyAhead.toISOString(), NOW).ok).toBe(true);
    });

    /**
     * Without this bound, a client could claim a redemption happened at 07:00
     * to slip past a plan that is only valid from 06:00 — or jump the café day
     * boundary to get a second cup.
     */
    it("refuses a timestamp far enough ahead to game a time-of-day rule", () => {
      const wayAhead = new Date(NOW.getTime() + hours(6));
      expect(resolveRedemptionTime(wayAhead.toISOString(), NOW)).toEqual({
        ok: false,
        reason: "too_far_future",
      });
    });
  });

  describe("offline backdating", () => {
    it("accepts a redemption queued last night and synced this morning", () => {
      const lastNight = new Date(NOW.getTime() - hours(13));
      expect(resolveRedemptionTime(lastNight.toISOString(), NOW).ok).toBe(true);
    });

    it("accepts one right at the backdating limit", () => {
      const atLimit = new Date(NOW.getTime() - hours(MAX_BACKDATE_HOURS) + minutes(1));
      expect(resolveRedemptionTime(atLimit.toISOString(), NOW).ok).toBe(true);
    });

    it("refuses one older than the limit rather than backdating silently", () => {
      const tooOld = new Date(NOW.getTime() - hours(MAX_BACKDATE_HOURS + 1));
      expect(resolveRedemptionTime(tooOld.toISOString(), NOW)).toEqual({
        ok: false,
        reason: "too_far_past",
      });
    });
  });

  /**
   * The reason any of this matters. A cup handed over at 23:50 belongs to that
   * café day. Synced at 08:00 the next morning, using the sync time would put
   * it on the following business day and silently consume the member's next
   * allowance.
   */
  it("keeps a late-night redemption on the business day it happened", () => {
    const handedOverAt = new Date("2026-08-11T20:50:00Z"); // 23:50 Riyadh
    const syncedAt = new Date("2026-08-12T05:00:00Z"); // 08:00 Riyadh next day

    const result = resolveRedemptionTime(handedOverAt.toISOString(), syncedAt);
    expect(result.ok).toBe(true);

    if (!result.ok) throw new Error("expected acceptance");
    expect(businessDay(result.at)).toBe("2026-08-11");
    expect(businessDay(syncedAt)).toBe("2026-08-12");
  });
});

describe("isValidIdempotencyKey", () => {
  it("accepts a uuid v4", () => {
    expect(isValidIdempotencyKey("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
  });

  it.each([
    { why: "empty", key: "" },
    { why: "not a uuid", key: "seed-fahad-today" },
    { why: "truncated", key: "3f2504e0-4f89-41d3-9a0c" },
    { why: "null", key: null },
    { why: "not a string", key: 42 },
  ])("rejects $why", ({ key }) => {
    expect(isValidIdempotencyKey(key)).toBe(false);
  });
});

describe("isItemAllowed", () => {
  const items = ["americano", "latte"];

  it("accepts an item the plan covers", () => {
    expect(isItemAllowed("latte", items)).toBe(true);
  });

  it("refuses an item the plan does not cover", () => {
    expect(isItemAllowed("frappuccino", items)).toBe(false);
  });

  it("refuses a missing item when the plan lists items", () => {
    expect(isItemAllowed(null, items)).toBe(false);
  });

  it("allows anything when the plan does not restrict items", () => {
    expect(isItemAllowed("frappuccino", [])).toBe(true);
    expect(isItemAllowed(null, [])).toBe(true);
  });
});
