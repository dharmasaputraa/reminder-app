self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  e.respondWith(fetch(e.request).catch(async () => {
    if (!self.caches) return Response.error()
    const cached = await self.caches.match(e.request)
    return cached ?? Response.error()
  }))
})
