/**
 * Reading a member_ref out of whatever the camera decoded.
 *
 * The pass encodes the ref itself, but a QR is a thing people photograph,
 * forward and reprint, and Slice 2's Wallet pass may well encode a URL so that
 * a member scanning their own card lands somewhere useful. So accept both:
 *
 *   xTQ7mK2pR9vLnB4wZs1aYc          the bare ref
 *   https://talahco.com/m/xTQ7…     a link ending in the ref
 *
 * Anything else is rejected rather than passed through hopefully. A malformed
 * value sent to the lookup returns "member not found", which sends a cashier
 * hunting for a problem with the customer instead of with the code.
 */

/**
 * 22 characters of URL-safe base64 — what migration 0001 generates from 16
 * random bytes. Checking the shape here means an obviously wrong scan fails
 * instantly rather than after a network round trip.
 */
const MEMBER_REF = /^[A-Za-z0-9_-]{22}$/;

export function isMemberRef(value: string): boolean {
  return MEMBER_REF.test(value);
}

/** Returns the ref, or null if this QR is not one of ours. */
export function parseMemberRef(scanned: string): string | null {
  const trimmed = scanned.trim();
  if (!trimmed) return null;

  if (isMemberRef(trimmed)) return trimmed;

  // A URL: take the last non-empty path segment, ignoring any query or hash.
  // Parsed with the URL API rather than a regex so that a query string
  // containing slashes cannot be mistaken for a path.
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments.at(-1);
    if (last && isMemberRef(last)) return last;
  } catch {
    // Not a URL. Falls through to null.
  }

  return null;
}
