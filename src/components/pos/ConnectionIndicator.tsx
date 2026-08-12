"use client";

/**
 * Green / amber / red, always visible in the POS header.
 *
 * A barista must be able to tell at a glance whether what they are about to do
 * will reach the server, and whether anything is still owed to it. BUILD-SPEC
 * calls a dropped café wifi "not an edge case", and the worst version of it is
 * the one nobody noticed.
 *
 * This component also owns draining the queue. It is mounted on every POS
 * screen and already watching the connection, so there is no better place for
 * "we are back online, send the backlog" to live.
 */
import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE } from "@/lib/i18n/strings";
import { posStrings } from "@/lib/i18n/pos";
import {
  drainQueue,
  getPendingCount,
  getPendingCountOnServer,
  subscribeToQueue,
} from "@/lib/pos/queue";

/** Slow heartbeat, in case an 'online' event was missed while the app slept. */
const SWEEP_MS = 30_000;

function subscribeToConnection(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function ConnectionIndicator() {
  const t = posStrings(DEFAULT_LOCALE);

  // Both read during render rather than set from an effect. The server
  // snapshots are optimistic — assuming offline would flash a red badge on
  // every page load, which is worse than a moment of wrong green.
  const online = useSyncExternalStore(
    subscribeToConnection,
    () => navigator.onLine,
    () => true,
  );

  const queued = useSyncExternalStore(
    subscribeToQueue,
    getPendingCount,
    getPendingCountOnServer,
  );

  useEffect(() => {
    // On mount: the device may have reconnected while the app was closed, in
    // which case no 'online' event ever fired and nothing else would notice.
    if (navigator.onLine) void drainQueue();

    const onOnline = () => void drainQueue();
    window.addEventListener("online", onOnline);

    const sweep = setInterval(() => {
      if (navigator.onLine) void drainQueue();
    }, SWEEP_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(sweep);
    };
  }, []);

  const state = !online ? "offline" : queued > 0 ? "syncing" : "online";

  const dot = {
    online: "bg-ok",
    syncing: "bg-warn",
    offline: "bg-danger",
  }[state];

  const label = {
    online: t.online,
    syncing: t.queued(queued),
    offline: queued > 0 ? `${t.offline} · ${t.queued(queued)}` : t.offline,
  }[state];

  return (
    <div className="flex items-center gap-2 text-sm" aria-live="polite">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
      <span className="text-muted">{label}</span>
    </div>
  );
}
