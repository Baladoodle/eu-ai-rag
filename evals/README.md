# Evals — what we measure and how to read the report

> A beginner-friendly guide to the eval pipeline. If you've never built a
> RAG before, read this end-to-end before touching any code.

---

## What is an "eval" and why bother?

A **retrieval-augmented chatbot** has two moving parts:

1. **Retrieval** — find the right chunks of documentation to answer the question.
2. **Generation** — write a natural-language answer that uses those chunks and cites them.

Both can be bad in subtle ways. Retrieval can return plausible-looking chunks that don't actually answer the question. Generation can sound confident while ignoring the chunks entirely. Without measurement, you can't tell which part is broken, and you can't tell if your changes helped or hurt.

An **eval set** is a fixed list of questions with hand-written "expected answers". You run your system against every question, score the output, and look at the numbers. The numbers tell you what's working, what's broken, and where to focus your next improvement.

This is how we know our chatbot actually works — not because it "looks right" in a demo, but because it scores `82%` on a frozen test set.

---

## Files in this directory

| File | What it is |
|---|---|
| `questions.json` | The 20 hand-written Q&A cases. Each case has an ID, category, difficulty, the question, the URLs we expect to be cited, and the topics the answer should mention. |
| `questions.schema.json` | JSON Schema for the eval file. Useful for editor autocomplete. |
| `scorer.ts` | Pure scoring functions. Given a case + the chatbot's answer, return a 0..8 raw score and a 0..100 normalized score. No I/O. |
| `run.ts` | The CLI runner. Loads the cases, calls the chatbot (or a mock adapter), scores each one, writes a Markdown report. |
| `reports/` | Output directory. `latest.md` is overwritten on every run; `<timestamp>.md` files are immutable history. |

The blank report layout is reproduced at the end of this document (see "Report template" below) so you can read it side-by-side with a real run.

---

## The 20 questions

We wrote them after reading the actual [Mastra docs](https://mastra.ai/docs), so the answers are real developer questions, not synthetic.

### Category distribution (matches `ARCHITECTURE.md §7`)

| Category | Count | Examples |
|---|---|---|
| agents | 4 | "What is Mastra?", "How do I create a basic agent?" |
| rag | 5 | "What are the main steps in a RAG pipeline?", "How do I configure pgvector?" |
| workflows | 2 | "What is a step?", "How do I run steps in parallel?" |
| memory | 3 | "How does Mastra memory track conversations?", "What is working memory?" |
| tools | 1 | "How do I give an agent a custom tool?" |
| deployment | 1 | "Can I deploy to Vercel?" |
| integrations | 2 | "Which vector stores are supported?", "Which chunking strategies?" |
| general | 2 | "What is Mastra?", "How do I deploy a workflow with Inngest?" |

### Difficulty distribution

- **8 easy** — direct lookups ("What is a step?").
- **8 medium** — require combining two or three concepts ("How do I filter vector query results by metadata?").
- **4 hard** — multi-step or design-level ("Walk me through building a production RAG pipeline with custom embeddings, pgvector, and reranking").

---

## How we score each question (0..8 raw → 0..100 normalized)

The scorer lives in [`scorer.ts`](./scorer.ts). It's a pure module — no network, no logging, no side effects — so you can unit test it without any setup.

| Axis | Max points | What it measures |
|---|---|---|
| **Source accuracy** | 3 | How many of the `expectedSources` URLs appeared in the chatbot's citations. 1 point per match, capped at 3. We normalize URLs (strip fragments, lowercase) so a `https://mastra.ai/docs/rag/overview` citation matches an expected `https://mastra.ai/docs/rag/overview#chunk-3`. |
| **Topic coverage** | 3 | How many of the `expectedTopics` substrings appeared in the assistant's final answer (case-insensitive substring match). 1 point per match, capped at 3. |
| **Citation quality** | 2 | 2 = citations present AND at least one inline `[n]` marker in the answer text. 1 = citations present but no markers. 0 = no citations. |
| **Total** | 8 | Sum of the three axes. Normalized to 0..100 with `round((raw / 8) * 100)`. |

A case with `raw >= 5` (i.e. >= 62%) counts as a **pass**.

### Why this rubric and not "BLEU" or "embedding similarity"?

- **BLEU** measures n-gram overlap with a reference answer. It punishes valid paraphrases and rewards copying. Wrong tool for a chatbot.
- **Embedding similarity** to a reference answer is too lenient: a confident, fluent, *wrong* answer can score high because it's "close" in vector space.
- **LLM-as-judge** (asking another LLM to grade the answer on a 0..3 rubric) is more accurate but expensive and non-deterministic.

Our three-axis rubric is cheap, deterministic, and directly measures the three things a RAG user cares about: *did it find the right source? did it cover what I asked? did it show its work?*

---

## How to run the evals

```bash
# 1. Make sure the dev server is up and seeded.
npm run dev          # in one terminal
# ...or...
npm run dev -- -p 3000

# 2. Run the eval against the live route.
npm run eval

# OR: target a deployed instance.
npm run eval -- --url https://mastra-expert.vercel.app

# OR: use the in-process mock adapter (no server needed).
npm run eval -- --mock
```

CLI flags:

- `--url <host>` — base URL of the running app. Default `http://localhost:3000`.
- `--mock` — use a deterministic in-process adapter. Useful for CI or first-time setup.
- `--in <path>` — path to a questions file. Default `evals/questions.json`.
- `--out <dir>` — output directory for reports. Default `evals/reports/`.

The runner prints one line per case (`q01 ... 6/8 (75%)`) and finishes with a summary plus two files written to `evals/reports/`.

---

## How to read the report

Open `evals/reports/latest.md`. The structure is:

1. **Header** — when it ran, which adapter (mock or live URL).
2. **Summary** — overall score, pass rate, total duration.
3. **By category** — mean score per category. If `rag: 91%` and `agents: 60%`, your retrieval is fine but the agent wrapper is losing context.
4. **By difficulty** — mean score per difficulty. We expect `easy > medium > hard`. If `hard > medium`, something is fishy (probably the easy questions are too vague).
5. **Per-question breakdown** — one row per case, with all three axis scores plus the normalized total.
6. **What was missed** — a detailed section for every case that didn't hit 100%, showing the expected sources, what was actually cited, the expected topics, and a snippet of the answer.
7. **Top failure modes** — the three worst-scoring cases. Read these first when something breaks.

### What "good" looks like (v1 targets)

- **Overall >= 75%** on a freshly-seeded corpus.
- **easy >= 90%** — these are the lookups; if they fail, retrieval is broken.
- **hard >= 50%** — multi-step questions; failing half is the realistic floor.
- **Source accuracy >= 0.8 on average** — citations must be correct, not just present.

If you hit these numbers, the chatbot is good enough for a portfolio demo. If you don't, look at the failure modes before changing code — usually the answer is "ingest more sources" or "rewrite the system prompt to mention topic X", not "swap the embedding model".

---

## How to add a question

Open [`questions.json`](./questions.json) and append a new case. Required fields:

```json
{
  "id": "q21",                      // next sequential id
  "category": "agents",             // see list in questions.schema.json
  "difficulty": "medium",           // easy | medium | hard
  "question": "How do I... ?",
  "expectedSources": [              // URLs we expect to be cited
    "https://mastra.ai/docs/agents/overview"
  ],
  "expectedTopics": [               // substrings that should appear in the answer
    "createAgent",
    "stream"
  ]
}
```

The schema in `questions.schema.json` will catch most mistakes at edit time. Then run `npm run eval` and check the report.

### Writing good expected topics

Prefer **concrete API names** ("`createAgent`", "`PgVector`", "`rerank`") over generic English words ("function", "database"). The substring check is case-insensitive but exact, so "Mastra" matches but "the Mastra framework" also matches (substring is "Mastra"). When in doubt, use the API symbol exactly as it appears in the docs.

### When to retire a question

If a question scores 100% on three consecutive runs, retire it and add a harder one. The eval set should always have something in the failure column — that's how you know it's still measuring something useful.

---

## What this eval does NOT measure

- **Latency p50/p95** — we capture `latencyMs` per case but don't aggregate. Add a real benchmark (k6, artillery) if you need SLA numbers.
- **Hallucination rate** — a wrong-but-confident answer with the right citations still scores 5/8. Use the `LLM-as-judge` pattern in `ARCHITECTURE.md §7` to layer in a 0..3 groundedness score.
- **Multi-turn** — all 20 questions are single-turn. The system supports multi-turn input but our eval doesn't exercise it.
- **Adversarial prompts** — no prompt injection, no jailbreaks, no out-of-scope questions. If you're shipping to real users, add a separate "safety" set.

---

## Related

- [`ARCHITECTURE.md §7`](../ARCHITECTURE.md) — the original eval design.
- [`api-contract.ts`](../api-contract.ts) — the `EvalCase` / `EvalResult` types this runner consumes.
- [`scorer.ts`](./scorer.ts) — the pure scoring functions.
- [`run.ts`](./run.ts) — the runner.

---

## Report template

Every report produced by `npm run eval` follows this layout. Read it once before looking at a real `latest.md` — the placeholders below show you what each section is *for*.

```markdown
# Eval Report — <TIMESTAMP>

> Generated by `npm run eval` (<ADAPTER>). Educational guide: evals/README.md.

## Summary
- **Overall score:** <OVERALL>% (<COUNT> cases)
- **Pass rate:** <PASS_RATE>% (cases with raw score >= 5/8)
- **Duration:** <SECONDS>s

### By category
| Category | Mean |
|---|---|
| <CATEGORY> | <MEAN>% |

### By difficulty
| Difficulty | Mean |
|---|---|
| easy   | <MEAN>% |
| medium | <MEAN>% |
| hard   | <MEAN>% |

## Per-question breakdown
| ID | Cat | Diff | Question (short) | Src | Top | Cite | Raw | Score |
|---|---|---|---|---|---|---|---|---|

## What was missed
### <ID> — <QUESTION>
- Category / Difficulty / Score / Latency
- Expected sources, Cited URLs, Expected topics
- Answer (first 200 chars)
- Notes (sources/topics/citations)

## Top failure modes
- **<ID>** (<SCORE>%): <QUESTION>
```
