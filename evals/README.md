# Evals — what we measure and how to read the report

> A beginner-friendly guide to the eval pipeline. If you've never built a
> RAG before, read this end-to-end before touching any code.

---

## What is an "eval" and why bother?

A **retrieval-augmented chatbot** has two moving parts:

1. **Retrieval** — find the right chunks of the EU AI Act (Articles, Recitals, Annexes, Commission guidance) to answer the question.
2. **Generation** — write a natural-language answer that uses those chunks and cites them with the right Article/Recital number.

Both can be bad in subtle ways. Retrieval can return a chunk that mentions the right keyword but is the wrong article. Generation can sound confident while ignoring the chunks entirely — and in a legal domain, "sounds confident" is actively dangerous. Without measurement, you can't tell which part is broken, and you can't tell if your changes helped or hurt.

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

We wrote them after reading the actual [EU AI Act](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689), so the answers cite real Articles, Recitals, and Annexes — not synthetic legal trivia.

### Category distribution

| Category | Count | Examples |
|---|---|---|
| risk-classification | 3 | "What are the four risk categories?", "Which practices are prohibited?" |
| definitions | 2 | "How does Article 3 define an AI system?", "What is a provider?" |
| provider-obligations | 2 | "Main obligations of providers?", "When must providers register a high-risk system?" |
| deployer-obligations | 2 | "What is a deployer?", "What does Article 26 require?" |
| high-risk-requirements | 2 | "Data quality under Article 10?", "Human oversight?" |
| transparency | 2 | "Article 50 obligations?", "When must a chatbot disclose it's an AI?" |
| gpai | 2 | "What is a GPAI model?", "What triggers systemic-risk classification?" |
| timeline | 1 | "When is the Act fully applicable?" |
| enforcement | 1 | "Maximum fines under Article 99?" |
| conformity-assessment | 1 | "Conformity assessment procedures under Article 43?" |
| gdpr-cross-ref | 1 | "How does the Act relate to GDPR per Recital 10?" |
| post-market | 1 | "Post-market monitoring under Article 72?" |

### Difficulty distribution

- **8 easy** — direct lookups ("What are the four risk categories?").
- **8 medium** — require combining two or three concepts ("When must providers register a high-risk system?").
- **4 hard** — multi-step or interpretation-level ("What are the conformity assessment procedures?", "How does the Act relate to GDPR?").

---

## How we score each question (0..8 raw → 0..100 normalized)

The scorer lives in [`scorer.ts`](./scorer.ts). It's a pure module — no network, no logging, no side effects — so you can unit test it without any setup.

| Axis | Max points | What it measures |
|---|---|---|
| **Source accuracy** | 3 | How many of the `expectedSources` URLs appeared in the chatbot's citations. 1 point per match, capped at 3. We normalize URLs (strip fragments, lowercase) so a `https://artificialintelligenceact.eu/article/3/` citation matches an expected `https://artificialintelligenceact.eu/article/3/#chunk-2`. |
| **Topic coverage** | 3 | How many of the `expectedTopics` substrings appeared in the assistant's final answer (case-insensitive substring match). 1 point per match, capped at 3. |
| **Citation quality** | 2 | 2 = citations present AND at least one inline `[n]` marker in the answer text. 1 = citations present but no markers. 0 = no citations. |
| **Total** | 8 | Sum of the three axes. Normalized to 0..100 with `round((raw / 8) * 100)`. |

A case with `raw >= 5` (i.e. >= 62%) counts as a **pass**.

### Why this rubric and not "BLEU" or "embedding similarity"?

- **BLEU** measures n-gram overlap with a reference answer. It punishes valid paraphrases and rewards copying. Wrong tool for a chatbot — and actively dangerous in a legal domain where precise wording matters.
- **Embedding similarity** to a reference answer is too lenient: a confident, fluent, *wrong* answer can score high because it's "close" in vector space. In legal Q&A, "wrong" is the worst possible failure mode.
- **LLM-as-judge** (asking another LLM to grade the answer on a 0..3 rubric) is more accurate but expensive and non-deterministic. A future iteration could layer this in.

Our three-axis rubric is cheap, deterministic, and directly measures the three things a regulation Q&A user cares about: *did it find the right Article? did it cover what I asked? did it show its work?*

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
npm run eval -- --url https://eu-ai-act-expert.vercel.app

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
3. **By category** — mean score per category. If `risk-classification: 91%` and `gpai: 60%`, your retrieval is fine for the basic tier but the GPAI chunks need work.
4. **By difficulty** — mean score per difficulty. We expect `easy > medium > hard`. If `hard > medium`, something is fishy (probably the easy questions are too vague).
5. **Per-question breakdown** — one row per case, with all three axis scores plus the normalized total.
6. **What was missed** — a detailed section for every case that didn't hit 100%, showing the expected sources, what was actually cited, the expected topics, and a snippet of the answer.
7. **Top failure modes** — the three worst-scoring cases. Read these first when something breaks.

### What "good" looks like (v1 targets)

- **Overall >= 75%** on a freshly-seeded corpus.
- **easy >= 90%** — these are the lookups; if they fail, retrieval is broken.
- **hard >= 50%** — multi-step questions; failing half is the realistic floor.
- **Source accuracy >= 0.8 on average** — citations must be correct, not just present.

If you hit these numbers, the chatbot is good enough for a demo. If you don't, look at the failure modes before changing code — usually the answer is "ingest more sources" or "rewrite the system prompt to mention topic X", not "swap the embedding model".

---

## How to add a question

Open [`questions.json`](./questions.json) and append a new case. Required fields:

```json
{
  "id": "q21",                      // next sequential id
  "category": "risk-classification", // see list in questions.schema.json
  "difficulty": "medium",           // easy | medium | hard
  "question": "How do I...?",
  "expectedSources": [              // URLs we expect to be cited
    "https://artificialintelligenceact.eu/article/3/"
  ],
  "expectedTopics": [               // substrings that should appear in the answer
    "AI system",
    "machine-based"
  ]
}
```

The schema in `questions.schema.json` will catch most mistakes at edit time. Then run `npm run eval -- --mock` and check the report.

### Writing good expected topics

Prefer **concrete Article terms** ("`Article 99`", "`Annex III`", "`provider`", "`conformity assessment`") over generic English words ("the Act", "law"). The substring check is case-insensitive but exact, so "Article 50" matches but "the 50th article" does not. When in doubt, use the term exactly as it appears in the EU AI Act text.

### When to retire a question

If a question scores 100% on three consecutive runs, retire it and add a harder one. The eval set should always have something in the failure column — that's how you know it's still measuring something useful.

---

## What this eval does NOT measure

- **Latency p50/p95** — we capture `latencyMs` per case but don't aggregate. Add a real benchmark (k6, artillery) if you need SLA numbers.
- **Hallucination rate** — a wrong-but-confident answer with the right citations still scores 5/8. For a legal domain, this is a known gap; consider adding a separate "faithfulness" LLM-as-judge prompt.
- **Multi-turn** — all 20 questions are single-turn. The system supports multi-turn input but our eval doesn't exercise it.
- **Adversarial prompts** — no prompt injection, no jailbreaks, no out-of-scope questions. If you're shipping to real users, add a separate "safety" set. (Especially important here: real users may ask "should I do X" — the chatbot must say "this is not legal advice" rather than answer.)
- **Cross-jurisdictional questions** — the chatbot is EU-specific. A question about the US Executive Order 14110 or China's AI regulations is out of scope by design.

---

## Related

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — system architecture.
- [`api-contract.ts`](../api-contract.ts) — the `EvalCase` / `EvalResult` types this runner consumes.
- [`data-sources.md`](../data-sources.md) — what gets ingested into the vector store.
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
