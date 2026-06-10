# eu-ai-act-expert

> A production-grade RAG chatbot that answers questions about **Regulation (EU) 2024/1689** — the EU AI Act. Built as a freelance portfolio piece: clean code, real evals, deployable to Vercel + Supabase.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node 20](https://img.shields.io/badge/node-20-brightgreen.svg)](./.nvmrc)
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue.svg)](./tsconfig.json)

---

## Why this project exists

Most "legal-tech AI demos" stop at "I pasted the regulation into a vector DB and asked a question." This project goes the full distance:

- **End-to-end RAG** over the EU AI Act — Articles, Recitals, Annexes, and Commission guidance — with **grounded cited answers** (each claim maps to a specific Article or Recital).
- **20 hand-written eval questions** covering risk classification, provider/deployer obligations, high-risk requirements, transparency, GPAI, timeline, enforcement, conformity assessment, GDPR cross-references, and post-market monitoring.
- **Tuned for legal Q&A**: the system prompt is conservative (refuses when no context matches), cites Article and Recital numbers inline, and never speculates on legal interpretation.
- **Two run modes**: real (Voyage + Anthropic + pgvector) and **local-only** (no API keys, in-memory vector store, hash-based local embedder) so anyone can `git clone && npm install && npm run dev` and see a working chat in 60 seconds.
- **Production observability** with pino structured logs at every key operation.

---

## Features

- Cited, streaming chat UI (Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui, Framer Motion).
- RAG over Regulation (EU) 2024/1689: 113 Articles + 180 Recitals + 13 Annexes + 4 Commission guidance pages.
- Voyage AI `voyage-code-3` embeddings (1024 dims) — chosen for code-shaped retrieval; the regulation is dense with cross-references that benefit from strong embeddings.
- Supabase pgvector for storage with an in-memory fallback (seeded with 10 hand-written fixture Q&As) for dev.
- Anthropic Claude (Sonnet) for generation with prompt caching on the system + retrieved context.
- 20-case eval set with `source accuracy + topic coverage + citation quality` scoring.
- Vercel + Supabase deploy in under 10 minutes.
- Local-only mode: `npm install && npm run dev` works with zero API keys, zero signup.

---

## Quickstart (60 seconds, no API keys)

```bash
git clone <repo>
cd eu-ai-act-expert
nvm use            # Node 20
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and ask a question. The app:

1. Uses an **in-memory vector store** seeded with hand-written EU AI Act fixture Q&As.
2. Uses a **deterministic hash-based local embedder** (no Voyage key needed).
3. Falls back to a **mock LLM stream** that synthesizes a cited answer from the retrieved chunks.

You'll see a streamed, cited answer on every question. Quality is degraded compared to the real path (no real LLM, no semantic embeddings) but the full UI/UX works end-to-end.

### Run with real services

Copy `.env.example` to `.env.local` and fill in the keys you have:

```bash
cp .env.example .env.local
# Set ANTHROPIC_API_KEY and VOYAGE_API_KEY at minimum.
```

Start the dev server normally:

```bash
npm run dev
```

When `POSTGRES_CONNECTION_STRING` is unset, the app uses the in-memory vector store. To populate it from the real regulation:

```bash
npm run ingest -- --source=docs --dry-run      # scrape + chunk, skip embed/upsert
npm run ingest -- --source=docs                # fetch the Articles + Recitals
npm run ingest -- --source=source              # fetch the 13 Annexes
npm run ingest -- --source=issues              # fetch Commission guidance + FAQ
npm run ingest                                  # all four tiers
```

For pgvector in production, set `VECTOR_BACKEND=pg` and point `POSTGRES_CONNECTION_STRING` at a real pgvector instance (Supabase is the documented choice).

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server. Uses local-only mode if no API keys are set. |
| `npm run build` | Production build. Must succeed for deploy. |
| `npm run start` | Run the production build locally. |
| `npm run typecheck` | `tsc --noEmit` (strict mode). |
| `npm test` | Vitest unit + integration tests. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run test:e2e` | Playwright end-to-end. |
| `npm run ingest` | Build the vector store from `data-sources.md`. |
| `npm run ingest -- --dry-run --source=docs` | Scrape + chunk, skip embed/upsert. |
| `npm run eval` | Run the 20-case eval set against a live `/api/chat` and write a report. |
| `npm run eval -- --mock` | Run the eval against the in-process mock adapter (no server needed). |
| `npm run eval -- --url <host>` | Run the eval against a deployed instance. |

---

## Architecture

The full design doc — stack decisions, data flow, knowledge base, eval set design, test strategy, logging levels, and deploy runbook — lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md). Read it before contributing.

The shape of every payload that crosses the network boundary is centralized in [`api-contract.ts`](./api-contract.ts). If you change a type there, the route handler, the UI, the tests, and the eval runner all get caught by the compiler.

### Layout

```
eu-ai-act-expert/
├── ARCHITECTURE.md           # Stack rationale, data flow, eval set, deploy.
├── README.md                 # This file.
├── data-sources.md           # Every URL we ingest to build the vector store.
├── api-contract.ts           # Shared TS types for the HTTP boundary.
├── evals/                    # 20 Q&A cases, scorer, runner, reports.
│   ├── questions.json
│   ├── questions.schema.json
│   ├── scorer.ts
│   ├── run.ts
│   └── reports/              # latest.md + timestamped history.
├── scripts/                  # Thin wrapper around src/ingestion/cli.ts.
├── src/
│   ├── app/                  # Next.js App Router (layout, page, api/chat).
│   ├── components/           # chat/* + ui/* + motion/*.
│   ├── lib/                  # rag/embed, vector/{in-memory,fixtures}, anthropic, env, logger.
│   ├── backend/              # RAG pipeline (retrieval, prompt, generation, citations) + api/chat/route.
│   ├── ingestion/            # Scrapers, chunker, embedder, pipeline, cli.
│   └── test/                 # Setup + helpers.
├── supabase/migrations/      # 0001_init.sql, 0002_hnsw_index.sql, seed.sql.
└── tests/                    # unit/, backend/, ingestion/, ui/.
```

---

## Local-only mode: how it works

The "no API keys" path is a deliberate, testable fallback so the dev experience is positive on a fresh clone. Three pieces:

1. **Embedder** (`src/lib/rag/embed.ts`) — when no `VOYAGE_API_KEY` and no `OPENAI_API_KEY` is set, `embed()` returns a deterministic hash-based vector (256-dim) derived from a bag-of-tokens representation. The same input always produces the same vector; related inputs share tokens and therefore share vector space.
2. **Vector store** (`src/lib/vector/`) — the factory defaults to `InMemoryVectorStore`, pre-seeded at construction with a hand-written corpus of 10 EU AI Act fixture documents (`src/lib/vector/fixtures.ts`). The corpus covers definitions, risk classification, provider/deployer obligations, GPAI, transparency, enforcement, and post-market monitoring. Vectors for fixtures are produced by the same local embedder so retrieval actually works.
3. **LLM** (`src/backend/rag/generation.ts`) — when `hasAnthropicCredentials()` is false and `MOCK !== "1"`, `generate()` returns a hand-crafted `UIMessageStream` that synthesizes a cited answer from the retrieved chunks. The stream is wire-compatible with the real one — same `text-delta` / `data-sources` / `finish` events — so the UI's streaming UX is exercised end-to-end.

When the user provides an Anthropic key, the mock path is bypassed automatically and `streamText` with the real Claude model is used.

---

## Deploy

Same shape as a typical Next.js + Supabase + Vercel stack: create a Supabase project, run the two migrations, push the repo to GitHub, import in Vercel, set the env vars, deploy, run `npm run ingest` once to populate the vector store. ~10 minutes.

---

## A note on what this is and isn't

This is a **retrieval and summarization tool**, not legal advice. The system prompt instructs the model to:

- Quote only what is in the regulation text.
- Cite specific Article and Recital numbers.
- Refuse ("The provided context does not address that") when the question is outside the corpus.
- Distinguish what the Act explicitly says (Articles) from background rationale (Recitals).

It does **not**:

- Offer legal opinions or advice.
- Compare the EU AI Act to other jurisdictions' AI laws.
- Predict how the AI Office or member-state authorities will enforce.
- Track ongoing guidance from the EDPB or member-state AI Offices in real time.

For anything beyond orientation, consult a qualified EU regulatory lawyer.

---

## License

[MIT](./LICENSE). See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for contribution conventions.

---

## Acknowledgments

- The European Commission's DG CNECT for the AI Act text, the AI Act Service Desk, and the "Navigating the AI Act" FAQ.
- The Future of Life Institute for the [artificialintelligenceact.eu](https://artificialintelligenceact.eu) mirror, which makes per-Article scraping reliable.
- [Voyage AI](https://voyage.ai) for `voyage-code-3` and the code-retrieval benchmark.
- [Anthropic](https://anthropic.com) for Claude and prompt caching.
- [Supabase](https://supabase.com) for pgvector + a generous free tier.
- [shadcn/ui](https://ui.shadcn.com) for the component primitives.
- [Vercel](https://vercel.com) for the deploy platform.
