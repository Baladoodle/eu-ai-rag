/**
 * src/types/missing-modules.d.ts
 * ----------------------------------------------------------------------------
 * Ambient module declarations for modules that are owned by other agents
 * and may not be present at typecheck time. We declare the minimal
 * shape we import from each so that `import("@/lib/...")` resolves
 * cleanly while the rest of the system is still being built.
 *
 * Why this file:
 *   The codebase is built by cooperating agents. During early phases
 *   the rag-agent and route-agent need to *call* modules that the
 *   embed-agent and vector-agent haven't written yet. Declaring
 *   ambient types here lets the route compile end-to-end without
 *   waiting for the other agents.
 *
 * Once those agents land their real modules, this file becomes
 * redundant — TypeScript will prefer the real declaration. Until
 * then, this is the contract.
 *
 * Note: as of the integration phase, both real modules now exist in
 * `src/lib/rag/embed.ts` and `src/lib/vector/index.ts`. The ambient
 * declarations are kept here only as a safety net for any straggling
 * references; they match the real module's public shape.
 * ----------------------------------------------------------------------------
 */

declare module "@/lib/rag/embed" {
  /**
   * Embedding function exported by the embed-agent. We only type the
   * shape we consume; the real module may export more.
   */
  export function embed(texts: string[]): Promise<number[][]>;
}

declare module "@/lib/vector" {
  /**
   * Vector store factory. The real module returns a full
   * `VectorStore` (createIndex/upsert/query/reset); the ambient type
   * here is intentionally narrow because the contract is exercised
   * through the real module.
   */
  export interface VectorStore {
    createIndex(indexName: string, dimension: number): Promise<void>;
    upsert(
      indexName: string,
      rows: ReadonlyArray<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>,
    ): Promise<void>;
    query(
      indexName: string,
      queryVector: number[],
      options?: { topK?: number; minScore?: number },
    ): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>>;
    reset(indexName: string): Promise<void>;
  }
  export function getVectorStore(): Promise<VectorStore>;
  export function _resetVectorStoreForTesting(): void;
}
