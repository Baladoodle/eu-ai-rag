"use client"

/**
 * BrowseTheAct
 * ----------------------------------------------------------------------------
 * A trigger button that opens a right-side sheet listing the regulation's
 * chapters with their article titles. Clicking an article title seeds the
 * composer with a query about that article AND closes the sheet.
 *
 * Why this is the chosen "new feature": the EU AI Act is structured
 * (Articles 1-113, with titles) and users coming to the tool for the
 * first time want to see the shape of the corpus before they ask
 * anything. Listing articles gives them a mental model and a one-click
 * way to start a question.
 *
 * Why a side sheet (not an inline expand): an inline expand pushes the
 * rest of the page down on click, which feels forced and disorienting.
 * A side sheet keeps the welcome composition stable and gives the
 * chapter list a focused, full-height canvas to scan.
 *
 * Data: the canonical article titles for Regulation (EU) 2024/1689.
 * Kept as a static array because the titles don't change; this is a
 * navigation aid, not the RAG corpus.
 * ----------------------------------------------------------------------------
 */
import { motion } from "framer-motion";
import { BookOpen, Search } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { log } from "@/lib/logger";
import { fadeInVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// Data
// ----------------------------------------------------------------------------

interface ArticleEntry {
  number: number;
  title: string;
}

interface Chapter {
  id: string;
  /** "Chapter I" — V as in the regulation. */
  roman: string;
  title: string;
  articles: ArticleEntry[];
}

/**
 * Chapter + article map for Regulation (EU) 2024/1689. Titles abbreviated
 * for the panel — the full text is in the corpus.
 *
 * We include all 113 articles split by chapter so the panel is the
 * canonical "table of contents" of the Act.
 */
const CHAPTERS: Chapter[] = [
  {
    id: "ch1",
    roman: "I",
    title: "General Provisions",
    articles: [
      { number: 1, title: "Subject matter" },
      { number: 2, title: "Scope" },
      { number: 3, title: "Definitions" },
      { number: 4, title: "AI literacy" },
    ],
  },
  {
    id: "ch2",
    roman: "II",
    title: "Prohibited AI Practices",
    articles: [{ number: 5, title: "Prohibited AI practices" }],
  },
  {
    id: "ch3",
    roman: "III",
    title: "High-Risk AI Systems",
    articles: [
      { number: 6, title: "Classification rules for high-risk AI systems" },
      { number: 7, title: "Amendments to Annex III" },
      { number: 8, title: "Compliance with the requirements" },
      { number: 9, title: "Risk management system" },
      { number: 10, title: "Data and data governance" },
      { number: 11, title: "Technical documentation" },
      { number: 12, title: "Record-keeping" },
      { number: 13, title: "Transparency and provision of information to deployers" },
      { number: 14, title: "Human oversight" },
      { number: 15, title: "Accuracy, robustness and cybersecurity" },
    ],
  },
  {
    id: "ch4",
    roman: "IV",
    title: "Providers and Deployers of High-Risk AI Systems",
    articles: [
      { number: 16, title: "Obligations of providers of high-risk AI systems" },
      { number: 17, title: "Quality management system" },
      { number: 18, title: "Documentation and logging" },
      { number: 19, title: "Automatically generated logs" },
      { number: 20, title: "Corrective actions and duty of information" },
      { number: 21, title: "Cooperation with competent authorities" },
      { number: 22, title: "Responsibilities along the value chain" },
      { number: 23, title: "Obligations of importers" },
      { number: 24, title: "Obligations of distributors" },
      { number: 25, title: "Obligations of deployers of high-risk AI systems" },
      { number: 26, title: "Fundamental rights impact assessment for high-risk AI systems" },
      { number: 27, title: "AI system for critical infrastructure" },
    ],
  },
  {
    id: "ch5",
    roman: "V",
    title: "General-Purpose AI Models",
    articles: [
      { number: 51, title: "Classification of general-purpose AI models as GPAI with systemic risk" },
      { number: 52, title: "Obligations of providers of GPAI models" },
      { number: 53, title: "Obligations of providers of GPAI models with systemic risk" },
      { number: 54, title: "Code of practice" },
      { number: 55, title: "Compliance and enforcement for GPAI models" },
    ],
  },
  {
    id: "ch6",
    roman: "VI",
    title: "Transparency and Provisions for Operators",
    articles: [
      { number: 50, title: "Transparency obligations for providers and deployers of certain AI systems" },
    ],
  },
  {
    id: "ch7",
    roman: "VII",
    title: "Governance",
    articles: [
      { number: 64, title: "European Artificial Intelligence Board" },
      { number: 65, title: "Functions of the Board" },
      { number: 66, title: "Independent scientific panel" },
      { number: 67, title: "Advisory forum" },
    ],
  },
  {
    id: "ch8",
    roman: "VIII",
    title: "EU Database for High-Risk AI Systems",
    articles: [
      { number: 71, title: "EU database for high-risk AI systems" },
    ],
  },
  {
    id: "ch9",
    roman: "IX",
    title: "Penalties",
    articles: [
      { number: 99, title: "Penalties" },
      { number: 100, title: "Penalties for providers of GPAI models" },
    ],
  },
  {
    id: "ch10",
    roman: "X",
    title: "Final Provisions",
    articles: [
      { number: 113, title: "Entry into force and application" },
    ],
  },
];

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

interface BrowseTheActProps {
  /** Called with a seed query about the selected article. */
  onSelectArticle: (text: string) => void;
  className?: string;
}

export function BrowseTheAct({ onSelectArticle, className }: BrowseTheActProps) {
  const [open, setOpen] = React.useState(false);

  const handleOpenChange = React.useCallback((next: boolean) => {
    log.info({ open: next }, "browse.toggle");
    setOpen(next);
  }, []);

  const handleSelectArticle = React.useCallback(
    (article: ArticleEntry) => {
      const seed = `What does Article ${article.number} say about ${article.title.toLowerCase()}?`;
      log.info({ article: article.number }, "browse.article.select");
      onSelectArticle(seed);
      setOpen(false);
    },
    [onSelectArticle]
  );

  return (
    <motion.section
      initial="hidden"
      animate="visible"
      variants={fadeInVariants}
      className={cn("mx-auto w-full max-w-2xl px-4 pb-2", className)}
    >
      <div className="rounded-xl border border-border/50 bg-card/30">
        <Button
          type="button"
          variant="ghost"
          onClick={() => handleOpenChange(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="w-full justify-between rounded-xl px-4 py-3 text-sm font-medium"
        >
          <span className="flex items-center gap-2">
            <BookOpen className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span>Browse the Act</span>
            <span className="text-[10px] font-normal text-muted-foreground tabular-nums">
              113 articles
            </span>
          </span>
          <span aria-hidden="true" className="text-muted-foreground text-xs">
            Open
          </span>
        </Button>
      </div>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 border-l border-border/40 bg-popover p-0 sm:max-w-[420px]"
        >
          <SheetHeader className="border-b border-border/40 px-5 py-4">
            <SheetTitle className="flex items-center gap-2 text-base">
              <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
              Browse the Act
            </SheetTitle>
            <SheetDescription>
              113 articles across 10 chapters of Regulation (EU) 2024/1689.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            {CHAPTERS.map((chapter) => (
              <ChapterBlock
                key={chapter.id}
                chapter={chapter}
                onSelectArticle={handleSelectArticle}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </motion.section>
  );
}

interface ChapterBlockProps {
  chapter: Chapter;
  onSelectArticle: (article: ArticleEntry) => void;
}

function ChapterBlock({ chapter, onSelectArticle }: ChapterBlockProps) {
  return (
    <div className="px-2 py-1.5">
      <div className="flex items-baseline gap-2 px-1 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        <span>Chapter {chapter.roman}</span>
        <span aria-hidden="true">·</span>
        <span className="normal-case tracking-normal text-foreground/70">
          {chapter.title}
        </span>
      </div>
      <ul role="list" className="flex flex-col">
        {chapter.articles.map((article) => (
          <li key={article.number}>
            <button
              type="button"
              onClick={() => onSelectArticle(article)}
              className={cn(
                "group flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs",
                "hover:bg-muted/60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              )}
            >
              <span className="font-mono text-[11px] font-medium tabular-nums text-muted-foreground">
                Art.&nbsp;{article.number}
              </span>
              <span className="flex-1 text-foreground/90">{article.title}</span>
              <Search
                aria-hidden="true"
                className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
