# Data Sources — Knowledge Base for mastra-expert

> Every URL and file path the ingest script (`scripts/ingest.ts`) reads to build the vector store. The list is the source of truth: change a URL here, re-run ingest, and the eval set will measure the impact.

---

## Ingestion strategy

1. **For each entry below**, the script:
   1. Fetches the URL (HTTP GET, follow redirects, respect `robots.txt`).
   2. Strips navigation, footer, sidebars using a Readability-style extractor.
   3. Converts the remaining HTML/markdown to plain text.
   4. Yields the text to `MDocument.fromText().chunk({ strategy: 'recursive', size: 1024, overlap: 128 })`.
   5. Embeds each chunk with `voyage-code-3` (dim 1024, float).
   6. Upserts into the `pgVector` store with metadata `{ sourceId, url, title, section, chunkIndex, ingestedAt }`.

2. **Source IDs** are formed as `{namespace}/{slug}#{chunkIndex}`, e.g. `mastra-docs/rag/overview#3`. The chunk index is zero-based.

3. **Idempotency**: chunks are keyed by `sha256(sourceId + chunkIndex)`. Re-ingesting the same content is a no-op.

4. **Refresh cadence**: documented sources (`mastra.ai/docs/*`) are re-ingested on every CI run via a scheduled GitHub Action (out of scope for v1, but the script supports a `--since` flag).

---

## Tier 1 — Always ingest (canonical Mastra knowledge)

These are the authoritative documentation pages. Ingestion script reads from `https://mastra.ai/docs/<path>`.

| Source ID prefix | URL | Why |
|---|---|---|
| `mastra-docs/landing` | https://mastra.ai/docs | The single-page summary. Useful for "what is Mastra" questions. |
| `mastra-docs/rag/overview` | https://mastra.ai/docs/rag/overview | **Highest priority.** The RAG mental model. Most "how does RAG work in Mastra" questions should hit this. |
| `mastra-docs/rag/vector-databases` | https://mastra.ai/docs/rag/vector-databases | Vector store setup, supported backends, `createIndex`/`upsert` signatures. |
| `mastra-docs/rag/retrieval` | https://mastra.ai/docs/rag/retrieval | Retrieval API, metadata filters, rerankers, `createVectorQueryTool`. |
| `mastra-docs/agents/overview` | https://mastra.ai/docs/agents/overview | Agent runtime, tool use, model routing. |
| `mastra-docs/workflows/overview` | https://mastra.ai/docs/workflows/overview | Graph workflow engine. |
| `mastra-docs/storage/overview` | https://mastra.ai/docs/storage/overview | Conversation memory, storage adapters. |
| `mastra-docs/deployment/overview` | https://mastra.ai/docs/deployment/overview | Production deployment guidance. |
| `mastra-docs/integrations/overview` | https://mastra.ai/docs/integrations/overview | Available integrations catalog. |
| `mastra-docs/observability/overview` | https://mastra.ai/docs/observability/overview | Logging, tracing, evals. |
| `mastra-docs/voice/overview` | https://mastra.ai/docs/voice/overview | TTS / voice capabilities. |

> **Action for ingest script**: walk the docs sitemap (https://mastra.ai/docsitemap.xml if available) and ingest every page under `/docs/`. The table above is the explicit minimum; everything else is bonus.

---

## Tier 2 — GitHub repo source files (code-level signal)

The chatbot is for *developers using* Mastra, so API signatures and code examples are first-class knowledge. We clone the repo to `/.cache/repo` (gitignored, regenerated on every ingest) and ingest specific paths.

**Repo:** `https://github.com/mastra-ai/mastra` (default branch, tag pinned via `MASTRA_REF` env var, default = latest release).

### README files (always ingest)
| Path in repo | Why |
|---|---|
| `README.md` | High-level overview, install commands, links. |
| `AGENTS.md` | How the Mastra maintainers expect AI agents to work with the repo. Surprising source of curated API knowledge. |
| `CLAUDE.md` | Same as above but for Claude. |
| `packages/core/README.md` | Public surface of `@mastra/core`. |
| `packages/rag/README.md` | Public surface of `@mastra/rag`. |
| `packages/pg/README.md` | Public surface of `@mastra/pg` (PgVector). |
| `packages/cli/README.md` | The `create-mastra` CLI. |
| `packages/deployer/README.md` | Deployment helpers. |

### Source files (ingest, but cap at 50KB each)

These are the files we want the chatbot to be able to reference for exact API shapes. We extract the JSDoc + exported symbols, not the full implementation.

| Path in repo | Why |
|---|---|
| `packages/rag/src/index.ts` | Top-level exports of `@mastra/rag`. |
| `packages/rag/src/document.ts` | `MDocument` implementation. |
| `packages/rag/src/chunk/index.ts` | Chunking strategies. |
| `packages/rag/src/embeddings/index.ts` | `embedMany`, embedding model routing. |
| `packages/rag/src/rerank/index.ts` | Re-ranking API. |
| `packages/pg/src/vector.ts` | `PgVector` class. |
| `packages/pg/src/index.ts` | Public exports. |
| `packages/core/src/llm/model/router.ts` | `ModelRouterEmbeddingModel`. |
| `packages/core/src/agent/index.ts` | Agent class. |
| `packages/core/src/tools/vector-query.ts` | `createVectorQueryTool`. |

> **Note**: extract only top-level exports and JSDoc, not private helpers. The eval set will tell us if we missed important symbols.

### Top issues (ingest, but only first post + maintainer replies)

| Path | Why |
|---|---|
| `https://github.com/mastra-ai/mastra/issues?q=is%3Aissue+sort%3Areactions-+desc` | The top 50 most-thumbs-up'd issues represent real developer questions. |
| `https://github.com/mastra-ai/mastra/discussions?discussions_q=sort%3Atop` | Top 20 discussions. |

> We ingest only the original post + any `answer` from a maintainer. This is the "voice of the developer" tier.

---

## Tier 3 — Auxiliary (ingest only if bandwidth allows)

| Source | Why |
|---|---|
| `https://mastra.ai/blog` index page | High-signal product announcements. |
| `https://www.youtube.com/@mastra-ai` transcripts | Walkthroughs. Optional; requires a transcript extraction step. |
| `https://discord.gg/mastra` pinned messages | Community FAQ. **Skip for v1** — auth required, formatting is messy. |

---

## How to add a new source

1. Add a row to the appropriate tier table above.
2. Re-run `npm run ingest` — the script picks up the new URL.
3. Add at least one eval case to `src/lib/data/fixtures.ts` that targets it (otherwise we have no way to know if the new source helps).
4. Re-run `npm run eval` and check the report.

---

## What we deliberately do NOT ingest

- **The whole GitHub repo.** The noise from `node_modules`-style test fixtures drowns the signal. The 10 specific files in Tier 2 were chosen by hand.
- **NPM package pages.** `npm view` metadata is fine, but the long auto-generated READMEs are duplicated content with the GitHub README.
- **Random blog posts / Hacker News threads.** The signal-to-noise ratio is too low for v1.

---

## Local fixtures (always available, no fetch required)

For the "no API keys" dev path, `src/lib/data/fixtures.ts` ships a small hand-curated corpus (10–15 chunks) covering the most common Mastra questions. This is **not** the production knowledge base — it's a development convenience so `MOCK=1 npm run dev` produces useful demo answers.
