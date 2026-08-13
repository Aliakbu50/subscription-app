/**
 * Service worker for the cashier app.
 *
 * WHY THIS EXISTS
 * Without it, every navigation in the app fetches from the server. During a
 * café wifi outage the redemption queue would faithfully record a cup and then
 * strand the barista on that screen, unable to reach the scanner to serve the
 * next customer. BUILD-SPEC calls a dropped connection "not an edge case", and
 * surviving it means the app has to keep working, not just keep a record.
 *
 * THE ONE RULE THAT MATTERS
 * The API is NEVER cached. A redemption, a lookup, a void — those must always
 * reach the server or fail honestly. Serving a stale eligibility answer from a
 * cache would let a member redeem twice, which is exactly the failure the
 * whole quota system exists to prevent.
 *
 * Everything else — the HTML, the JavaScript, the stylesheet — is cached so
 * the screens themselves still open.
 */

/* Bump this to force every device to drop its old cache. The Next build
   hashes its asset filenames, so stale JS is not the usual risk; a changed
   caching STRATEGY is. */
const VERSION = "v1";
const PAGE_CACHE = `pos-pages-${VERSION}`;
const ASSET_CACHE = `pos-assets-${VERSION}`;

/** Warmed after sign-in — see ServiceWorkerRegistrar. */
const SHELL_ROUTES = ["/pos", "/pos/scan", "/pos/lookup", "/pos/history"];

self.addEventListener("install", () => {
  // Deliberately NOT precaching the routes here. They are behind a session,
  // and at install time there may not be one — we would cache a pile of
  // redirects to the login screen. They get warmed once signed in instead.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.endsWith(VERSION)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // The page asks us to pull the shell into cache after a successful sign-in,
  // when the session cookie exists and these routes return real HTML.
  if (event.data?.type === "warm-shell") {
    event.waitUntil(warmShell());
  }
});

async function warmShell() {
  const cache = await caches.open(PAGE_CACHE);
  await Promise.all(
    SHELL_ROUTES.map(async (route) => {
      try {
        const response = await fetch(route, { credentials: "same-origin" });
        if (isCacheable(response)) await cache.put(route, response.clone());
      } catch {
        // Offline while warming. Nothing to do; it warms on the next load.
      }
    }),
  );
}

/**
 * A redirect is what an expired session looks like. Caching one would pin the
 * cashier to the login screen even after signing back in.
 */
function isCacheable(response) {
  return response && response.status === 200 && !response.redirected;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only GET. A queued redemption is a POST and must never be replayed from
  // a cache — the IndexedDB queue is what makes those safe, not this.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // NEVER the API. See the note at the top of this file.
  if (url.pathname.startsWith("/api/")) return;

  // Hashed build output. The filename changes whenever the content does, so
  // serving it from cache forever is safe and makes a cold open fast.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Pages, and the data Next fetches for client-side navigation. Network
  // first, so an online cashier always sees fresh numbers; cache second, so
  // an offline one can still move between screens.
  event.respondWith(networkFirst(request, PAGE_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (isCacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;

    // Nothing cached for this exact request. If the cashier was navigating,
    // fall back to the POS home screen rather than the browser's error page —
    // a working screen they recognise beats a dinosaur.
    if (request.mode === "navigate") {
      const home = await cache.match("/pos");
      if (home) return home;
    }

    throw new Error("offline and nothing cached for this request");
  }
}
