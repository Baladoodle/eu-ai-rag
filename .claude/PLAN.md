# Implementation Plan — mastra-expert

> Phased build plan with milestones and per-agent file ownership. The plan assumes a team of cooperating Claude agents (or humans) each owning a coherent slice, with a final integration step to wire everything together. Owners are suggested roles; ownership boundaries are the source of truth.

---

## Phase 0 — Scaffolding (Agent: `scaffold-agent`)

**Goal**: `npm install && npm run dev` produces a runnable Next.js shell. No business logic yet.

**Files (all NEW):**
- `package.json` — pin Node 20, scripts: `dev`, `build`, `start`, `test`, `test:e2e`, `ingest`, `eval`, `lint`, `typecheck`.
- `tsconfig.json` — strict, `noUncheckedIndexedAccess: true`, paths alias `@/*` → `src/*`.
- `next.config.ts` — `serverExternalPackages: ['@mastra/rag', '@mastra/pg', 'voyageai', '@anthropic-ai/sdk', 'pino']` (keeps them out of the bundle).
- `tailwind.config.ts`, `postcss.config.mjs` — Tailwind v4.
- `.env.example` — every env var documented (see ARCHITECTURE.md §10).
- `.gitignore` — `node_modules`, `.next`, `.env*.local`, `.cache/`, `playwright-report/`.
- `.nvmrc` — `20`.
- `app/layout.tsx`, `app/page.tsx`, `app/globals.css` — minimal landing page ("Chat coming soon").
- `README.md` — quickstart, link to ARCHITECTURE.md, link to PLAN.md.

**Why a separate agent:** scaffolding decisions (TS strictness, Node version, lint config) cascade through every later file. Get them right once.

**Milestone 0 done when:** `npm run dev` shows the landing page at http://localhost:3000 with no console errors.

---

## Phase 1 — Type foundation (Agent: `types-agent`)

**Goal**: The shared types exist, are exported, and the build still passes.

**Files (all NEW):**
- `api-contract.ts` (already created by architect).
- `src/lib/env.ts` — Zod-validated env loader. Throws with a clear message on missing required vars.
- `src/lib/log.ts` — pino instance. Re-exported as `log`. `log.child({ requestId })` is the only sanctioned way to add context.

**Owner note:** every other agent imports from these two files. Don't bypass them.

**Milestone 1 done when:** `npm run typecheck` passes; importing `log` in a test produces a structured line.

---

## Phase 2 — Vector store (Agent: `vector-agent`)

**Goal**: Pluggable vector store with a working in-memory backend and a pgvector backend that talks to Supabase.

**Files (all NEW):**
- `src/lib/vector/types.ts` — internal `VectorStore` interface (subset of Mastra's interface we actually use).
- `src/lib/vector/in-memory.ts` — Map-backed implementation. Cosine similarity. Loads fixtures on first import.
- `src/lib/vector/pg.ts` — wraps `PgVector` from `@mastra/pg`.
- `src/lib/vector/index.ts` — factory: reads `VECTOR_BACKEND` env var, returns the right impl.
- `src/lib/vector/schema.ts` — Zod schema for the metadata we store alongside vectors.
- `tests/unit/vector/in-memory.test.ts` — upsert then query roundtrip; assert scores.
- `tests/unit/vector/pg.test.ts` — same, but skipped in CI without `TEST_PG_URL`.

**Why a separate agent:** the in-memory vs pg swap is the single biggest "does it work without external services" lever. Has to be solid before RAG can be built on top.

**Milestone 2 done when:** a unit test creates an in-memory store, upserts 3 vectors, queries with one of them, and gets itself back as top-1.

---

## Phase 3 — Embeddings (Agent: `embed-agent`)

**Goal**: Wrapped Voyage client. Mockable.

**Files (all NEW):**
- `src/lib/rag/embed.ts` — `embed(texts: string[]): Promise<number[][]>`. Reads `VOYAGE_API_KEY`, builds the request, returns vectors.
- `tests/unit/embed.test.ts` — uses MSW to mock `https://api.voyageai.com/v1/embeddings`. Asserts request body matches Voyage's documented shape and parses the canned response.

**Why a separate agent:** the embedding model and the vector store are different concerns, and the Voyage SDK has its own quirky request shape that benefits from focused test coverage.

**Milestone 3 done when:** `embed(["hello"])` returns a `number[][]` in both mock and live modes.

---

## Phase 4 — Chunking & retrieval (Agent: `rag-agent`)

**Goal**: RAG pipeline works end-to-end on the in-memory store.

**Files (all NEW):**
- `src/lib/rag/chunk.ts` — thin wrapper over `MDocument.chunk` with our constants.
- `src/lib/rag/retrieve.ts` — given a query, embed + query + rerank. Returns `{ chunks, metadata }`.
- `src/lib/rag/prompt.ts` — builds the system prompt from retrieved sources. **This is the file where the "be cited, refuse when empty" behavior lives.**
- `src/lib/data/sources.ts` — exports the curated source list (mirrors `data-sources.md`).
- `src/lib/data/fixtures.ts` — 20 eval cases + 10–15 hand-curated chunks for dev mode.
- `tests/unit/chunk.test.ts` — assert chunk boundaries, overlap.
- `tests/unit/retrieve.test.ts` — assert rerank weights are applied.
- `tests/unit/prompt.test.ts` — assert system prompt contains all source titles, contains "Refuse" instruction, no leaked secrets.

**Why a separate agent:** the RAG module is the heart of the project. Giving it one owner keeps the prompt-tweaking loop tight.

**Milestone 4 done when:** a unit test can call `retrieve("How do I use pgvector with Mastra?")` against the in-memory store and get back a non-empty `chunks` array.

---

## Phase 5 — LLM streaming (Agent: `llm-agent`)

**Goal**: Anthropic streaming wired to the AI SDK UI message stream, with our `data-sources` part injected at the end.

**Files (all NEW):**
- `src/lib/llm/anthropic.ts` — Anthropic SDK client + `streamAnthropic({ system, messages })` that yields raw deltas. Uses prompt caching.
- `src/lib/llm/streaming.ts` — wraps the raw deltas, accumulates text, and when `stream.finalize()` is called emits the `data-sources` part.
- `tests/integration/llm-stream.test.ts` — uses MSW to mock `https://api.anthropic.com/v1/messages` with a fake SSE response. Asserts the resulting `UIMessageStream` has the right parts in the right order.

**Why a separate agent:** the LLM streaming is its own tricky bit (SSE framing, prompt caching headers, error mapping). One owner keeps the surface small.

**Milestone 5 done when:** `streaming.ts` produces a `ReadableStream` that, when consumed by `toUIMessageStreamResponse`, yields a text part followed by a `data-sources` part.

---

## Phase 6 — API route (Agent: `api-agent`)

**Goal**: `POST /api/chat` is a complete, testable handler.

**Files (all NEW):**
- `src/app/api/chat/route.ts` — the only file that wires RAG + LLM. Zod-validates the body, calls `retrieve`, builds the prompt, streams back.
- `tests/integration/api-chat.test.ts` — full request/response test with MSW. Asserts: status 200, content-type `text/event-stream`, sources emitted at end.

**Why a separate agent:** the route is the integration point. One owner means the contract test in `tests/integration/api-chat.test.ts` is authoritative.

**Milestone 6 done when:** `curl -X POST localhost:3000/api/chat -d '{...}'` returns an SSE stream that ends with sources.

---

## Phase 7 — UI (Agent: `ui-agent`)

**Goal**: The chat page renders the streamed answer and a source list. Looks polished.

**Files (all NEW):**
- `src/components/ui/button.tsx`, `card.tsx`, `scroll-area.tsx`, `input.tsx`, `badge.tsx` — shadcn primitives (one component per file).
- `src/components/chat/chat-window.tsx` — `useChat` hook + scroll management.
- `src/components/chat/message-bubble.tsx` — renders assistant text with `[n]` citation chips.
- `src/components/chat/citation-chip.tsx` — single chip, links to its source in the panel.
- `src/components/chat/source-list.tsx` — collapsible right panel.
- `src/components/chat/suggested-questions.tsx` — 4 starter chips.
- `src/components/motion/fade-in.tsx` — Framer Motion wrapper.
- `src/hooks/use-chat.ts` — thin re-export with our defaults (suggested questions, initial messages).
- `app/page.tsx` (REPLACES the placeholder) — full chat layout.

**Why a separate agent:** the UI work is substantial and benefits from a fresh context window; cross-talk with backend code is via the `api-contract.ts` types only.

**Milestone 7 done when:** in a browser, typing a question shows a streamed answer with clickable citations.

---

## Phase 8 — Mocks & dev story (Agent: `mocks-agent`)

**Goal**: `MOCK=1 npm run dev` works with zero env vars.

**Files (all NEW):**
- `scripts/mock-server.ts` — MSW handlers for Voyage + Anthropic, designed to be imported by both Vitest (`tests/setup.ts`) and a Next.js instrumentation hook.
- `src/instrumentation.ts` — Next.js instrumentation hook. If `MOCK=1`, starts MSW in the Node runtime.
- `tests/setup.ts` — Vitest setup, calls `mockServer.listen()`.

**Why a separate agent:** mocks are an under-appreciated surface area. The agent's job is to make sure the canned responses are *realistic* (real SSE framing, real chunk sizes), not toy stubs.

**Milestone 8 done when:** deleting all env vars and running `MOCK=1 npm run dev` shows a working chat with synthetic but plausible answers.

---

## Phase 9 — Eval & ingest scripts (Agent: `eval-agent`)

**Goal**: `npm run eval` produces a markdown report. `npm run ingest` populates the prod DB.

**Files (all NEW):**
- `scripts/ingest.ts` — fetches sources from `data-sources.md`, chunks, embeds, upserts.
- `scripts/eval.ts` — runs the 20 cases, computes MRR / top-5 hit / groundedness / latency, writes `evals/report-<date>.md`.
- `supabase/migrations/0001_init.sql` — pgvector extension, `documents` table, `match_documents` RPC.
- `supabase/migrations/0002_hnsw_index.sql` — HNSW index on `documents.embedding`.
- `supabase/seed.sql` — 10 canonical Q&A as a starting point.

**Why a separate agent:** eval and ingest are *operational* code, not product code. They have different review standards (does it run once cleanly?) and different lifecycles (run in CI, not on the hot path).

**Milestone 9 done when:** `npm run eval` exits 0 with a report. `npm run ingest` against a real Supabase project successfully writes 100+ chunks.

---

## Phase 10 — E2E + polish (Agent: `e2e-agent`)

**Goal**: Playwright smoke test + a final polish pass.

**Files (all NEW):**
- `playwright.config.ts` — local + preview environments.
- `tests/e2e/chat.spec.ts` — open page, type, see streamed response, click citation.
- `README.md` (UPDATE) — add screenshots, deployment section.

**Why a separate agent:** end-to-end tests are the final safety net; the agent should run the app, see it, and only then claim the milestone.

**Milestone 10 done when:** `npm run test:e2e` is green. README has a screenshot of the live UI.

---

## Phase 11 — Integration reconciliation (Agent: `lead-agent`)

**Goal**: Resolve any cross-agent merge conflicts, run all tests, deploy a preview.

**Files (modified):**
- `package.json` (add any cross-cutting deps that emerged during integration).
- `tsconfig.json` (resolve any path-alias drift).
- `README.md` (final review).

**Why a separate agent:** every other agent has tunnel vision. The lead agent is the only one who runs `npm run typecheck && npm run test && npm run test:e2e && npm run build` end-to-end.

**Milestone 11 done when:** every command in the milestone above is green, and the app is deployed to a Vercel preview.

---

## Cross-cutting concerns

- **Every agent** must add a one-line `// Why:` comment to any non-obvious function (user is new to RAGs).
- **Every agent** must run `npm run typecheck` and `npm run lint` before declaring their phase done.
- **No `any`**. If you really need one, add a `// eslint-disable-next-line` with a justification comment.
- **Log levels**: `trace`/`debug` for retrieval internals, `info` for lifecycle, `warn` for low-confidence, `error` for throws.
- **Tests for external services**: any new HTTP call gets an MSW handler. No exceptions.

---

## Summary table

| Phase | Owner | Output |
|---|---|---|
| 0 | scaffold-agent | Runnable Next.js shell |
| 1 | types-agent | `env.ts`, `log.ts` |
| 2 | vector-agent | Pluggable `VectorStore` |
| 3 | embed-agent | Voyage wrapper |
| 4 | rag-agent | Chunking, retrieval, prompt, fixtures |
| 5 | llm-agent | Anthropic streaming |
| 6 | api-agent | `/api/chat` route |
| 7 | ui-agent | Chat page + components |
| 8 | mocks-agent | `MOCK=1` dev path |
| 9 | eval-agent | `ingest` + `eval` scripts + SQL |
| 10 | e2e-agent | Playwright + README polish |
| 11 | lead-agent | Full integration + deploy |
