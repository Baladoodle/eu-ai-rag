# Data Sources — Knowledge Base for eu-ai-act-expert

> Every URL and file path the ingest script (`scripts/ingest.ts`) reads to build the vector store. The list is the source of truth: change a URL here, re-run ingest, and the eval set will measure the impact.

---

## Domain

This project is a RAG chatbot over **Regulation (EU) 2024/1689** — the EU AI Act, in force since 1 August 2024 and applicable on a phased schedule from 2 February 2025 onward. The corpus covers:

1. The Act itself — Articles (1-113), Recitals (1-180), Annexes (I-XIII).
2. Commission guidance and FAQ — plain-language explanations published by the European Commission's DG CNECT.

It does **not** cover: case law (post-application, not yet decided), national implementing legislation (member-state specific), or member-state AI Office guidance (still being published as of this writing).

---

## Ingestion strategy

1. **For each entry below**, the script:
   1. Fetches the URL (HTTP GET, follow redirects, polite User-Agent).
   2. Strips navigation, footer, sidebars using a Readability-style extractor.
   3. Converts the remaining HTML to plain text/markdown.
   4. Yields the text to `MDocument.fromText().chunk({ strategy: 'recursive', size: 1024, overlap: 128 })`.
   5. Embeds each chunk with `voyage-code-3` (dim 1024, float).
   6. Upserts into the `pgVector` store with metadata `{ sourceId, url, title, section, chunkIndex, ingestedAt }`.

2. **Source IDs** are formed as `ai-act/<unit>-<n}` for the Act, e.g. `ai-act/article-3`, `ai-act/recital-10`, `ai-act/annex-3`. Guidance pages use a slug, e.g. `ai-act/ec-faq-navigating-ai-act`.

3. **Idempotency**: chunks are keyed by `sha256(sourceId + chunkIndex)`. Re-ingesting the same content is a no-op.

4. **Chunking strategy** (this differs from the generic Mastra corpus because legal text has natural boundaries):
   - Each Article is one source document. Long Articles (>1024 tokens) are paragraph-chunked with overlap, but the first chunk is always the article heading.
   - Each Recital is one source document (recitals are short — usually 50-200 words each).
   - Each Annex is one source document. Annex III (the high-risk use case list) is item-chunked.
   - Each Commission FAQ / guidance page is one source document, paragraph-chunked.

5. **Refresh cadence**: EUR-Lex / the Commission's mirror pages change rarely (a corrigendum every few months). Manual re-ingest is sufficient; no scheduled job in v1.

---

## Tier 1 — Always ingest (canonical Regulation text)

These are the Articles and Recitals of the Act itself. The scraper in `src/ingestion/scrapers/docs.ts` reads from `https://artificialintelligenceact.eu/`.

| Source ID prefix | URL pattern | Why |
|---|---|---|
| `ai-act/article-N` | `https://artificialintelligenceact.eu/article/{N}/` for N = 1..113 | The 113 Articles are the operative text. Each page is one Article. |
| `ai-act/recital-N` | `https://artificialintelligenceact.eu/recital/{N}/` for N = 1..180 | The 180 Recitals give the rationale. Each page is one Recital. |

**Why `artificialintelligenceact.eu` instead of EUR-Lex?**
- EUR-Lex is the authentic source but the HTML is monolithic (one giant document) with anchor IDs that change between OJ versions. Scraping it requires parsing ~1500 paragraphs of legal text to recover the Article boundaries.
- `artificialintelligenceact.eu` is a community-maintained mirror (run by the Future of Life Institute) that exposes one Article per page with a stable URL pattern. The text is semantically identical to the EUR-Lex consolidated version.
- Both sources are stored in the metadata (`origin: 'artificialintelligenceact.eu'`, `canonical: 'https://eur-lex.europa.eu/...CELEX:32024R1689'`) so the user can verify against the authentic text via the canonical URL.

> **Action for ingest script**: walk the article and recital lists in `docs.ts` (113 articles, 180 recitals). The CLI flag is `--source=docs`.

---

## Tier 2 — Annexes (structured appendices to the Act)

The 13 Annexes contain the lists, criteria, and procedural detail that the Articles reference. The scraper in `src/ingestion/scrapers/source.ts` (kept under the `source` name for backward compatibility) reads from the Commission's AI Act Service Desk.

| Source ID prefix | URL pattern | Why |
|---|---|---|
| `ai-act/annex-N` | `https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-{N}` for N = 1..13 | Each Annex is its own page. N is 1-13 (Roman I-XIII). |

The 13 Annexes:
- **Annex I** — Union harmonisation legislation
- **Annex II** — Information for high-risk AI system registration
- **Annex III** — High-risk use cases (the long list everyone cites; ~50 bullet items)
- **Annex IV** — Technical documentation requirements for high-risk AI systems
- **Annex V** — EU Declaration of Conformity template
- **Annex VI** — Conformity assessment (internal control)
- **Annex VII** — Conformity assessment (QM system + tech doc)
- **Annex VIII** — Registration information
- **Annex IX** — Registration info for Annex III systems
- **Annex X** — Union fundamental rights legislation
- **Annex XI** — GPAI model technical documentation
- **Annex XII** — Transparency information for deployers
- **Annex XIII** — Criteria for designation of high-risk AI systems

> **Action for ingest script**: scrape all 13 annexes. CLI flag: `--source=source`.

---

## Tier 3 — Commission guidance and FAQ

Plain-language Q&A published by the European Commission's DG CNECT (Communications Networks, Content and Technology). The scraper in `src/ingestion/scrapers/issues.ts` (kept under the `issues` name for backward compatibility) reads these.

| Source ID | URL | Why |
|---|---|---|
| `ai-act/ec-faq-navigating-ai-act` | https://digital-strategy.ec.europa.eu/en/faqs/navigating-ai-act | The official "Navigating the AI Act" FAQ — 27 Q&A pairs. |
| `ai-act/ec-regulatory-framework` | https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai | The Commission's overview of the regulatory framework. |
| `ai-act/ec-gpai-code-of-practice` | https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai | The Code of Practice for GPAI models. |
| `ai-act/ec-service-desk-home` | https://ai-act-service-desk.ec.europa.eu/en | The AI Act Service Desk landing page. |

> **Action for ingest script**: scrape all 4 pages. CLI flag: `--source=issues`.

---

## Sources we deliberately do NOT ingest (v1)

- **EDPB opinions and guidelines on AI.** The EDPB document index is unstable (404s on the public URL during our investigation). When EDPB publishes a stable AI Act landing page, add it to Tier 3.
- **AI Office and Code of Practice PDFs.** The Code of Practice is published in pieces; we ingest the summary page and let the user follow links to the PDF.
- **Member-state national AI Offices.** Too heterogeneous for v1; revisit when at least 5 member states have stable English-language guidance.
- **Academic papers and law-review articles.** Out of scope; the chatbot is a regulation Q&A, not a legal-research tool.
- **EUR-Lex raw HTML.** Too monolithic to chunk cleanly. We use the mirror (`artificialintelligenceact.eu`) for ingestion and link to the EUR-Lex canonical URL in the metadata for verification.

---

## How to add a new source

1. Add a row to the appropriate tier table above.
2. Add a constant entry to the relevant scraper (`docs.ts`, `source.ts`, or `issues.ts`).
3. Re-run `npm run ingest` — the script picks up the new URL.
4. Add at least one eval case to `evals/questions.json` that targets it (otherwise we have no way to know if the new source helped).
5. Re-run `npm run eval -- --mock` and check the report.

---

## Local fixtures (always available, no fetch required)

For the "no API keys" dev path, `src/lib/vector/fixtures.ts` ships a small hand-curated corpus of 10 EU AI Act Q&A chunks. These are paraphrased from the official text — accurate on substance, written in our own words so we don't ship copyrighted material.

This is **not** the production knowledge base — it's a development convenience so `MOCK=1 npm run dev` produces useful demo answers. Production ingest pulls the full Article/Recital/Annex corpus.
