/* Sophira service worker — deliberately conservative:
   cache-only the static app shell, never user or AI content. */
const CACHE = "sophira-shell-v1";
const PRECACHE = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network-first for everything; only static assets fall back to cache.
   Never cache HTML/API responses — academic data must always be fresh,
   and an offline Sophira must never show another person's data. */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest";
  if (!isStatic) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            }
            return res;
          })
          .catch(() => cached)
      );
    })
  );
});

/* OFFLINE NAVIGATION FALLBACK (gap-closure 2026-10-10): when a navigation
   fails while offline, the student gets an honest static page — inlined in
   the worker, so NO private HTML is ever cached and no other user's data can
   ever appear. The page states plainly what works offline (cached shell
   assets, the Offline page and locally stored work) and what does not
   (remote AI generation, live data). It never claims remote AI works
   without internet. */
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() =>
      new Response(
        [
          "<!doctype html><html lang="en"><head><meta charset="utf-8">",
          "<meta name="viewport" content="width=device-width, initial-scale=1">",
          "<title>Sophira — offline</title>",
          "<style>body{font-family:system-ui,sans-serif;margin:0;display:flex;min-height:100dvh;align-items:center;justify-content:center;background:#faf7f2;color:#333}.card{max-width:34rem;padding:2rem;margin:1rem;border:1px solid #ddd;border-radius:12px;background:#fff}a{color:#6d28d9}</style>",
          "</head><body><div class="card">",
          "<h1>You're offline</h1>",
          "<p>This page needs a connection and was not cached — Sophira never caches private pages or academic data in the browser cache.</p>",
          "<p>Offline you still have: the installed app shell, the <a href="/offline">Offline page</a>, and any work saved on this device (encrypted, per-account).</p>",
          "<p>Remote AI generation and live data need internet access and honestly cannot work offline.</p>",
          "<p><a href="/offline">Open the Offline page</a> &nbsp;·&nbsp; <a href="/dashboard">Try again</a></p>",
          "</div></body></html>",
        ].join(""),
        { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
      )
    )
  );
});
