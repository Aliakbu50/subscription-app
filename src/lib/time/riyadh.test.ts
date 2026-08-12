import { describe, expect, it } from "vitest";
import { businessDay, riyadhCalendarMonth, riyadhHour } from "@/lib/time/riyadh";

/**
 * Riyadh is UTC+3, so a Riyadh wall-clock time is written here as UTC minus
 * three hours. 04:00 Riyadh is 01:00Z.
 */
const riyadh = (isoLocal: string) => {
  const [date, time] = isoLocal.split(" ");
  const [h, m] = time.split(":").map(Number);
  const utc = new Date(`${date}T00:00:00Z`);
  utc.setUTCHours(h - 3, m);
  return utc;
};

describe("businessDay", () => {
  it("treats 04:00 Riyadh as the start of a new business day", () => {
    expect(businessDay(riyadh("2026-08-12 04:00"))).toBe("2026-08-12");
  });

  it("puts 03:59 Riyadh on the PREVIOUS business day", () => {
    expect(businessDay(riyadh("2026-08-12 03:59"))).toBe("2026-08-11");
  });

  // The case CLAUDE.md calls out by name.
  it("puts a 01:30 redemption on the previous business day", () => {
    expect(businessDay(riyadh("2026-08-12 01:30"))).toBe("2026-08-11");
  });

  it("keeps a late-night and an early-morning redemption on the SAME business day", () => {
    const lateNight = businessDay(riyadh("2026-08-11 23:30"));
    const afterMidnight = businessDay(riyadh("2026-08-12 01:30"));
    expect(afterMidnight).toBe(lateNight);
  });

  it("rolls over at 04:00 and not at midnight", () => {
    expect(businessDay(riyadh("2026-08-12 00:00"))).toBe("2026-08-11");
    expect(businessDay(riyadh("2026-08-12 12:00"))).toBe("2026-08-12");
  });

  it("handles a month boundary", () => {
    expect(businessDay(riyadh("2026-09-01 02:00"))).toBe("2026-08-31");
    expect(businessDay(riyadh("2026-09-01 05:00"))).toBe("2026-09-01");
  });

  /**
   * The database does ((ts at time zone 'Asia/Riyadh') - interval '4 hours')::date.
   * Because Riyadh is a fixed +3, that is the same as shifting UTC by -1 hour
   * and taking the date. If this ever fails, businessDay() and the database
   * have drifted apart and quota will be charged to the wrong day.
   */
  it("matches the database's definition across a full day of instants", () => {
    for (let minutes = 0; minutes < 24 * 60; minutes += 7) {
      const at = new Date(Date.UTC(2026, 7, 12, 0, minutes));
      const viaDatabaseFormula = new Date(at.getTime() - 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      expect(businessDay(at)).toBe(viaDatabaseFormula);
    }
  });

  /**
   * The test above checks this file against our own reading of the SQL. These
   * values came out of the REAL database, by running:
   *
   *   select ts, business_day(ts) from (values
   *     ('2026-08-12T01:00:00Z'::timestamptz), ...
   *   ) as t(ts);
   *
   * Confirmed 2026-08-12. If one of these ever fails, businessDay() and
   * business_day() have drifted apart and quota is being charged to the wrong
   * day — which shows up as a member wrongly refused a coffee they are owed,
   * long after anyone would connect it to a timezone change.
   */
  it.each([
    ["2026-08-12T01:00:00Z", "2026-08-12"], // 04:00 Riyadh — first minute of the new café day
    ["2026-08-12T00:59:00Z", "2026-08-11"], // 03:59 Riyadh — one minute earlier, previous day
    ["2026-08-11T22:30:00Z", "2026-08-11"], // 01:30 Riyadh — the case CLAUDE.md names
    ["2026-08-11T20:30:00Z", "2026-08-11"], // 23:30 Riyadh — same café night as the row above
    ["2026-08-31T23:00:00Z", "2026-08-31"], // 02:00 Riyadh on 1 Sep — still August's business day
  ])("agrees with the real database: %s -> %s", (instant, expected) => {
    expect(businessDay(new Date(instant))).toBe(expected);
  });
});

describe("riyadhHour", () => {
  it("reports real clock time, unshifted by the café day", () => {
    expect(riyadhHour(riyadh("2026-08-12 06:00"))).toBe(6);
    expect(riyadhHour(riyadh("2026-08-12 23:30"))).toBe(23);
    expect(riyadhHour(riyadh("2026-08-12 00:30"))).toBe(0);
  });
});

describe("riyadhCalendarMonth", () => {
  it("uses the calendar month, not the business day", () => {
    // 01:30 on the 1st is business day 'last month', but calendar month is new.
    expect(riyadhCalendarMonth(riyadh("2026-09-01 01:30"))).toBe("2026-09");
    expect(businessDay(riyadh("2026-09-01 01:30"))).toBe("2026-08-31");
  });
});
