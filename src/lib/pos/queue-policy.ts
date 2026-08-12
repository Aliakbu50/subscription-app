/**
 * What a sync attempt MEANS. Pure, so every branch is testable without a
 * browser, a database, or a network.
 *
 * Three outcomes, and confusing any two of them is a real cost:
 *
 *   synced   — the server has it. Stop retrying, show it as done.
 *   retry    — we do not know. Keep it and try again. NEVER discard.
 *   rejected — the server refused on the merits (quota gone, wrong day).
 *              Stop retrying, but keep the row so the owner can see it.
 *              The cup was already handed over; deleting it hides that.
 *
 * The dangerous mistake is treating "we do not know" as failure and dropping
 * the item — a redemption the café gave away and can never account for.
 */

export type SyncOutcome =
  | { kind: "synced" }
  | { kind: "retry"; because: "offline" | "network" | "server_error" | "rate_limited" }
  | { kind: "rejected"; reason?: { ar: string; en: string } };

export type SyncResponse = {
  /** HTTP status, or null when the request never completed at all. */
  status: number | null;
  body?: { error?: string; reason?: { ar: string; en: string } } | null;
};

export function classifySyncResult(response: SyncResponse): SyncOutcome {
  const { status, body } = response;

  // The request never got an answer: offline, DNS failure, café router
  // rebooting. We genuinely do not know whether the server saw it, so it
  // stays queued. The idempotency key makes replaying it safe.
  if (status === null) return { kind: "retry", because: "network" };

  // 2xx. Includes a replayed idempotent write, which the endpoint reports as
  // success precisely so this path does not have to special-case it.
  if (status >= 200 && status < 300) return { kind: "synced" };

  // The server refused on the merits. Retrying will refuse again — the member
  // is out of quota, or already had one today. Keep the record and flag it.
  if (status === 409) return { kind: "rejected", reason: body?.reason };

  // Session expired while the item sat in the queue. Not the redemption's
  // fault and not permanent: someone signs in again and it goes.
  if (status === 401 || status === 403) {
    return { kind: "retry", because: "server_error" };
  }

  if (status === 429) return { kind: "retry", because: "rate_limited" };

  // 5xx — the server broke. Ours to fix, not the redemption's fault.
  if (status >= 500) return { kind: "retry", because: "server_error" };

  // Remaining 4xx are malformed requests: a bad phone number, a missing
  // subscription id. Retrying identical bytes cannot help, so stop — but keep
  // the row, because a cup was handed over and something has to explain it.
  return { kind: "rejected", reason: body?.reason };
}

/**
 * How long to wait before trying a failed item again.
 *
 * Exponential with a ceiling. A café whose wifi drops for an hour should not
 * have a phone hammering a dead router hundreds of times — that flattens the
 * battery, which on a shared shop device is its own outage.
 */
export function retryDelayMs(attempts: number): number {
  const base = 2_000 * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(base, 60_000);
}
