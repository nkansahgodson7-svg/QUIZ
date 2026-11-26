/*
 * Quizzly service worker.
 *
 * This exists so browsers treat the app as installable. It deliberately does
 * not cache: every same-origin GET is passed straight through to the network,
 * so deploys take effect immediately and nobody gets a stale bundle.
 */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return
  event.respondWith(fetch(request))
})
