# CLAUDE.md

Instructions for AI agents and humans working on this project.

## Git hygiene (non-negotiable)
- **Commit style**: extra compact, lowercase, stating the END RESULT, not what was implemented.
  - Good: `"AI wired to chat interface"`, `"ingestion pipeline ready"`, `"chat UI working with streaming"`
  - Bad: `"Refactoring 12/20"`, `"wip"`, `"fix bug"`, `"add feature"`
- **No god commits**: one massive commit dumping everything.
- **No slop commits**: `wip`, `fix typo`, `refactor 12/20`, `more changes`, `asdf`. Forbidden.
- **Functional wholes**: each commit must be a working state of the code. Test before committing.
- **No slop data in commits**: no `Refactoring 12/20` style tracking in messages.
- **Compact**: one short line, no body unless absolutely necessary. No Co-Authored-By trailers unless requested.
- **Don't commit secrets**: .env, API keys, data files. .gitignore handles this.

## UI rules (non-negotiable)
- **NO raw HTML**: use semantic React components. `<button>` not `<div onClick>`. `<a>` for navigation.
- **Minimalistic components**: each component does one thing, in its own file under `src/components/`.
- **Smooth, intentional animations**: use Framer Motion. No janky transitions. No unneeded motion.
- **Thought-out design**: intentional spacing, typography, color. Reference mastra.ai's aesthetic where appropriate.
- **Accessibility**: aria labels, keyboard nav, focus management. Always.
- **Mobile responsive**: looks good at 375px and 1440px.

## Code rules (non-negotiable)
- **No smart code**: every function is straightforward. No clever tricks. If you have to think hard to understand it, rewrite it.
- **Well-organized files**: clear separation of concerns per the architecture in ARCHITECTURE.md.
- **Atomic functions**: each function does one thing.
- **Modular UI**: each component in its own file.
- **Comprehensive logging**: at every key operation. Use the logger from `src/lib/logger.ts`. Log request entry/exit, retrieval results, generation start/end, errors with context. Use levels: debug, info, warn, error.
- **Relevant testing**: test external APIs (with mocks for unit tests, real for integration), chunker, embedder, retrieval, prompt construction. Don't test trivial getters.
- **Docstrings on non-obvious functions**: explain WHY, not WHAT.
- **Comments explain decisions**: WHY this approach, not what the code does.
- **Strong TypeScript**: no `any` unless justified with a comment.

## Code style
- Match the surrounding code's comment density, naming, and idiom.
- Prefer small, named functions over inline complexity.
- Use descriptive variable names. No abbreviations.
- Imports: external first, then internal. Alphabetical within groups.

## File ownership
- See `.claude/FILE-OWNERSHIP.md` for who owns what. If you need to edit a file outside your ownership, write a TODO and continue. The integration phase reconciles.

## Workflow
- Read ARCHITECTURE.md and .claude/PLAN.md before starting.
- Verify with `npm run build` and `npm test` before committing.
- One commit per functional whole.
- Push to a feature branch if working with others.

## Tools available
- All standard coding tools (Read, Write, Edit, Bash, etc.)
- WebFetch for reading documentation
- WebSearch for finding current best practices
