/**
 * /api/chat — Next.js App Router entry point.
 * ----------------------------------------------------------------------------
 * This is the THIN HTTP shell. The real work lives in
 * `src/backend/rag/pipeline.ts` (orchestrator), with retrieval in
 * `src/backend/rag/retrieval.ts`, generation in
 * `src/backend/rag/generation.ts`, and citations in
 * `src/backend/rag/citations.ts`. We re-export `POST` from
 * `src/backend/api/chat/route.ts` here so Next.js's App Router
 * discovery finds it.
 *
 * Why two files (this and the backend one):
 *   The backend route is testable in isolation (no Next.js runtime
 *   needed). This file is the App Router glue that hands the request
 *   to the backend.
 * ----------------------------------------------------------------------------
 */
export { POST } from "@/backend/api/chat/route";

// Edge runtime: the backend pipeline uses node:crypto (via the
// ingestion-state) and the in-memory vector store, both of which
// need a Node-like runtime. We pin to nodejs so Vercel doesn't try
// to run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
