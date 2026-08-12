import { describe, expect, it } from "vitest";
import { formatSaudiPhoneForDisplay, normalizeSaudiPhone } from "@/lib/pos/phone";

describe("normalizeSaudiPhone", () => {
  it.each([
    ["0512345678", "the domestic form on every phone screen"],
    ["512345678", "without the trunk zero"],
    ["+966512345678", "E.164, what we store"],
    ["966512345678", "country code, no plus"],
    ["00966512345678", "international dialling prefix"],
    ["+966 51 234 5678", "with spaces"],
    ["05-1234-5678", "with dashes"],
    ["9660512345678", "country code AND trunk zero, a common mistake"],
  ])("accepts %s — %s", (input) => {
    expect(normalizeSaudiPhone(input)).toBe("+966512345678");
  });

  // Arabic keyboards produce these. Not an edge case in Dammam.
  it("accepts Arabic-Indic digits", () => {
    expect(normalizeSaudiPhone("٠٥١٢٣٤٥٦٧٨")).toBe("+966512345678");
  });

  it("accepts Extended Arabic-Indic digits", () => {
    expect(normalizeSaudiPhone("۰۵۱۲۳۴۵۶۷۸")).toBe("+966512345678");
  });

  it.each([
    ["", "empty"],
    ["05123", "half typed"],
    ["0412345678", "landline, not a mobile — Saudi mobiles start with 5"],
    ["05123456789", "one digit too many"],
    ["+15551234567", "not a Saudi number"],
    ["not a phone", "not digits at all"],
  ])("rejects %s — %s", (input) => {
    expect(normalizeSaudiPhone(input)).toBeNull();
  });

  it("returns null rather than throwing, so a half-typed box is not an error", () => {
    expect(() => normalizeSaudiPhone("05")).not.toThrow();
  });

  it("is idempotent — normalising an already-normal number changes nothing", () => {
    const once = normalizeSaudiPhone("0512345678")!;
    expect(normalizeSaudiPhone(once)).toBe(once);
  });
});

describe("formatSaudiPhoneForDisplay", () => {
  it("shows a cashier the domestic form, not E.164", () => {
    expect(formatSaudiPhoneForDisplay("+966512345678")).toBe("0512345678");
  });

  it("leaves anything unexpected alone rather than mangling it", () => {
    expect(formatSaudiPhoneForDisplay("+15551234567")).toBe("+15551234567");
  });
});
