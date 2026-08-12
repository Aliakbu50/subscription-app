/**
 * Passing a resolved member from the scan/lookup screen to the confirm screen.
 *
 * BUILD-SPEC routes confirm as /pos/confirm/[token]. The token is a throwaway
 * random id, NOT the member_ref — a member's QR value must not sit in browser
 * history, in a screenshot of the address bar, or in any server log of the
 * URLs a device visited.
 *
 * The resolved data lives in sessionStorage under that token. sessionStorage
 * rather than localStorage because it dies with the tab: a shop tablet left on
 * the counter should not still be holding the last customer's details tomorrow
 * morning.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { ResolvedMember } from "@/lib/pos/resolve";

const PREFIX = "pos:handoff:";

/** How the member was identified. The redeem call has to send the same thing. */
export type Handoff = {
  member: ResolvedMember;
  via: "qr" | "phone";
  /** Exactly one of these, matching `via`. */
  memberRef?: string;
  phone?: string;
  /** When the resolve happened, so the confirm screen can tell if it is stale. */
  resolvedAt: string;
};

export function storeHandoff(handoff: Handoff): string {
  const token = crypto.randomUUID();
  sessionStorage.setItem(PREFIX + token, JSON.stringify(handoff));
  return token;
}

export function readHandoff(token: string): Handoff | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + token);
    return raw ? (JSON.parse(raw) as Handoff) : null;
  } catch {
    return null;
  }
}

/**
 * Called once a redemption completes. The member's details have no reason to
 * outlive the transaction, and the next customer is already waiting.
 */
export function clearHandoff(token: string): void {
  sessionStorage.removeItem(PREFIX + token);
}

/** sessionStorage never changes underneath us — one screen, one token. */
const noSubscribe = () => () => {};

/**
 * Read a handoff during render, safely across server rendering.
 *
 * useSyncExternalStore rather than an effect: sessionStorage does not exist on
 * the server, so the server snapshot is null and React re-renders with the
 * real value after hydration — without the hydration mismatch that reading it
 * in useState would cause, and without setting state inside an effect.
 *
 * `undefined` means "not read yet" (server render), `null` means "no such
 * token". The screen must tell those apart: the first shows nothing for a
 * moment, the second says the session expired.
 */
export function useHandoff(token: string): Handoff | null | undefined {
  const raw = useSyncExternalStore(
    noSubscribe,
    () => sessionStorage.getItem(PREFIX + token),
    () => undefined,
  );

  return useMemo(() => {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as Handoff;
    } catch {
      return null;
    }
  }, [raw]);
}
