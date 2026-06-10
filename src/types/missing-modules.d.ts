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
   * Vector store factory exported by the vector-agent.
   */
  export function getVectorStore(): Promise<{
    query(args: { vector: number[]; topK: number }): Promise<
      Array<{
        id: string;
        score: number;
        metadata?: Record<string, unknown>;
      }>
    >;
  }>;
}
