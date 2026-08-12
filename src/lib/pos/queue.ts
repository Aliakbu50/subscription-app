"use client";

/**
 * The redemption queue.
 *
 * EVERY redemption goes through here, online or not. There is no separate
 * "offline mode" — online simply means the queue drains in under a second.
 * One code path, two outcomes, which is why café wifi dropping is not an edge
 * case that needs its own tested branch.
 *
 * IndexedDB rather than localStorage: it survives a tab crash, it is not
 * limited to a few megabytes, and writes are transactional. A cup handed over
 * during an outage must still be there after the barista drops the phone.
 */
import { classifySyncResult, retryDelayMs } from "@/lib/pos/queue-policy";

const DB_NAME = "pos";
const DB_VERSION = 1;
const STORE = "redemptions";

export type QueuedRedemption = {
  /** Also the idempotency key. One id, one cup, however many retries. */
  id: string;
  memberRef?: string;
  phone?: string;
  subscriptionId: string;
  itemLabel: string | null;
  /** When the cashier tapped. The server derives business_day from this. */
  clientCreatedAt: string;
  /** Kept only so history can name the member without another lookup. */
  memberFirstName: string;
  status: "pending" | "synced" | "rejected";
  reason?: { ar: string; en: string };
  attempts: number;
  nextAttemptAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function putItem(item: QueuedRedemption): Promise<void> {
  await withStore("readwrite", (store) => store.put(item));
}

export async function allItems(): Promise<QueuedRedemption[]> {
  const items = await withStore<QueuedRedemption[]>("readonly", (store) =>
    store.getAll() as IDBRequest<QueuedRedemption[]>,
  );
  return items ?? [];
}

/** Items still owed to the server. This is the number the amber badge shows. */
export async function pendingItems(): Promise<QueuedRedemption[]> {
  return (await allItems()).filter((i) => i.status === "pending");
}

/**
 * Synced items are kept briefly so /pos/history can show today's redemptions
 * without a round trip, then cleared. Rejected items are NEVER auto-cleared —
 * a cup was handed over and the owner needs to see it.
 */
export async function forgetSyncedBefore(cutoff: Date): Promise<void> {
  const stale = (await allItems()).filter(
    (i) => i.status === "synced" && new Date(i.clientCreatedAt) < cutoff,
  );
  for (const item of stale) {
    await withStore("readwrite", (store) => store.delete(item.id));
  }
}

/** Notify anything watching (the header badge, the history screen). */
const listeners = new Set<() => void>();

/**
 * A synchronous mirror of how many items are still owed to the server.
 *
 * IndexedDB is asynchronous, but useSyncExternalStore requires a snapshot it
 * can read during render. So the count is cached here and refreshed whenever
 * the queue changes — the badge reads this, never the database.
 */
let pendingCount = 0;

export function getPendingCount(): number {
  return pendingCount;
}

/** Server render has no IndexedDB, and must return a stable value. */
export function getPendingCountOnServer(): number {
  return 0;
}

export function subscribeToQueue(listener: () => void): () => void {
  listeners.add(listener);
  // First subscriber warms the cache — the app may have been reopened with a
  // backlog already sitting in IndexedDB from a previous session.
  void refreshPendingCount();
  return () => {
    listeners.delete(listener);
  };
}

async function refreshPendingCount(): Promise<void> {
  try {
    const next = (await pendingItems()).length;
    if (next !== pendingCount) {
      pendingCount = next;
      for (const listener of listeners) listener();
    }
  } catch {
    // IndexedDB unavailable (private browsing, ancient browser). A missing
    // badge is not worth breaking a screen over.
  }
}

function notify() {
  void refreshPendingCount();
  for (const listener of listeners) listener();
}

/** Send one item. Returns whether it left the queue, either way. */
async function attempt(item: QueuedRedemption): Promise<QueuedRedemption> {
  let status: number | null = null;
  let body: { error?: string; reason?: { ar: string; en: string } } | null = null;

  try {
    const response = await fetch("/api/pos/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberRef: item.memberRef,
        phone: item.phone,
        subscriptionId: item.subscriptionId,
        itemLabel: item.itemLabel,
        idempotencyKey: item.id,
        clientCreatedAt: item.clientCreatedAt,
      }),
    });
    status = response.status;
    body = await response.json().catch(() => null);
  } catch {
    // Network never completed. status stays null, which the policy reads as
    // "we do not know" — keep it.
    status = null;
  }

  const outcome = classifySyncResult({ status, body });
  const attempts = item.attempts + 1;

  if (outcome.kind === "synced") {
    return { ...item, status: "synced", attempts };
  }
  if (outcome.kind === "rejected") {
    return { ...item, status: "rejected", attempts, reason: outcome.reason };
  }
  return {
    ...item,
    status: "pending",
    attempts,
    nextAttemptAt: Date.now() + retryDelayMs(attempts),
  };
}

let draining = false;

/**
 * Try everything that is due. Safe to call as often as you like — reconnect,
 * page load, after a confirm — because it refuses to run twice at once and
 * every item is idempotent server-side.
 */
export async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;

  try {
    const now = Date.now();
    const due = (await pendingItems()).filter((i) => i.nextAttemptAt <= now);

    for (const item of due) {
      const updated = await attempt(item);
      await putItem(updated);
      notify();
    }
  } finally {
    draining = false;
  }
}

/**
 * Queue a redemption and try to send it immediately.
 *
 * Resolves with what the cashier should be shown. Waiting a moment for the
 * common case means an online redemption still gets a green screen rather
 * than an amber "will sync" that then quietly succeeds — which would train
 * staff to distrust green.
 */
export async function submitRedemption(
  item: Omit<QueuedRedemption, "status" | "attempts" | "nextAttemptAt">,
): Promise<QueuedRedemption> {
  const queued: QueuedRedemption = {
    ...item,
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
  };

  // Durable BEFORE the network is touched. If the phone dies mid-request the
  // cup is still recorded.
  await putItem(queued);
  notify();

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return queued; // amber, no point trying
  }

  const settled = await attempt(queued);
  await putItem(settled);
  notify();
  return settled;
}
