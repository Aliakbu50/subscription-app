import { describe, expect, it } from "vitest";
import { isMemberRef, parseMemberRef } from "@/lib/pos/member-ref";

const REF = "xTQ7mK2pR9vLnB4wZs1aYc"; // 22 chars, URL-safe base64

describe("isMemberRef", () => {
  it("accepts what migration 0001 generates", () => {
    expect(isMemberRef(REF)).toBe(true);
    expect(isMemberRef("abc-DEF_123456789012xy")).toBe(true);
  });

  it.each([
    ["short", "tooShort"],
    ["long", "xTQ7mK2pR9vLnB4wZs1aYcEXTRA"],
    ["standard base64 padding", "xTQ7mK2pR9vLnB4wZs1aY="],
    ["a slash, which we translate away", "xTQ7mK2pR9vLnB4wZs1a/c"],
    ["a plus, likewise", "xTQ7mK2pR9vLnB4wZs1a+c"],
    ["empty", ""],
  ])("rejects %s", (_why, value) => {
    expect(isMemberRef(value)).toBe(false);
  });
});

describe("parseMemberRef", () => {
  it("reads a bare ref", () => {
    expect(parseMemberRef(REF)).toBe(REF);
  });

  it("tolerates surrounding whitespace from a decoder", () => {
    expect(parseMemberRef(`  ${REF}\n`)).toBe(REF);
  });

  it("reads a ref off the end of a URL", () => {
    expect(parseMemberRef(`https://talahco.com/m/${REF}`)).toBe(REF);
  });

  it("ignores a trailing slash", () => {
    expect(parseMemberRef(`https://talahco.com/m/${REF}/`)).toBe(REF);
  });

  it("ignores query strings and fragments", () => {
    expect(parseMemberRef(`https://talahco.com/m/${REF}?utm=card#top`)).toBe(REF);
  });

  /**
   * Parsed with the URL API rather than a regex specifically so that slashes
   * inside a query string cannot be mistaken for path segments.
   */
  it("does not mistake a query value for the last path segment", () => {
    expect(parseMemberRef(`https://talahco.com/m/notaref?next=/${REF}`)).toBeNull();
  });

  it.each([
    ["a random QR from a poster", "https://example.com/promo"],
    ["a wifi QR", "WIFI:S:CafeGuest;T:WPA;P:hunter2;;"],
    ["a phone number", "tel:+966500000001"],
    ["plain text", "hello"],
    ["empty", ""],
    ["whitespace", "   "],
  ])("returns null for %s", (_why, value) => {
    expect(parseMemberRef(value)).toBeNull();
  });

  /**
   * A member's QR must never be their phone number or their database id —
   * these are here to document that neither shape is accepted as a ref.
   */
  it("does not accept a uuid, which is what the ref exists to avoid exposing", () => {
    expect(parseMemberRef("d0000000-0000-0000-0000-000000000001")).toBeNull();
  });
});
