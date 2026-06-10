/**
 * Vitest global setup. Currently a no-op; mocks-agent will add MSW listener
 * initialization here in Phase 8.
 *
 * Why: keeps the entry point stable so the mocks-agent can extend it
 * without forcing every test file to change.
 */
export {};
