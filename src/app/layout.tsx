import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import * as React from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mastra Expert",
  description:
    "A RAG chatbot for the Mastra AI framework. Ask anything about Mastra.",
};

/**
 * Why className="dark": the chat UI is designed for the dark palette in
 * globals.css. We force the dark class so the look is consistent across
 * machines (and so a user with prefers-color-scheme=light still sees the
 * intended design — this is a portfolio piece, the theme is the brand).
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
