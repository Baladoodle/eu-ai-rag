# mastra-expert

A production-grade RAG chatbot that answers developer questions about the [Mastra AI framework](https://mastra.ai), built as a freelance portfolio piece.

## Setup

```bash
nvm use            # Node 20
npm install
MOCK=1 npm run dev # no API keys required
```

For a full understanding of the architecture, phased build plan, and file ownership, see:

- [ARCHITECTURE.md](./ARCHITECTURE.md) — stack decisions, data flow, eval strategy.
- [.claude/PLAN.md](./.claude/PLAN.md) — phased build plan with per-agent ownership.
- [.claude/FILE-OWNERSHIP.md](./.claude/FILE-OWNERSHIP.md) — who owns which file.

Deployment instructions will be added in a later phase — see the Deploy section placeholder below.

## Scripts

- `npm run dev` — Next.js dev server.
- `npm run build` — production build.
- `npm test` — Vitest unit + integration tests.

## Deploy

_Filled in by the e2e-agent in Phase 10._
