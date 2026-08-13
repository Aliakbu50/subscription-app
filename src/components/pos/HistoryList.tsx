"use client";

/**
 * The interactive half of /pos/history: the void buttons, and anything still
 * sitting in the local queue.
 *
 * Queued items come first because they are the only part that might need
 * someone to act. A REJECTED one especially — that means a cup was handed over
 * and the server would not record it. Hiding that would make a café's numbers
 * quietly wrong; BUILD-SPEC asks for it to be surfaced for the owner.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE } from "@/lib/i18n/strings";
import { itemLabel, posStrings } from "@/lib/i18n/pos";
import {
  getUnsyncedItems,
  getUnsyncedItemsOnServer,
  subscribeToQueue,
} from "@/lib/pos/queue";
import { canVoid, voidMinutesRemaining } from "@/lib/pos/void";

export type HistoryRow = {
  id: string;
  itemLabel: string | null;
  createdAt: string;
  voided: boolean;
};

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(
    DEFAULT_LOCALE === "ar" ? "ar-SA" : "en-GB",
    { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" },
  );
}

export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  const t = posStrings(DEFAULT_LOCALE);
  const router = useRouter();

  const queued = useSyncExternalStore(
    subscribeToQueue,
    getUnsyncedItems,
    getUnsyncedItemsOnServer,
  );

  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The void window closes on a clock, so re-render periodically to let the
  // countdown fall and the button disappear on its own.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const now = new Date();
  void tick; // read so the interval above actually drives a re-render

  async function voidRedemption(id: string) {
    setVoidingId(id);
    setError(null);
    try {
      const response = await fetch("/api/pos/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redemptionId: id,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok) setError(t.voidFailed);
      else router.refresh();
    } catch {
      setError(t.voidFailed);
    } finally {
      setVoidingId(null);
    }
  }

  return (
    <>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {queued.map((item) => (
        <div
          key={item.id}
          className={`border p-4 ${
            item.status === "rejected"
              ? "border-danger bg-danger/10"
              : "border-warn bg-warn/10"
          }`}
        >
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-semibold">{item.memberFirstName}</span>
            <span className="text-sm text-muted">
              {timeOfDay(item.clientCreatedAt)}
            </span>
          </div>
          <div className="mt-1 text-sm">
            {item.status === "rejected"
              ? (item.reason?.[DEFAULT_LOCALE] ?? t.syncRejected)
              : t.waitingToSync}
          </div>
        </div>
      ))}

      {rows.length === 0 && queued.length === 0 && (
        <p className="text-muted">{t.noRedemptionsToday}</p>
      )}

      {rows.map((row) => {
        const createdAt = new Date(row.createdAt);
        const check = canVoid(
          { createdAt, status: row.voided ? "voided" : "completed" },
          now,
        );

        return (
          <div
            key={row.id}
            /* -mt-px so consecutive rows share one stroke and the list reads
               as a single ruled table rather than a stack of cards. */
            className={`cell -mt-px p-4 ${row.voided ? "opacity-50" : ""}`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-lg">
                {row.itemLabel ? itemLabel(row.itemLabel, DEFAULT_LOCALE) : "—"}
              </span>
              <span className="text-sm text-muted">{timeOfDay(row.createdAt)}</span>
            </div>

            {row.voided ? (
              <div className="mt-2 text-sm font-semibold text-danger">
                {t.voided}
              </div>
            ) : check.allowed ? (
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-muted">
                  {t.voidWindow(voidMinutesRemaining(createdAt, now))}
                </span>
                <button
                  onClick={() => voidRedemption(row.id)}
                  disabled={voidingId === row.id}
                  className="border border-danger px-4 py-2 text-sm text-danger disabled:opacity-40"
                >
                  {voidingId === row.id ? t.voiding : t.voidAction}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
