# Contributing

> Conventions for code, commits, and pull requests. Read this before opening a PR — the rules below are how we keep the diff small and the review fast.

---

## Ground rules

- **Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first.** Stack decisions, file ownership, and the eval contract are all there. If your change contradicts it, update the doc or open a discussion — don't silently override.
- **Stay in your lane.** The agent that owns a file is the one who maintains it. See [`.claude/FILE-OWNERSHIP.md`](./.claude/FILE-OWNERSHIP.md) for the map. Cross-lane edits are allowed if you coordinate.
- **No `any` without a comment.** TypeScript strict mode is on. `any` is a code smell that needs justification.
- **No `console.log` in `src/lib/`.** Use the logger from `src/lib/logger.ts`.
- **No secrets in the repo.** `.env` files are gitignored; if you accidentally commit one, rotate the key.

---

## Commit style

We use **lowercase, compact, end-result messages** on a single line. The commit message describes the **state of the code after the commit**, not what you did to get there.

### Good

```
ai wired to chat interface
ingestion pipeline ready
chat UI working with streaming
eval set with 20 questions
deploy guide and license
```

### Bad

```
Refactoring 12/20
wip
fix bug
add feature
asdf
Refactor 12/20 (do not use)
```

### Why this style

- Easy to skim `git log --oneline` and find the commit that shipped a feature.
- Forces the author to summarize the *result*, which is itself a check on whether the change is coherent.
- Matches the project's `CLAUDE.md` rule (and is enforced in PR review).

### One commit per functional whole

If your change is "build the chat UI", that's one commit, not five. If you need to split because the diff is huge, split along **seams the user could test** (e.g. "ui primitives ready" + "chat components consume them") rather than along file-system seams.

---

## Pull request workflow

1. **Branch off `main`** with a short, descriptive name: `eval-set`, `fix-rerank-prompt`, `chore-bump-voyage`.
2. **Run the checks locally** before pushing:
   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```
   All four must pass. If any fail, the PR is not ready.
3. **If you touched the eval set, the prompt, or the retrieval logic**, also run:
   ```bash
   npm run eval
   ```
   and include the new `evals/reports/latest.md` (or a summary of the overall score) in the PR description.
4. **Push** and open a PR against `main`. Include:
   - One-line summary.
   - The reason for the change.
   - Any new env vars, schema changes, or eval cases.
   - Screenshots for UI changes.
5. **CI must pass** before merge. CI runs the same four checks plus the eval on a fresh corpus.

---

## File organization

- Each component is its own file under `src/components/`. No `index.ts` dumping grounds.
- Each function does **one thing**. If a function needs more than one `and` in its docstring, split it.
- Imports: external first, then internal, alphabetical within each group. The formatter (Prettier defaults) handles it.
- Branded types for IDs (`SourceId`, `SessionId`, `MessageId`) live in [`api-contract.ts`](./api-contract.ts). Don't invent new ID types.

---

## Adding a new eval question

1. Append to `evals/questions.json`. The next ID is `q21`, etc.
2. Required fields per [`questions.schema.json`](./evals/questions.schema.json): `id`, `category`, `difficulty`, `question`, `expectedSources`, `expectedTopics`.
3. Prefer concrete API names in `expectedTopics` (`createAgent`, `PgVector`) over generic words (`function`, `database`).
4. Run `npm run eval` and check the per-question table in `evals/reports/latest.md`.
5. If the new case scores 100% on three consecutive runs, retire it and add a harder one.

See [`evals/README.md`](./evals/README.md#how-to-add-a-question) for the full guide.

---

## Adding a new data source

1. Add a row to the right tier in [`data-sources.md`](./data-sources.md).
2. Re-run `npm run ingest`.
3. Add **at least one** eval case that targets the new source — otherwise we have no way to know the source helps.
4. Re-run `npm run eval`. The new case's row in the report should show non-zero `source_accuracy`.

---

## UI rules (non-negotiable)

- **Semantic HTML.** `<button>` not `<div onClick>`. `<a>` for navigation.
- **Accessibility.** aria labels, keyboard nav, focus management — always.
- **Mobile responsive.** Looks good at 375px and 1440px. Test before pushing.
- **Intentional motion.** Framer Motion for the meaningful transitions; no jank, no spinners that don't mean anything.
- **No raw `style={...}`** for things Tailwind can express. Use design tokens (CSS variables in `globals.css`).

---

## Logging

Use the logger from `src/lib/logger.ts`. Levels:

- `trace` — full retrieval candidates (dev only, never in prod).
- `debug` — chunk IDs, scores, embed batch sizes.
- `info` — request lifecycle (`chat.start`, `retrieval.final`, `chat.end`).
- `warn` — low-confidence retrieval, empty results.
- `error` — exceptions, upstream 5xx.

Every log line carries `sessionId` and a generated `requestId` (UUID v4) for correlation.

---

## Code review checklist

When you're the reviewer:

- [ ] Does it match the architecture? If not, is the doc updated?
- [ ] Does it pass `npm run typecheck && npm run lint && npm test && npm run build`?
- [ ] Is there a new env var? Is it in `.env.example`?
- [ ] Is there a new dependency? Is it justified in the PR description?
- [ ] Did the eval score change? If yes, include before/after.
- [ ] Are there new tests for the new logic?
- [ ] Is the commit message a one-liner that describes the result?

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
