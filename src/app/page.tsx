/**
 * Placeholder landing page.
 *
 * Why a placeholder: the real chat UI is owned by ui-agent (Phase 7). This
 * file exists so `npm run dev` shows a coherent page immediately after
 * scaffolding, and so the e2e agent has a stable element to assert on
 * during smoke tests.
 */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Mastra Expert
      </h1>
      <p className="mt-3 max-w-md text-base text-muted-foreground">
        A RAG chatbot for the Mastra AI framework. Chat coming soon.
      </p>
    </main>
  );
}
