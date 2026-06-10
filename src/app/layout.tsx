import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import * as React from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

/**
 * Typography choices for the EU AI Act expert:
 *   - Inter (sans) — body, UI, controls. Reads as a refined modern
 *     sans with strong legibility at small sizes (citation metadata,
 *     article numbers in body).
 *   - Source Serif 4 (serif) — article references and other "lawyerly"
 *     touchpoints. Used as a secondary face so the document feels like
 *     a regulation read, not a chat app.
 *   - JetBrains Mono — code blocks, article numbers in the citation
 *     cards, and tabular figures.
 */
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "EU AI Act Expert",
  description:
    "A RAG chatbot for Regulation (EU) 2024/1689 (the EU AI Act). Ask about Articles, Recitals, Annexes, and Commission guidance.",
};

/**
 * Why className="dark": the chat UI is designed for the dark palette in
 * globals.css. We force the dark class so the look is consistent across
 * machines (and so a user with prefers-color-scheme=light still sees the
 * intended design — this is a portfolio piece, the theme is the brand.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
