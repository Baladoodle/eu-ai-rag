/**
 * app/page.tsx
 * ----------------------------------------------------------------------------
 * The chat page. Renders the full-height ChatContainer; layout and fonts
 * live in app/layout.tsx.
 * ----------------------------------------------------------------------------
 */
import { ChatContainer } from "@/components/chat/ChatContainer";

export default function Home() {
  return <ChatContainer />;
}
