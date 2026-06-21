# Deploy — Vercel + Supabase

> Step-by-step guide. First deploy takes about 10 minutes if you have the API keys ready.

---

## 0. Prereqs

- A **GitHub** account with this repo pushed.
- An **Anthropic** account — [console.anthropic.com](https://console.anthropic.com) (free to sign up, you pay per token).
- A **Voyage AI** account — [voyage.ai](https://voyage.ai) (free credits to start).
- A **Supabase** account — [supabase.com](https://supabase.com) (free tier covers this project).
- A **Vercel** account — [vercel.com](https://vercel.com) (free Hobby tier is enough).

---

## 1. Supabase — create the project + database

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and click **New project**.
2. Pick a name (e.g. `eu-ai-act-expert`), a strong database password, and the **closest region** to your users.
3. Wait ~90 seconds for the project to provision.
4. Once it's ready, open **SQL Editor** (left sidebar).
5. Click **New query** and paste the following SQL, then click **Run**:

   ```sql
   -- 0001_init.sql — schema, extension, match_documents RPC.
   create extension if not exists vector;

   create table if not exists documents (
     id         text primary key,
     content    text not null,
     metadata   jsonb not null default '{}'::jsonb,
     embedding  vector(1024),
     created_at timestamptz not null default now()
   );

   -- Cosine-distance match function used by @mastra/pg.
   create or replace function match_documents(
     query_embedding vector(1024),
     match_count     int default 10,
     filter          jsonb default '{}'::jsonb
   )
   returns table (
     id        text,
     content   text,
     metadata  jsonb,
     similarity float
   )
   language sql stable as $$
     select
       documents.id,
       documents.content,
       documents.metadata,
       1 - (documents.embedding <=> query_embedding) as similarity
     from documents
     where
       case
         when filter = '{}'::jsonb then true
         else documents.metadata @> filter
       end
     order by documents.embedding <=> query_embedding
     limit match_count;
   $$;
   ```

6. Click **New query** again and create the HNSW index for sub-100ms retrieval:

   ```sql
   -- 0002_hnsw_index.sql
   create index if not exists documents_embedding_hnsw
     on documents
     using hnsw (embedding vector_cosine_ops);
   ```

7. **Get your keys** (left sidebar → **Project Settings → API**):
   - Copy the **Project URL** — this is your `POSTGRES_CONNECTION_STRING` host.
   - The full connection string looks like:
     ```
     postgresql://postgres:<your-db-password>@<project-ref>.supabase.co:5432/postgres
     ```
     Combine the password you set in step 1 with the host from the Project URL.
   - Copy the **`service_role`** key (NOT the `anon` key). This is your `SUPABASE_SERVICE_ROLE_KEY`. Treat it like a secret — it bypasses row-level security.

---

## 2. Anthropic — get an API key

1. Open [console.anthropic.com](https://console.anthropic.com) and sign in.
2. Go to **Settings → API Keys**.
3. Click **Create Key**, name it `eu-ai-act-expert-prod`, copy the value (starts with `sk-ant-...`).
4. Make sure your account has **credit** on it — new accounts get a small free credit, then pay-as-you-go.

This is your `ANTHROPIC_API_KEY`.

---

## 3. Voyage AI — get an API key

1. Open [voyage.ai](https://voyage.ai) and sign in (or create an account — Google OAuth works).
2. Go to **API Keys** in the dashboard.
3. Click **Create new key**, copy the value (starts with `pa-...`).

This is your `VOYAGE_API_KEY`.

---

## 4. Vercel — connect the repo and set env vars

1. Push this repo to GitHub (or fork it first).
2. Open [vercel.com/new](https://vercel.com/new).
3. **Import** the GitHub repo. Vercel will detect Next.js and pre-fill the build settings.
4. **Configure the project**:
   - Framework Preset: **Next.js** (default).
   - Build Command: `npm run build` (default).
   - Output Directory: leave blank (default).
   - Install Command: `npm install` (default).
5. **Add environment variables** in the **Environment Variables** section:

   | Name | Value | Notes |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | `sk-ant-...` | from step 2 |
   | `VOYAGE_API_KEY` | `pa-...` | from step 3 |
   | `POSTGRES_CONNECTION_STRING` | `postgresql://postgres:...@...supabase.co:5432/postgres` | from step 1 |
   | `VECTOR_BACKEND` | `pg` | forces pgvector in prod |
   | `LOG_LEVEL` | `info` | quiet in prod |
   | `MOCK` | _(leave unset)_ | empty in prod — we want real backends |

   You can paste them as "production" values; Vercel also has "Preview" and "Development" scopes. Set the same values in **Production**; for **Preview** you can leave them blank to use the mock path.

6. Click **Deploy**. The first build takes ~2 minutes. Vercel will assign a domain like `eu-ai-act-expert-xyz.vercel.app`.

---

## 5. Post-deploy — populate the vector store

The Vercel deploy runs the **app** but does NOT run the ingest script. The vector store starts empty.

You have two options:

### Option A — run ingest from your laptop (recommended for first run)

```bash
# Set the same env vars locally, then:
POSTGRES_CONNECTION_STRING="postgresql://..." \
VOYAGE_API_KEY="pa-..." \
npm run ingest
```

This pulls every URL in `data-sources.md`, chunks, embeds with Voyage, and upserts to your Supabase DB. Initial ingest takes 2–5 minutes depending on the corpus size.

### Option B — wire ingest as a Vercel cron

Not in v1, but `scripts/ingest.ts` accepts a `--since <date>` flag for incremental re-ingestion. Wrap it in a Vercel Cron Job (once a week) when you're ready.

---

## 6. Smoke test
1. Open your Vercel domain (e.g. `https://eu-ai-act-expert-xyz.vercel.app`).
2. Type a question: **"What does Article 6 say about high-risk classification?"**
3. You should see a streamed answer with `[1]` citation chips in the text and a source list in the side panel.
4. Click a citation — it should open the underlying EUR-Lex / `artificialintelligenceact.eu` URL in a new tab.

If the answer comes back empty or the citations are wrong, jump to **Troubleshooting** below.

---

## 7. Run the eval against the deployed instance

```bash
npm run eval -- --url https://eu-ai-act-expert-xyz.vercel.app
```

A markdown report lands in `evals/reports/latest.md`. You're looking for:

- **Overall >= 75%** on a freshly seeded corpus.
- **easy >= 90%** — retrieval is working.
- **Citation quality 2/2** on most cases — the LLM is anchoring answers in sources.

See [`evals/README.md`](./evals/README.md) for how to read the report.

---

## 8. (Optional) Custom domain

In Vercel: **Project Settings → Domains → Add**. Point a CNAME from your DNS to `cname.vercel-dns.com`. Vercel provisions a free TLS cert automatically.

---

## Troubleshooting

### "I'm getting 500s in the chat"

Open **Vercel → Logs** for the project. Look for `error: ...` lines.

- `ANTHROPIC_API_KEY invalid` — re-copy the key from console.anthropic.com.
- `VOYAGE_API_KEY invalid` — re-copy from voyage.ai dashboard.
- `pgvector: extension not found` — you skipped step 1.5. Run the `create extension` SQL in the Supabase SQL editor.
- `password authentication failed for user "postgres"` — wrong DB password. Reset it in Supabase → **Project Settings → Database → Reset password**, then update the env var.

### "Retrieval returns nothing"

The vector store is empty. Run step 5 (post-deploy ingest) and try again.

### "The chat answers, but no citations appear"

The `data-sources` custom part isn't reaching the client. Check the browser dev tools — you should see an event with `type: "data-sources"` near the end of the SSE stream. If it's missing, the LLM is generating text before the citations are emitted. Confirm the route handler in `src/app/api/chat/route.ts` calls `toUIMessageStreamResponse()` with `data` parts included.

### "Vercel build fails on `voyageai`"

Make sure `next.config.ts` lists `voyageai`, `@mastra/rag`, `@mastra/pg`, `@mastra/core`, and `@anthropic-ai/sdk` in `serverExternalPackages`. The scaffold agent should have set this up; verify with:

```bash
grep serverExternalPackages next.config.ts
```

### "pgvector returns 0 results for a query I know should hit"

The HNSW index needs ~1000 rows before it kicks in. With a small corpus, the planner may choose a sequential scan and still return results — but it's slower. If you're seeing 0 results, the issue is almost always the ingest script not running, not the index.

### "Costs are higher than I expected"

- **Anthropic**: confirm `prompt_cache` is enabled for the system + retrieved context block. Check the route handler in `src/app/api/chat/route.ts` — the `cache_control` breakpoint should be set on the context block, not the whole system prompt.
- **Voyage**: the ingest script embeds once per chunk, not per query, so this is a one-time cost. Re-ingestion is opt-in.
- **Supabase**: 500MB is the free tier. Our initial ingest is well under 50MB. If you blow past it, the `documents` table is the only thing growing — you can prune old `ingestedAt` rows.

### "I want to roll back the deploy"

Vercel keeps every deploy. **Project → Deployments → ⋯ → Promote to Production** on an older deploy. The env vars stay the same.

---

## Cost reference (light traffic, 100 chats/day)

| Service | Free tier | Paid cost |
|---|---|---|
| Vercel | Hobby is free | Pro from $20/mo |
| Supabase | 500MB, 50K MAU | $25/mo for Pro |
| Anthropic Claude Sonnet | — | ~$3 / MTok input, ~$15 / MTok output |
| Voyage AI `voyage-code-3` | Free credits on signup | $0.06 / MTok |

For a portfolio site with < 100 chats/day, you should fit comfortably in free tiers. First-month cost with paid tiers is roughly $20 + $25 = $45 + a few dollars of LLM usage.
