/* Cache the application shell and same-origin assets. Never cache notes or AI requests. */
const CACHE = "notepilot-shell-__NOTEPILOT_BUILD__";
const BUILD_ASSETS = [];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          "/",
          "/index.html",
          "/icon-192.png",
          "/icon-512.png",
          "/manifest.webmanifest",
          "/samples/derivatives.png",
          ...BUILD_ASSETS,
        ]),
      ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("notepilot-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            void caches.open(CACHE).then((c) => c.put("/index.html", clone));
          }
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            void caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return response;
        }),
    ),
  );
});
