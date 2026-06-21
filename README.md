# eu-ai-act-expert

A RAG chatbot that answers questions about the **EU AI Act** (Regulation (EU) 2024/1689) with cited, grounded responses.

Built with Next.js 16, Mastra (chunking + vector store), Voyage AI's `voyage-law-2` embeddings, pgvector, and Claude.

## Quickstart

```bash
npm install
cp .env.example .env.local      # works as-is with MOCK=1
npm run dev
```

Open <http://localhost:3000>.

No API keys required — by default `MOCK=1` short-circuits Anthropic + Voyage so you can poke at the UI. To hit real models, set `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` in `.env.local` and remove `MOCK=1`.

## What it does

- Streams grounded answers about the EU AI Act.
- Cites the specific Article, Recital, or Annex for every claim.
- Refuses when retrieval returns nothing relevant.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm run test` | Vitest unit + integration |
| `npm run test:e2e` | Playwright smoke test |
| `npm run ingest` | Rebuild the knowledge base from `data-sources.md` |
| `npm run eval` | Run the eval suite against the current model |
| `npm run eval:mock` | Same, with mocked responses |

## Deploy

Vercel + Supabase, ~10 minutes. See [DEPLOY.md](./DEPLOY.md).

## How it works (short version)

1. `npm run ingest` scrapes EUR-Lex, chunks with Mastra, embeds with Voyage, stores in pgvector.
2. `POST /api/chat` retrieves the top-k chunks, sends them + the question to Claude, and streams the response with inline citations.

The full architecture write-up — including why each library is chosen — lives in [ARCHITECTURE.md](./ARCHITECTURE.md). The eval methodology is in [`evals/`](./evals/).

## Project layout

```
src/app/         Next.js App Router (chat UI + /api/chat route)
src/backend/     Retrieval, prompt assembly, citation logic
src/ingestion/   Scrape → chunk → embed → upsert pipeline
src/lib/         Env, logger, vector store adapter
tests/           unit / integration / e2e
evals/           Question bank + scoring
scripts/         CLI entrypoints
```

## License

[MIT](./LICENSE)
