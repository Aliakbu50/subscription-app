/**
 * Riyadh time helpers.
 *
 * Everything about a café's day is decided here. Get this wrong and quota is
 * charged to the wrong day, which is the kind of bug nobody notices until a
 * member is refused a coffee they are entitled to.
 */

/**
 * Asia/Riyadh is UTC+3 and has no daylight saving. Saudi Arabia has never
 * observed DST, so a fixed offset is correct rather than merely convenient.
 * If that ever changes, this constant and every function below is wrong, and
 * so is business_day() in the database.
 */
const RIYADH_UTC_OFFSET_HOURS = 3;

/**
 * The café day runs 04:00 -> 04:00 Riyadh, not midnight. A redemption at 01:30
 * belongs to the previous business day, because that is the same shift, the
 * same till, and the same working night as 23:30 was.
 */
const CAFE_DAY_START_HOUR = 4;

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Which business day does this instant belong to? Returns 'YYYY-MM-DD'.
 *
 * MUST agree with the database, which does:
 *   ((ts at time zone 'Asia/Riyadh') - interval '4 hours')::date
 *
 * That reads as: express the instant as Riyadh wall-clock time, wind it back
 * four hours, and keep the date. Winding back four hours is what makes 01:30
 * land on the previous day and 04:00 land on the new one.
 *
 * Because Riyadh is a fixed +3, "convert to Riyadh then subtract 4" collapses
 * to a single shift of -1 hour applied to UTC. The arithmetic below is written
 * as (offset - dayStart) rather than a bare -1 so it still reads like the SQL
 * and stays correct if either constant is ever changed.
 */
export function businessDay(at: Date): string {
  const shifted = new Date(
    at.getTime() + (RIYADH_UTC_OFFSET_HOURS - CAFE_DAY_START_HOUR) * MS_PER_HOUR,
  );
  return shifted.toISOString().slice(0, 10);
}

/**
 * Hour of day in Riyadh, 0-23. Used for plan rules like "valid 6am to 11pm".
 * This is real clock time, NOT shifted by the café day — a rule saying 6am
 * means 6am.
 */
export function riyadhHour(at: Date): number {
  const shifted = new Date(at.getTime() + RIYADH_UTC_OFFSET_HOURS * MS_PER_HOUR);
  return shifted.getUTCHours();
}

/**
 * Calendar month in Riyadh, 'YYYY-MM'. Used for the phone-fallback cap, which
 * BUILD-SPEC defines per calendar month rather than per business day.
 */
export function riyadhCalendarMonth(at: Date): string {
  const shifted = new Date(at.getTime() + RIYADH_UTC_OFFSET_HOURS * MS_PER_HOUR);
  return shifted.toISOString().slice(0, 7);
}
