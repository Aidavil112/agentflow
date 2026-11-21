/* Monsoon Drift offline shell. WebSocket /net and /health are never cached. */
const CACHE_NAME = "monsoon-drift-v7";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/assets/hero_car.glb",
  "/assets/city_car.glb",
  "/assets/auto_rickshaw.glb",
  "/assets/temple.glb",
  "/assets/chai_stall.glb",
  "/assets/char_ayaan.glb",
  "/assets/char_meera.glb",
  "/assets/char_constable.glb",
  "/assets/char_chaiwala.glb",
  "/assets/char_pedestrian.glb",
  "/assets/ai_companion.glb",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function isCacheable(url) {
  return url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/");
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const url = new URL(request.url);
    if (response.ok && isCacheable(url)) cache.put(request, response.clone());
    return response;
  } catch (error) {
    if (cached) return cached;
    if (request.destination === "image") {
      return new Response(
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        { headers: { "Content-Type": "image/png" } },
      );
    }
    return Response.error();
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && isCacheable(new URL(request.url))) cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request)) ||
      (await cache.match("/index.html")) ||
      (await cache.match("/")) ||
      Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/net" || url.pathname === "/health") return;
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});
