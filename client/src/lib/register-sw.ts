/**
 * Registers the pass-through service worker from /sw.js so the app meets the
 * browser's installable-app criteria. Production only — a worker in dev would
 * interfere with Vite's dev server.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability is a bonus; the app runs normally without it.
    })
  })
}
