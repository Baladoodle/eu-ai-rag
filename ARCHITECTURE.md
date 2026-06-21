# eu-ai-act-expert — Architecture

> A production-grade RAG chatbot that answers questions about **Regulation (EU) 2024/1689** — the EU AI Act. Designed as a freelance portfolio piece to demonstrate end-to-end AI integration competence.

---

## 1. Goals & Non-Goals

### Goals
- Answer questions about the EU AI Act with **grounded, cited** responses, each claim mapped to a specific Article, Recital, or Annex.
- Be **deployable in 10 minutes** to Vercel + Supabase.
- Be **runnable locally without any API keys** (mock data fallback).
- Serve as a **portfolio artifact** — clean code, comprehensive tests, real evals, production logging.

### Non-Goals
- Multi-tenant or production SaaS features (auth, billing, rate limits beyond a simple in-memory limiter).
- Long-term memory of past conversations (stateless per-session).
- Voice / multimodal input.
- Crawling the open web at runtime (knowledge base is pre-built and versioned).

---

## 2. Stack Decisions (with rationale)

### 2.1 Framework: Next.js 15 App Router
**Why:** The App Router is the only Next.js model with first-class streaming response support and the React Server Components story we want to showcase. RSC lets us fetch static data (e.g. suggested questions) on the server while leaving the chat interactive. Route Handlers (`app/api/chat/route.ts`) are the right place for streaming LLM responses — Server Actions are still constrained by a 3s edge timeout and lack clean token streaming.

### 2.2 AI Framework: Mastra (chunking + vector store only)
**Why `@mastra/rag`:** Mastra's `MDocument` provides a language-agnostic recursive chunker with sensible overlap defaults. We use it because the chunking step is the highest-leverage place to be correct for legal text (Article boundaries matter), and re-rolling our own recursive splitter would be a maintenance tax with no upside. The Mastra RAG module itself is **not** the topic of the chatbot — it is plumbing.
It also gives us:
- `MDocument` for chunking (recursive strategy with overlap — language-agnostic, code-aware defaults).
- `embedMany` routed through `ModelRouterEmbeddingModel` (lets us swap embedding providers with one line).
- A consistent `VectorStore` interface (pgvector, Pinecone, Qdrant, MongoDB, Chroma all share `.upsert` / `.query` / `.createIndex`).
- Built-in rerankers (`MastraAgentRelevanceScorer`, `CohereRelevanceScorer`).
**Where we drop down to raw:** Streaming responses are best handled with the Vercel AI SDK `streamText`, not Mastra's agent loop, because we want to interleave retrieval logs and source citations into the streamed UI message stream. The Mastra agent runtime shines for tool-use; for a single-step RAG pipeline, the AI SDK gives finer control over the SSE protocol and source annotation.

### 2.3 Embeddings: Voyage AI — `voyage-code-3`
**Why Voyage over OpenAI:** Independent benchmarks (and Voyage's own) show Voyage leading on code and mixed code+prose retrieval. **Why `voyage-code-3` over `voyage-3`:** the EU AI Act is dense with cross-references (`Article 6(1) shall apply mutatis mutandis to...`, point (b) of paragraph 2 of Article 5, etc.) that benefit from the same dense representation code-3 was trained on. Dimensions: **1024** (default; configurable down to 256 for storage savings). Context length: **32K tokens** — we chunk at 1024 tokens so this is never a constraint. **Quantization:** `float` (32-bit) for accuracy; revisit `int8` only if storage becomes an issue. **Caveat:** `voyage-law-2` is a more semantically accurate fit; we keep `voyage-code-3` because the cross-reference structure is the dominant signal, not topical similarity.

### 2.4 Vector Store: pgvector (Supabase in prod, in-memory in dev)
**Why pgvector:** The corpus is small enough (< 5K chunks initially) that a dedicated vector DB is overkill, and our freelance clients are mostly already paying for Postgres. One database, one backup story, one auth model. HNSW index for sub-100ms retrieval at our scale. **Why Supabase:** Free tier is generous (500MB, 50K MAU), the JS client is small, and pgvector support is first-class. **Why in-memory fallback for dev:** `npm install && npm run dev` should produce a working app with no Postgres. We use a Map-backed in-memory store behind the same `VectorStore` interface — the dev path never touches the network.

### 2.5 LLM: Claude Sonnet (current) via Anthropic SDK
**Why Claude for a code corpus:** Claude Sonnet is the strongest mid-tier model on code reasoning and follows structured instructions well (we need it to produce grounded answers and to refuse when retrieval returns nothing). **Why raw Anthropic SDK over AI SDK provider wrappers:** We get prompt caching out of the box (cache the system prompt + retrieved context block for 5 minutes) and tighter control over `stream_events`. The AI SDK's `streamText` is used as the SSE adapter, but the actual `messages.create({ stream: true })` call goes directly to Anthropic.

### 2.6 UI: Tailwind v4 + shadcn/ui + Framer Motion
**Why Tailwind v4:** CSS-first config, faster compile, no `tailwind.config.ts` boilerplate, and shadcn/ui now officially supports v4. **Why shadcn:** Components live in the repo (auditable, customizable) — important for a portfolio piece. **Why Framer Motion:** Source citation expansion, message fade-in, and a subtle streaming cursor — all cheap to add but signal polish to a freelance evaluator.

### 2.7 Logging: pino (structured JSON, level-aware)
**Why pino:** Fastest Node logger, structured JSON output by default, plays well with Vercel's log drain. We use log levels to prevent noise:
- `trace` — full retrieval candidates (dev only)
- `debug` — chunk IDs, similarity scores
- `info` — request lifecycle (start, end, retrieved N chunks, streamed N tokens)
- `warn` — low-confidence retrieval (< 0.6 top score), empty results
- `error` — anything that throws

### 2.8 Testing: Vitest + MSW + Playwright
**Why Vitest:** Native ESM, fast, Jest-compatible API. **Why MSW:** Intercepts the Anthropic, Voyage, and Supabase HTTP calls at the network layer — we can assert on real request/response shapes without ever calling the real APIs in CI. **Why Playwright:** One end-to-end smoke test that the chat page renders, sends a message, and displays a citation.

---

## 3. Folder Structure

```
eu-ai-act-expert/
├── ARCHITECTURE.md                  # This file.
├── README.md                        # Quickstart, env vars, deploy.
├── data-sources.md                  # Exact URLs/files to ingest.
├── api-contract.ts                  # Shared TS types for API & citations.
├── package.json                     # Single workspace, npm scripts.
├── tsconfig.json                    # Strict, ES2022, bundler resolution.
├── next.config.ts                   # serverExternalPackages for @mastra/pg / @mastra/rag / voyageai / anthropic.
├── tailwind.config.ts               # Tailwind v4 config (minimal).
├── postcss.config.mjs
├── .env.example                     # Documents every env var.
├── .nvmrc                           # Node 20.x.
├── .gitignore
├── .claude/
│   ├── PLAN.md                      # Phased build plan + file ownership.
│   ├── FILE-OWNERSHIP.md            # Per-agent file ownership map.
│   └── settings.json                # Hooks for tests-on-save.
├── public/
│   ├── favicon.ico
│   └── og.png                       # Social preview.
├── supabase/
│   ├── migrations/
│   │   ├── 0001_init.sql            # pgvector extension, documents table, match_documents RPC.
│   │   └── 0002_hnsw_index.sql      # HNSW index for cosine distance.
│   └── seed.sql                     # Optional: insert 10 canonical Q&A.
├── scripts/
│   ├── ingest.ts                    # Crawl sources → chunk → embed → upsert.
│   ├── eval.ts                      # Run eval set, compute retrieval MRR + groundedness.
│   └── mock-server.ts               # MSW handlers for local dev (mocks Voyage + Anthropic).
├── src/
│   ├── app/
│   │   ├── layout.tsx               # Root layout, fonts, theme provider.
│   │   ├── page.tsx                 # Landing + chat (RSC shell, hydrates client).
│   │   ├── globals.css              # Tailwind v4 + CSS variables.
│   │   └── api/
│   │       └── chat/
│   │           └── route.ts         # POST handler: retrieval → streamText → SSE.
│   ├── components/
│   │   ├── ui/                      # shadcn primitives (button, card, scroll-area, etc.).
│   │   ├── chat/
│   │   │   ├── chat-window.tsx      # useChat + scroll management.
│   │   │   ├── message-bubble.tsx   # Renders assistant text + inline citations.
│   │   │   ├── source-list.tsx      # Expandable list of retrieved sources.
│   │   │   ├── citation-chip.tsx    # [1] chip that scrolls to source.
│   │   │   └── suggested-questions.tsx  # Starter chips.
│   │   └── motion/
│   │       └── fade-in.tsx          # Framer Motion wrapper.
│   ├── lib/
│   │   ├── rag/
│   │   │   ├── chunk.ts             # MDocument.chunk wrapper + tuning constants.
│   │   │   ├── embed.ts             # Voyage client + embedMany wrapper.
│   │   │   ├── retrieve.ts          # query() + rerank + topK selection.
│   │   │   ├── prompt.ts            # System prompt builder (cited, terse, refuses on no context).
│   │   │   └── types.ts             # Re-exports from api-contract.ts.
│   │   ├── vector/
│   │   │   ├── index.ts             # VectorStore factory: reads VECTOR_BACKEND env.
│   │   │   ├── pg.ts                # PgVector wrapper.
│   │   │   ├── in-memory.ts         # Map-backed dev store behind same interface.
│   │   │   └── schema.ts            # Zod schemas for stored chunks.
│   │   ├── llm/
│   │   │   ├── anthropic.ts         # Anthropic client + streamAnthropic() helper.
│   │   │   └── streaming.ts         # Wraps Anthropic stream → AI SDK UI message stream.
│   │   ├── data/
│   │   │   ├── sources.ts           # Curated source list (mirrors data-sources.md).
│   │   │   └── fixtures.ts          # 20 eval Q&A pairs in code.
│   │   ├── log.ts                   # pino instance + level from env.
│   │   └── env.ts                   # Zod-validated env var loader.
│   ├── hooks/
│   │   └── use-chat.ts              # Thin re-export of @ai-sdk/react useChat with our defaults.
│   └── test/
│       ├── setup.ts                 # Vitest setup, MSW server start.
│       ├── handlers.ts              # MSW handlers for voyage/anthropic/supabase.
│       └── helpers.ts               # renderWithProviders, makeMessage.
└── tests/
    ├── unit/
    │   ├── chunk.test.ts            # Chunking boundaries, overlap.
    │   ├── embed.test.ts            # Mocked Voyage, asserts request shape.
    │   ├── retrieve.test.ts         # TopK, rerank weight math.
    │   ├── prompt.test.ts           # System prompt contains sources, no leaked secrets.
    │   └── vector/
    │       ├── in-memory.test.ts    # Contract: createIndex/upsert/query.
    │       └── pg.test.ts           # Skipped in CI without TEST_PG_URL.
    ├── integration/
    │   ├── api-chat.test.ts         # POST /api/chat with mocked backends.
    │   └── ingest.test.ts           # End-to-end ingest on fixture corpus.
    └── e2e/
        └── chat.spec.ts             # Playwright: open page, send message, see citation.
```

### Rationale
- **`src/` over root-level `app/`** — keeps the Next.js shell separate from business logic (`lib/rag`, `lib/vector`, `lib/llm`).
- **`lib/rag/*` and `lib/vector/*`** are framework-agnostic and unit-testable in isolation.
- **`scripts/`** is for one-off ops (ingest, eval) that aren't part of the running app.
- **`supabase/migrations/`** is checked in so the prod DB is reproducible.
- **`.claude/`** keeps agent coordination files out of the user's view.

---

## 4. Data Flow

```
User types question
        │
        ▼
[chat-window.tsx]  useChat → POST /api/chat  { messages }
        │
        ▼
[route.ts]  Validates body with Zod
        │  log.info("chat.start", { sessionId, msgCount })
        ▼
[retrieve.ts]  embed(query) via Voyage  →  pgVector.query(topK=10)
        │  log.debug("retrieval.candidates", { count, scores })
        ▼
[retrieve.ts]  rerank() with cross-encoder scorer  →  topK=5
        │  log.info("retrieval.final", { ids, topScore })
        ▼
[prompt.ts]   Build system prompt with numbered sources block
        │
        ▼
[streaming.ts]  anthropic.messages.stream({ system, messages, prompt_cache })
        │  For each delta: emit text part + when done emit sources part
        ▼
        ▼
[route.ts]  return result.toUIMessageStreamResponse()
        │
        ▼
[chat-window.tsx]  Renders streamed text + final source citations
```

**Key design choice:** Sources are sent as a custom `data-source` part at the end of the stream, not as text. The client renders them in a side panel and anchors `[1]` chips to them.

---

## 5. API Contract

See [`api-contract.ts`](./api-contract.ts) for the full type definitions. Summary:

### `POST /api/chat`
**Request body** (validated by Zod at the route):
```ts
{
  messages: UIMessage[];        // From @ai-sdk/react
  sessionId?: string;           // For log correlation; not used for memory yet.
}
```
**Response**: `text/event-stream` (UI message stream protocol, v1).

**Streamed parts**:
1. `text` parts — incremental assistant text.
2. `data-source` part (emitted once at end) — array of `Source` objects for the UI to render as citations.

### `Source` shape
```ts
interface Source {
  id: SourceId;                  // Stable, e.g. "ai-act/article-3#chunk-0"
  title: string;                 // Human-readable, e.g. "Article 3 — Definitions"
  url: string;                   // Canonical source URL (EUR-Lex or mirror)
  section?: string;              // H2/H3 if extractable
  articleNumber?: string;        // Pinned at ingestion (e.g. "16" or "16(1)")
  snippet: string;               // Truncated chunk text (~300 chars)
  fullText: string;              // Identical to what the retriever saw
  retrievedAt: string;           // ISO timestamp
}
// Note: retrieval score is NOT on the wire. Use DebugSource (which
// extends Source with `score`) for server-internal logs only.
```

---

## 6. Knowledge Base & Ingestion

See [`data-sources.md`](./data-sources.md) for the full list. Summary:

**Tier 1 — Regulation text (always ingest):**
- `https://artificialintelligenceact.eu/article/{N}/` for N = 1..113 — the 113 Articles.
- `https://artificialintelligenceact.eu/recital/{N}/` for N = 1..180 — the 180 Recitals.

**Tier 2 — Annexes (always ingest):**
- `https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-{N}` for N = 1..13 — the 13 Annexes.

**Tier 3 — Commission guidance (always ingest):**
- DG CNECT "Navigating the AI Act" FAQ.
- DG CNECT regulatory framework overview.
- DG CNECT GPAI Code of Practice.
- AI Act Service Desk landing page.

**Ingestion pipeline** (`scripts/ingest.ts`):
1. Fetch each URL via `fetch` + extract main content (Mozilla Readability-style strip).
2. Convert HTML to markdown, drop nav/footer.
3. Chunk with `MDocument.fromText().chunk({ strategy: 'recursive', size: 1024, overlap: 128 })`.
4. Embed in batches of 64 with Voyage.
5. Upsert into `pgVector.upsert({ indexName, vectors, metadata })`.
6. Store metadata: `{ sourceId, url, title, section, ingestedAt, chunkIndex, origin, canonical }`.

**Idempotency**: Each chunk is keyed by `sha256(url + chunkIndex)`. Re-ingestion is a no-op.

---

## 7. Evaluation Set

20 Q&A pairs in `evals/questions.json`, structured as:
```ts
{
  id: string;                    // e.g. "q01"
  category: string;              // see categories list below
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  expectedSources: string[];     // Article / Recital / Annex URLs that should be cited
  expectedTopics: Array<string | { aliases: string[] }>;  // substring the answer must mention; aliases cover UK/US spelling
  expectedEnumCount?: number;    // if set, answer's list-item count must match within enumTolerance
  enumTolerance?: number;        // default 1
}
```

**Categories (across 20 cases):** risk-classification, definitions, provider-obligations, deployer-obligations, high-risk-requirements, transparency, gpai, timeline, enforcement, conformity-assessment, post-market, gdpr-cross-ref.

**Example cases:**
- "What are the four risk categories used by the EU AI Act?" (easy, risk-classification)
- "What obligations apply to providers of high-risk AI?" (medium, provider-obligations)
- "What are the conformity assessment procedures for high-risk AI systems under Article 43?" (hard, conformity-assessment)

**Metrics computed by `evals/scorer.ts` (per case, raw 0..9, normalized 0..100):**
- **Source accuracy** (0..3) — fraction of expected sources the answer cited, capped at 3.
- **Topic coverage** (0..3) — fraction of expected topics the answer mentions, capped at 3.
- **Citation quality** (0..2) — 2 if `[n]` markers are inline-attached to claims, 1 if citations exist without inline markers, 0 if none.
- **Enum fidelity** (0..1) — 1 if `|answer - expectedEnumCount| <= enumTolerance`, else 0.

Aggregate pass rate = % of cases scoring >= 6/9.

Run with: `npm run eval`. Output: a markdown report in `evals/reports/`.

---

## 8. Test Strategy

| Layer | Files | Mocks | Goal |
|---|---|---|---|
| **Unit (pure)** | `chunk.test.ts`, `prompt.test.ts`, `retrieve.test.ts`, `embed.test.ts` | none | Logic correctness, edge cases. |
| **Unit (I/O)** | `vector/in-memory.test.ts`, `vector/pg.test.ts` | pg via TEST_PG_URL or in-memory | Contract conformance. |
| **Integration** | `api-chat.test.ts`, `ingest.test.ts` | MSW intercepts Voyage + Anthropic | Full request/response, no real network. |
| **E2E** | `e2e/chat.spec.ts` | none (real services via env) | Browser smoke: page loads, message streams, citation renders. |

**Mocking external APIs (CRITICAL):**
- `tests/setup.ts` boots an MSW server before Vitest.
- `tests/handlers.ts` defines `http.post('https://api.voyageai.com/v1/embeddings')` and `http.post('https://api.anthropic.com/v1/messages')` with realistic canned responses (including SSE for Anthropic).
- `scripts/mock-server.ts` re-exports the same handlers for `next dev` to use when `MOCK=1` — that's how we hit "no API keys" local dev.
- Each handler asserts on the request body so we catch accidental payload changes.

**Why MSW over vi.mock:** MSW catches regressions in the actual HTTP serialization (URL, headers, body shape). `vi.mock` would let a developer "fix" a test by stubbing out the wrong thing.

---

## 9. Logging Strategy

**Library:** `pino` with `pino-pretty` in dev.

**Format:** JSON in prod, pretty in dev. Always structured — no template strings.

**Levels:**
- `trace` — full retrieval candidate list (dev only, never in prod).
- `debug` — chunk IDs, scores, embed batch sizes.
- `info` — request lifecycle: `chat.start`, `retrieval.final`, `chat.end` with token counts and latency.
- `warn` — low-confidence retrieval (top score < 0.6), empty retrieval.
- `error` — exceptions, Anthropic/Voyage 5xx, pg connection failures.

**Where we log every key operation:**
- `route.ts` — `chat.start`, `chat.end` with sessionId, msgCount, latencyMs.
- `retrieve.ts` — `retrieval.candidates` (debug), `retrieval.final` (info).
- `embed.ts` — `embed.batch` (debug) with model, batchSize, latencyMs.
- `streaming.ts` — `stream.firstToken` (debug, sampled 1/100), `stream.complete` (info).
- `ingest.ts` — per-source `ingest.source` (info), per-batch `ingest.batch` (debug), summary `ingest.complete` (info).

**Correlation:** Every log line carries `sessionId` and a generated `requestId` (UUID v4) threaded through the request lifecycle.

**Why not `console.log`:** Unstructured, no levels, no correlation, painful to query in Vercel logs.

---

## 10. Environment Variables

| Var | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | prod | Claude API key. |
| `VOYAGE_API_KEY` | prod | Voyage AI key. |
| `POSTGRES_CONNECTION_STRING` | prod | Supabase connection string. |
| `POSTGRES_CONNECTION_STRING` (no Supabase) | optional | Any pgvector instance. |
| `VECTOR_BACKEND` | optional | `pg` (default in prod) \| `memory` (default in dev). |
| `MOCK` | optional | `1` forces MSW handlers in dev — the "no keys" path. |
| `LOG_LEVEL` | optional | `trace`/`debug`/`info`/`warn`/`error`. Default: `info` prod, `debug` dev. |
| `MODEL_ID` | optional | Default `claude-sonnet-4-5`. |

Validated at boot by `src/lib/env.ts` (Zod). Missing required var → fail fast with a clear message.

---

## 11. Local Dev Story (no external services)

```bash
git clone <repo>
cd eu-ai-act-expert
npm install
MOCK=1 npm run dev
```

What happens:
1. `VECTOR_BACKEND` defaults to `memory` because `POSTGRES_CONNECTION_STRING` is unset.
2. `lib/vector/index.ts` returns the in-memory store pre-seeded from `src/lib/vector/fixtures.ts` (the 10 hand-written EU AI Act fixture Q&A so retrieval has something to find).
3. The route handler detects `MOCK=1` and uses MSW handlers for Voyage + Anthropic. The Anthropic handler streams a canned response that includes inline citation markers and a final `data-source` part.
4. The UI works end-to-end: type a question, see a streamed answer, see citations.

**Why this matters:** A freelance evaluator can `git clone && npm install && npm run dev` and have something to click on in 60 seconds with no signup.

---

## 12. Deployment (Vercel + Supabase)

1. **Supabase**:
   1. Create project, note the connection string.
   2. In SQL editor, run `supabase/migrations/0001_init.sql` then `0002_hnsw_index.sql`.
   3. (Optional) Run `supabase/seed.sql` for the 10 canonical Q&A.
2. **GitHub**: Push repo.
3. **Vercel**:
   1. Import repo, framework preset = Next.js.
   2. Add env vars: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `POSTGRES_CONNECTION_STRING`, `VECTOR_BACKEND=pg`, `LOG_LEVEL=info`.
   3. Deploy. Vercel auto-assigns a domain.
4. **Ingest prod corpus**:
   ```bash
   POSTGRES_CONNECTION_STRING=... VOYAGE_API_KEY=... npm run ingest
   ```
   (Run once locally pointed at the prod DB, or wrap in a one-off Vercel function.)
5. **Smoke test**: Open the deployed URL, ask "What does Article 6 say about high-risk classification?" — verify a cited answer streams.

**Cost estimate (light traffic):** Supabase free tier covers a static site, Anthropic Sonnet ~$3/MTok input, Voyage ~$0.06/MTok. A 100-message demo session is well under $1.

---

## 13. Stretch Goals (out of scope for v1)

- Conversation memory (key-value store on `sessionId`, or upgrade to a vector memory lib).
- Re-ranking with Cohere Rerank v3 as an A/B test against the current cross-encoder.
- Streaming of source *titles* before full text so the citation panel populates progressively.
- Public `/api/eval` endpoint for live eval scores.
- Multi-language ingest (DE/FR/EU AI Act translations) with a language-aware embedder.

---

## 14. Open Questions

- Should we add a multi-step retrieval (decompose the question, retrieve per sub-question, re-aggregate) for complex multi-Article queries? (Nice for portfolio; doubles the surface area.)
- Voyage model dimension choice: stick with 1024 (default) for accuracy, or drop to 256 (1/4 storage) given our small corpus? **Defaulting to 1024** until evals say otherwise. Also: `voyage-law-2` is on the table as a more semantically accurate embedder for legal text — would need a fresh ingest to compare.

