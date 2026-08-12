"use client";

/**
 * Green / amber / red connection state, always visible in the POS header.
 *
 * A barista must be able to tell at a glance whether what they are about to do
 * will reach the server. BUILD-SPEC calls a dropped café wifi "not an edge
 * case", and the worst version of it is the one nobody noticed.
 *
 * Amber (queued items waiting) is wired up in build step 7 with the offline
 * queue. Until then this reports online/offline only, and `queued` stays 0.
 */
import { useEffect, useState } from "react";
import { DEFAULT_LOCALE } from "@/lib/i18n/strings";
import { posStrings } from "@/lib/i18n/pos";

export function ConnectionIndicator({ queued = 0 }: { queued?: number }) {
  const t = posStrings(DEFAULT_LOCALE);

  // Start optimistic. navigator.onLine does not exist during server rendering,
  // and assuming offline would flash a red badge on every page load.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const state = !online ? "offline" : queued > 0 ? "syncing" : "online";

  const dot = {
    online: "bg-green-500",
    syncing: "bg-amber-500",
    offline: "bg-red-500",
  }[state];

  const label = {
    online: t.online,
    syncing: queued > 0 ? t.queued(queued) : t.syncing,
    offline: t.offline,
  }[state];

  return (
    <div className="flex items-center gap-2 text-sm" aria-live="polite">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
      <span className="opacity-80">{label}</span>
    </div>
  );
}
