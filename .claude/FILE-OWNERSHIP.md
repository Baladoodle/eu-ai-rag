# File Ownership Map

> One source of truth for "who owns this file" across cooperating agents. If you need to change a file outside your lane, update this doc and ping the owner in the PR description.

**Legend:**
- **OWNER** — the agent who creates and maintains this file.
- **READ** — the agent who needs to read this file but should not change it without coordinating.
- **PRODUCES-FOR** — files that are direct inputs to the owning agent's work.

---

## Top-level

| Path | Owner | Read |
|---|---|---|
| `package.json` | scaffold-agent | everyone (add deps via PR) |
| `tsconfig.json` | scaffold-agent | everyone |
| `next.config.ts` | scaffold-agent | vector-agent, llm-agent |
| `tailwind.config.ts`, `postcss.config.mjs` | scaffold-agent | ui-agent |
| `.env.example` | scaffold-agent | types-agent, all backend agents |
| `.gitignore` | scaffold-agent | lead-agent |
| `README.md` | scaffold-agent → e2e-agent | everyone |
| `ARCHITECTURE.md` | architect (done) | everyone |
| `api-contract.ts` | architect (done) | everyone |
| `data-sources.md` | architect (done) | rag-agent, eval-agent |
| `playwright.config.ts` | e2e-agent | lead-agent |

---

## `.claude/`

| Path | Owner | Read |
|---|---|---|
| `PLAN.md` | architect (done) | every agent at start |
| `FILE-OWNERSHIP.md` | architect (done) | every agent at start |
| `settings.json` | scaffold-agent | (if any) |

---

## `src/lib/` (the business logic)

| Path | Owner | Read | Notes |
|---|---|---|---|
| `env.ts` | types-agent | everyone | ONLY way to read env. |
| `log.ts` | types-agent | everyone | ONLY way to log. |
| `vector/types.ts` | vector-agent | rag-agent, eval-agent | Interface contract. |
| `vector/in-memory.ts` | vector-agent | rag-agent, tests | Dev path. |
| `vector/pg.ts` | vector-agent | tests | Prod path. |
| `vector/index.ts` | vector-agent | rag-agent, api-agent | The factory; everyone imports from here. |
| `vector/schema.ts` | vector-agent | rag-agent | Metadata shape. |
| `rag/embed.ts` | embed-agent | rag-agent, eval-agent | The ONE place that knows about Voyage. |
| `rag/chunk.ts` | rag-agent | eval-agent | Chunking constants live here. |
| `rag/retrieve.ts` | rag-agent | api-agent | The retrieval pipeline. |
| `rag/prompt.ts` | rag-agent | api-agent | The system prompt builder. |
| `rag/types.ts` | rag-agent | api-agent | Re-exports from `api-contract.ts`. |
| `llm/anthropic.ts` | llm-agent | api-agent | Anthropic client. |
| `llm/streaming.ts` | llm-agent | api-agent | Stream → UI message stream. |
| `data/sources.ts` | rag-agent | eval-agent | Mirrors `data-sources.md`. |
| `data/fixtures.ts` | rag-agent | tests, mocks-agent | Eval set + dev-mode corpus. |

---

## `src/app/` (Next.js)

| Path | Owner | Read | Notes |
|---|---|---|---|
| `layout.tsx` | scaffold-agent | ui-agent | |
| `page.tsx` (placeholder) | scaffold-agent | — | Replaced in Phase 7. |
| `page.tsx` (final) | ui-agent | — | The chat page. |
| `globals.css` | scaffold-agent | ui-agent | Tailwind v4 entry. |
| `api/chat/route.ts` | api-agent | lead-agent | The integration point. |
| `instrumentation.ts` | mocks-agent | api-agent | Starts MSW when `MOCK=1`. |

---

## `src/components/`

| Path | Owner | Read |
|---|---|---|
| `ui/button.tsx` | ui-agent | — |
| `ui/card.tsx` | ui-agent | — |
| `ui/scroll-area.tsx` | ui-agent | — |
| `ui/input.tsx` | ui-agent | — |
| `ui/badge.tsx` | ui-agent | — |
| `chat/chat-window.tsx` | ui-agent | — |
| `chat/message-bubble.tsx` | ui-agent | — |
| `chat/citation-chip.tsx` | ui-agent | — |
| `chat/source-list.tsx` | ui-agent | — |
| `chat/suggested-questions.tsx` | ui-agent | — |
| `motion/fade-in.tsx` | ui-agent | — |

---

## `src/hooks/`

| Path | Owner | Read |
|---|---|---|
| `use-chat.ts` | ui-agent | — |

---

## `src/test/`

| Path | Owner | Read |
|---|---|---|
| `setup.ts` | mocks-agent | every test file |
| `handlers.ts` | mocks-agent | (extend via PR) |
| `helpers.ts` | ui-agent | — |

---

## `tests/`

| Path | Owner | Read |
|---|---|---|
| `unit/chunk.test.ts` | rag-agent | — |
| `unit/embed.test.ts` | embed-agent | — |
| `unit/retrieve.test.ts` | rag-agent | — |
| `unit/prompt.test.ts` | rag-agent | — |
| `unit/vector/in-memory.test.ts` | vector-agent | — |
| `unit/vector/pg.test.ts` | vector-agent | — |
| `integration/api-chat.test.ts` | api-agent | — |
| `integration/llm-stream.test.ts` | llm-agent | — |
| `integration/ingest.test.ts` | eval-agent | — |
| `e2e/chat.spec.ts` | e2e-agent | — |

---

## `scripts/`

| Path | Owner |
|---|---|
| `ingest.ts` | eval-agent |
| `eval.ts` | eval-agent |
| `mock-server.ts` | mocks-agent |

---

## `supabase/`

| Path | Owner |
|---|---|
| `migrations/0001_init.sql` | eval-agent |
| `migrations/0002_hnsw_index.sql` | eval-agent |
| `seed.sql` | eval-agent |

---

## Public

| Path | Owner |
|---|---|
| `public/favicon.ico` | scaffold-agent |
| `public/og.png` | e2e-agent |

---

## Integration Reconciliation Plan

When all 12 agents finish, the lead agent runs this checklist. Each step is a thing that *will* break if the previous agent didn't anticipate the next.

### Cross-agent contracts

1. **types-agent → everyone**: `env.ts` must export `env` (Zod-parsed object). **Hard rule:** every other module imports `env` from this file, never `process.env` directly. Lead agent greps for `process.env` in `src/lib/` and rejects the build if any are found outside `env.ts`.

2. **vector-agent → rag-agent**: `vector/index.ts` must export `getVectorStore(): VectorStore`. Rag-agent's `retrieve.ts` calls exactly this. No direct `PgVector` or `InMemoryVector` imports downstream.

3. **embed-agent → rag-agent**: `embed(texts: string[]): Promise<number[][]>` signature is fixed. Rag-agent's `retrieve.ts` calls it once per query (batched) — never per-chunk.

4. **rag-agent → api-agent**: `retrieve(query): Promise<{ chunks, metadata }>` and `buildSystemPrompt(chunks): string` are the two functions api-agent composes. If rag-agent changes their signatures, api-agent's tests break — that's the point.

5. **llm-agent → api-agent**: `streamAssistant({ system, messages }): ReadableStream<UIMessagePart>` is the boundary. Api-agent pipes it into `toUIMessageStreamResponse()`. Any Anthropic-specific type leaks past this function = bug.

6. **api-agent → ui-agent**: The custom UI parts (`data-sources`, `data-error`) are typed in `api-contract.ts` and re-exported in `src/lib/rag/types.ts`. Ui-agent's `message-bubble.tsx` discriminates on `part.type` using the same union. **A change in `api-contract.ts` must come with a corresponding change in `message-bubble.tsx`.** Lead agent checks both.

7. **mocks-agent → every test**: `tests/setup.ts` boots the MSW server before any test. Any test that imports a module that does HTTP at module-load time (e.g. `import './llm/anthropic'`) must wait for the server with `await mockServer.listen()`. If the test "passes locally but fails in CI" it's almost certainly this.

8. **eval-agent → rag-agent**: The 20 eval cases in `fixtures.ts` reference `SourceId`s. Rag-agent's `retrieve.ts` must use the same id format (`{namespace}/{slug}#{chunkIndex}`). If they drift, eval results are useless.

### Order of integration (lead-agent's runbook)

1. `npm install`
2. `npm run typecheck` — fixes type drift between agents.
3. `npm run lint` — flags any "no-explicit-any" violations.
4. `npm run test` — runs unit + integration. Common failures and fixes:
   - "Cannot find module '@/lib/vector'" → `tsconfig.json` paths missing; add `@/*` → `src/*`.
   - "MSW server not listening" → `tests/setup.ts` not imported in `vitest.config.ts`.
   - "Mismatch on Voyage request body" → `embed-agent` changed the payload; sync with their MSW handler.
5. `npm run build` — catches `serverExternalPackages` misses (any `require` of mastra/voyage/anthropic/pg from a client component).
6. `npm run test:e2e` — runs Playwright against `npm run dev` with `MOCK=1`. If this fails, it's almost always a UI bug, not a backend bug.
7. Deploy preview. Run `npm run eval` against the deployed instance. Compare metrics to the local run.

### Conflict resolution

- If two agents need to edit the same file (e.g. `package.json` for two different deps), they each open a PR; lead-agent merges. The merging agent must run `npm install && npm run typecheck` before merge.
- If a backend agent wants to add a UI dependency, they file a request to ui-agent, who owns `package.json` for the UI section.
- If a UI agent needs a new field on a custom UI part, they must update `api-contract.ts` and ping llm-agent / api-agent — this is the one exception to "stay in your lane."

### Definition of "done" for the whole project

- [ ] `npm install && npm run dev` works with no env vars (MOCK path).
- [ ] `npm install && npm run dev` works with real env vars (live path).
- [ ] `npm run typecheck && npm run lint && npm run test && npm run test:e2e && npm run build` all pass.
- [ ] `npm run eval` produces a report with MRR ≥ 0.7 and groundedness ≥ 2.5/3.
- [ ] A Vercel preview is live and the README links to it.
- [ ] The eval set, ARCHITECTURE.md, and PLAN.md are all committed.
