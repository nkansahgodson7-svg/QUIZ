const SPLASH_ID = 'boot-splash'
/** Keep in sync with the `#boot-splash` transition in index.html. */
const FADE_MS = 220

/** Fades out the static splash from index.html once the app has rendered. */
export function dismissBootSplash() {
  const splash = document.getElementById(SPLASH_ID)
  if (!splash || splash.dataset.dismissed === 'true') return
  splash.dataset.dismissed = 'true'
  splash.classList.add('is-done')
  window.setTimeout(() => splash.remove(), FADE_MS)
}
