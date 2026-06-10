/**
 * src/lib/ids.ts
 * ----------------------------------------------------------------------------
 * Tiny id-generation helpers.
 *
 * Why we centralize here:
 *   - The frontend, the API route, and the eval scripts all need to
 *     mint ids. Centralizing means a single place to swap to a real
 *     UUID library if we ever need one.
 *   - Test code can `vi.mock` this file and get deterministic ids.
 *
 * Why prefixed ids (e.g. "sess_..."):
 *   Operators reading logs can tell what kind of thing an id refers
 *   to at a glance. The prefix is free information.
 * ----------------------------------------------------------------------------
 */

/**
 * Build a short, unique-enough id with a domain prefix.
 *
 * Why not `crypto.randomUUID()`:
 *   In a Node test runner `randomUUID` works, but in the browser's
 *   older edge runtimes it can be missing. This implementation
 *   always works.
 */
export function createId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}${rand}`;
}
