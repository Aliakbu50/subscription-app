import { describe, expect, it } from "vitest";
import { canVoid, VOID_WINDOW_MINUTES, voidMinutesRemaining } from "@/lib/pos/void";

const NOW = new Date("2026-08-12T09:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

function redemption(overrides = {}) {
  return {
    createdAt: minutesAgo(2),
    status: "completed" as const,
    voidsRedemptionId: null,
    voidedBy: null,
    ...overrides,
  };
}

describe("canVoid", () => {
  it("allows a mistake noticed immediately", () => {
    expect(canVoid(redemption(), NOW)).toEqual({ allowed: true });
  });

  it("allows one right at the edge of the window", () => {
    const atEdge = redemption({ createdAt: minutesAgo(VOID_WINDOW_MINUTES - 0.5) });
    expect(canVoid(atEdge, NOW)).toEqual({ allowed: true });
  });

  /**
   * A void restores quota. An unbounded window would let a cashier hand out a
   * free coffee and quietly return the cup to the member's balance an hour
   * later, with nothing in the day's numbers looking wrong.
   */
  it("refuses once the window has passed", () => {
    const old = redemption({ createdAt: minutesAgo(VOID_WINDOW_MINUTES + 1) });
    expect(canVoid(old, NOW)).toEqual({ allowed: false, because: "too_old" });
  });

  it("refuses a redemption that is already voided", () => {
    expect(canVoid(redemption({ status: "voided" as const }), NOW)).toEqual({
      allowed: false,
      because: "already_voided",
    });
    expect(canVoid(redemption({ voidedBy: "some-row" }), NOW)).toEqual({
      allowed: false,
      because: "already_voided",
    });
  });

  /**
   * Voiding a void would re-consume quota through the very row that exists to
   * release it — a free cup with a clean-looking audit trail.
   */
  it("refuses to void a void", () => {
    const theVoidRow = redemption({ voidsRedemptionId: "original-row" });
    expect(canVoid(theVoidRow, NOW)).toEqual({ allowed: false, because: "is_a_void" });
  });

  it("checks what it is before it checks how old it is", () => {
    const oldVoid = redemption({
      voidsRedemptionId: "original",
      createdAt: minutesAgo(120),
    });
    // "is_a_void" is the useful thing to say; "too_old" would imply that
    // voiding it sooner would have worked.
    expect(canVoid(oldVoid, NOW)).toEqual({ allowed: false, because: "is_a_void" });
  });
});

describe("voidMinutesRemaining", () => {
  it("counts down", () => {
    expect(voidMinutesRemaining(minutesAgo(0), NOW)).toBe(VOID_WINDOW_MINUTES);
    expect(voidMinutesRemaining(minutesAgo(10), NOW)).toBe(5);
  });

  it("never goes negative", () => {
    expect(voidMinutesRemaining(minutesAgo(60), NOW)).toBe(0);
  });
});
