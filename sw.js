/* ShiftFlow Service Worker: Push + Offline-Cache (App-Shell). Kalenderdaten liegen zusätzlich im localStorage (offline-first). */
const CACHE = "sf-1793522017";
const SHELL = ["./", "index.html", "app.css?v=1793522017", "app.js?v=1793522017", "logic.js?v=1793522017", "demo.js?v=1793522017", "config.js?v=1793522017", "vendor/supabase.js", "icons/icon-192.png?v=1793522017", "icons/icon-512.png?v=1793522017", "manifest.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // Supabase-Aufrufe nie cachen
  // Network-first, damit Updates sofort ankommen; offline aus dem Cache
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === "navigate" }).then((r) => r || caches.match(new URL("./", self.registration.scope).href))));
});
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: "ShiftFlow", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "ShiftFlow", {
    body: d.body || "", icon: new URL("icons/icon-192.png?v=1793522017", self.registration.scope).href, badge: new URL("icons/badge-96.png?v=1793522017", self.registration.scope).href,
    tag: d.tag, renotify: !!d.tag, data: { url: d.url || "" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope)) { c.postMessage({ type: "open", url }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
