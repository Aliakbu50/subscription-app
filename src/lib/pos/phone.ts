/**
 * Saudi mobile numbers -> E.164.
 *
 * members.phone_e164 is the global identity for the whole platform, so every
 * number must reach the database in exactly one shape. A cashier at a counter
 * will type whichever form they know:
 *
 *   0512345678        the way it is written on a phone screen
 *   512345678         without the trunk zero
 *   +966512345678     E.164, what we store
 *   00966512345678    international prefix, common on landline habits
 *
 * All four are the same person. Spaces, dashes and Arabic-Indic digits happen
 * too, because Arabic keyboards produce ٠١٢٣ rather than 0123.
 */

/** Saudi mobile numbers are 9 digits and always start with 5. */
const SAUDI_MOBILE = /^5\d{8}$/;

/**
 * Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits map to 0-9.
 * A member typing on an Arabic keyboard is not an edge case in Dammam.
 */
function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * Returns '+9665XXXXXXXX', or null if this cannot be a Saudi mobile number.
 *
 * Returning null rather than throwing: a half-typed number is the normal state
 * of an input box, not an error worth interrupting anyone about.
 */
export function normalizeSaudiPhone(input: string): string | null {
  if (!input) return null;

  // Strip everything that is not a digit or a leading +, after converting
  // Arabic-Indic digits.
  let s = toWesternDigits(input).replace(/[\s()‐-―-]/g, "");

  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);

  if (!/^\d+$/.test(s)) return null;

  // Country code, with or without the trunk zero that should not be there:
  // 966512345678, and the common mistake 9660512345678.
  if (s.startsWith("966")) s = s.slice(3).replace(/^0/, "");
  // Domestic form: 0512345678
  else if (s.startsWith("0")) s = s.slice(1);

  if (!SAUDI_MOBILE.test(s)) return null;

  return `+966${s}`;
}

/**
 * '+966512345678' -> '0512345678', for showing a number back to a cashier.
 * Saudi staff read the domestic form; nobody at a till reads E.164.
 */
export function formatSaudiPhoneForDisplay(e164: string): string {
  const m = /^\+966(5\d{8})$/.exec(e164);
  return m ? `0${m[1]}` : e164;
}
