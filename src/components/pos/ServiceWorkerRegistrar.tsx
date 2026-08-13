"use client";

/**
 * Registers the service worker and, once signed in, asks it to pull the POS
 * screens into cache.
 *
 * Registration happens on every POS page including the login screen, so the
 * worker is already installed by the time a cashier finishes signing in.
 *
 * WARMING is gated on having a session, because those routes redirect to
 * /pos/login without one. Warming too early would fill the cache with
 * redirects and pin the device to the login screen even after signing in —
 * which is exactly the sort of bug that only shows up in a café.
 */
import { useEffect } from "react";

export function ServiceWorkerRegistrar({ warm }: { warm: boolean }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    async function register() {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        if (cancelled || !warm) return;

        // Wait for one to be in control before asking it to warm — a freshly
        // installed worker cannot serve or cache anything yet.
        await navigator.serviceWorker.ready;
        if (cancelled) return;

        (registration.active ?? navigator.serviceWorker.controller)?.postMessage({
          type: "warm-shell",
        });
      } catch {
        // No service worker means no offline support, which is worse but not
        // broken: everything still works with a connection. Never let this
        // take down a screen a cashier is trying to use.
      }
    }

    void register();
    return () => {
      cancelled = true;
    };
  }, [warm]);

  return null;
}
