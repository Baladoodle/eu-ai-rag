# mastra-expert

> A production-grade RAG chatbot that answers developer questions about the [Mastra AI framework](https://mastra.ai). Built as a freelance portfolio piece: clean code, real evals, deployed on Vercel + Supabase.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node 20](https://img.shields.io/badge/node-20-brightgreen.svg)](./.nvmrc)
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue.svg)](./tsconfig.json)

**Live demo** — [mastra-expert.vercel.app](https://mastra-expert.vercel.app) _(placeholder — set after first deploy, see [DEPLOY.md](./DEPLOY.md))_

---

## Why this project exists

Most "RAG demos" stop at "I pasted some docs into a vector DB and asked a question." This project goes the full distance:

- **End-to-end RAG** with real retrieval, real reranking, and **grounded cited answers** ([1] chips in the UI, source list in the side panel).
- **20 hand-written eval questions** with deterministic scoring (`source accuracy`, `topic coverage`, `citation quality`) so we know if changes help or hurt.
- **Two run modes**: real (Voyage + Anthropic + pgvector) and **mock** (`MOCK=1` works with zero API keys) so anyone can `git clone && npm run dev` and see something working in 60 seconds.
- **Production observability** with pino structured logs at every key operation.
- **Meta angle**: the project is itself built on Mastra's RAG primitives — strongest possible credibility signal for AI consulting work.

---

## Features

- Cited, streaming chat UI (Next.js 15 App Router, React 19, Tailwind v4, shadcn/ui, Framer Motion).
- Mastra's `MDocument` for recursive chunking (size 1024, overlap 128).
- Voyage AI `voyage-code-3` embeddings (1024 dims) — chosen for code-shaped retrieval.
- Supabase pgvector for storage with an in-memory fallback for dev.
- Re-ranking with `MastraAgentRelevanceScorer` (top 10 → top 5).
- Anthropic Claude (Sonnet) for generation with prompt caching on the system + retrieved context.
- 20-case eval set with `source accuracy + topic coverage + citation quality` scoring.
- Vercel + Supabase deploy in under 10 minutes (full guide in [DEPLOY.md](./DEPLOY.md)).
- `MOCK=1` mode: runs end-to-end with no API keys, no Postgres, no signup.

---

## Screenshots

> _Coming soon — add `public/og.png` + a chat screenshot in `docs/`._

<!-- TODO: add real screenshots before first deploy -->

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router | First-class streaming + RSC for the chat shell. |
| AI | Mastra (`@mastra/rag`, `@mastra/pg`) | The topic of the chatbot. Dogfooding is a portfolio signal. |
| LLM | Claude Sonnet (Anthropic SDK + prompt caching) | Strongest code reasoning in the mid-tier. |
| Embeddings | Voyage AI `voyage-code-3` | Code-shaped retrieval beats general models. |
| Vector store | pgvector (Supabase prod, in-memory dev) | One DB, one backup story, free tier covers a portfolio site. |
| UI | Tailwind v4 + shadcn/ui + Framer Motion | Audit-friendly components, intentional motion. |
| Logging | pino (structured JSON) | Vercel log drain compatible. |
| Testing | Vitest + MSW + Playwright | Network-level mocks for Anthropic + Voyage. |

Full rationale with alternatives considered: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Architecture

The full design doc — stack decisions, data flow, knowledge base, eval set, test strategy, logging levels, and deploy runbook — lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md). Read it before contributing.

The shape of every payload that crosses the network boundary is centralized in [`api-contract.ts`](./api-contract.ts). If you change a type there, the route handler, the UI, the tests, and the eval runner all get caught by the compiler.

---

## Setup (local dev)

### Prerequisites

- **Node 20** (we ship a `.nvmrc` — `nvm use`).
- **npm 10+**.
- For the **mock path**: nothing else. Zero API keys, zero signup.
- For the **live path**: an Anthropic API key, a Voyage AI API key, and (optionally) a Supabase / pgvector instance.

### Install and run

```bash
nvm use
npm install

# Zero-config path: in-memory vector store + MSW-mocked LLM/embeddings.
MOCK=1 npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and ask a question. The mock adapter returns a deterministic answer with one citation, so you can see the full UI flow without any keys.

### Run with real services

Copy `.env.example` to `.env.local` and fill in the keys you have:

```bash
cp .env.example .env.local
# Then edit .env.local and set ANTHROPIC_API_KEY, VOYAGE_API_KEY, etc.
```

Start the dev server normally:

```bash
npm run dev
```

When `POSTGRES_CONNECTION_STRING` is unset, the app uses the in-memory vector store (which is empty until you run ingest). To populate it:

```bash
# Pulls sources from data-sources.md, chunks, embeds, and upserts.
npm run ingest
```

If you skip the in-memory store, set `VECTOR_BACKEND=pg` and point `POSTGRES_CONNECTION_STRING` at a real pgvector instance.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server. |
| `npm run build` | Production build. |
| `npm run start` | Run the production build locally. |
| `npm run lint` | ESLint (Next + project config). |
| `npm run typecheck` | `tsc --noEmit` (strict mode). |
| `npm test` | Vitest unit + integration tests. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run test:e2e` | Playwright end-to-end. |
| `npm run ingest` | Build the vector store from `data-sources.md`. |
| `npm run eval` | Run the 20-case eval set and write a report to `evals/reports/`. |
| `npm run eval -- --mock` | Run the eval against the in-process mock adapter (no server needed). |
| `npm run eval -- --url <host>` | Run the eval against a deployed instance. |

---

## Project structure

```
mastra-expert/
├── ARCHITECTURE.md           # Stack rationale, data flow, eval set design, deploy runbook.
├── README.md                 # This file.
├── DEPLOY.md                 # Vercel + Supabase deploy guide.
├── CONTRIBUTING.md           # Conventions for PRs.
├── LICENSE                   # MIT.
├── data-sources.md           # Every URL we ingest to build the vector store.
├── api-contract.ts           # Shared TS types for the HTTP boundary.
├── evals/                    # 20 Q&A cases, scorer, runner, reports.
│   ├── questions.json
│   ├── questions.schema.json
│   ├── scorer.ts
│   ├── run.ts
│   ├── README.md             # How to read the report.
│   └── reports/              # latest.md + timestamped history.
├── scripts/                  # One-off ops (ingest, eval, mock-server).
├── src/
│   ├── app/                  # Next.js App Router (layout, page, api/chat).
│   ├── components/           # chat/* + ui/* + motion/*.
│   ├── hooks/                # useChat.
│   ├── lib/                  # rag/, vector/, llm/, data/, logger, env.
│   └── test/                 # MSW handlers, helpers.
├── supabase/migrations/      # 0001_init.sql, 0002_hnsw_index.sql, seed.sql.
└── tests/                    # unit/, integration/, e2e/.
```

---

## Deploy

The full step-by-step is in [`DEPLOY.md`](./DEPLOY.md). TL;DR: create a Supabase project, run the two migrations, push the repo to GitHub, import in Vercel, set the env vars, deploy, run `npm run ingest` once to populate the vector store. ~10 minutes.

---

## License

[MIT](./LICENSE). See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for contribution conventions.

---

## Acknowledgments

- The [Mastra](https://mastra.ai) team for a well-documented framework that's pleasant to dogfood.
- [Voyage AI](https://voyage.ai) for `voyage-code-3` and the code-retrieval benchmark.
- [Anthropic](https://anthropic.com) for Claude and prompt caching.
- [Supabase](https://supabase.com) for pgvector + a generous free tier.
- [shadcn/ui](https://ui.shadcn.com) for the component primitives.
- [Vercel](https://vercel.com) for the deploy platform.
