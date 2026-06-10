/**
 * Root-level error boundary for the App Router.
 *
 * Why this file exists:
 *   Next.js 16.2.9 + Turbopack has a known bug where the RSC client
 *   manifest fails to register the built-in `global-error.js` module,
 *   which makes every page return a 500 with:
 *     "Could not find the module 'global-error.js#default' in the
 *      React Client Manifest."
 *   Providing an explicit `global-error.tsx` here registers the module
 *   in the manifest, which is the recommended workaround until
 *   upstream patches the bundler.
 *
 * Why the contents are minimal:
 *   `global-error` is the very last line of defense. It must render
 *   its own `<html>` and `<body>` because the root layout is unwound
 *   by the time this runs. The user only sees this if something
 *   catastrophic happens above all other error boundaries.
 */
"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to the browser console so the error isn't silent in dev.
    // We intentionally don't ship a real logger here — `global-error`
    // runs outside the normal provider tree.
    console.error("global-error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "oklch(0.205 0.008 250)",
          color: "oklch(0.965 0.012 80)",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
            Something went wrong
          </h1>
          <p
            style={{
              marginTop: "0.5rem",
              color: "oklch(0.965 0.012 80 / 0.7)",
              fontSize: "0.875rem",
            }}
          >
            The page failed to load. You can try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "1px solid oklch(1 0 0 / 12%)",
              background: "oklch(0.86 0.06 80)",
              color: "oklch(0.205 0.008 250)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
