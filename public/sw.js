/*
 * /sw.js — no-op service worker.
 *
 * This file exists ONLY to silence the browser's automatic probe for
 * /sw.js (which happens in dev tools and in some browsers on every
 * page load). Without it, the dev server logs show repeating 404s.
 *
 * We deliberately do NOT call `self.addEventListener('install', ...)` or
 * `self.skipWaiting()` — there is no service worker registration
 * anywhere in the app, so this file is never actually installed. The
 * browser just sees a 200 and stops retrying.
 */
self.addEventListener("install", () => {
  // No-op. Without skipWaiting() or fetch handlers, this SW does
  // nothing even if a future caller tries to register it.
});
