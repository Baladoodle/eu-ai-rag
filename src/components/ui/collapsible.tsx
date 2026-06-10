"use client"

import * as React from "react"
import { Collapsible } from "@base-ui/react/collapsible"

import { cn } from "@/lib/utils"

/**
 * Smoothly reveals/hides content. Used for the per-message citation
 * panel and for the assistant-toolbar's "show more" affordance.
 */
function CollapsibleRoot({
  className,
  ...props
}: Collapsible.Root.Props) {
  return (
    <Collapsible.Root
      data-slot="collapsible"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function CollapsibleTrigger({
  className,
  ...props
}: Collapsible.Trigger.Props) {
  return (
    <Collapsible.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm",
        className
      )}
      {...props}
    />
  )
}

function CollapsiblePanel({
  className,
  ...props
}: Collapsible.Panel.Props) {
  return (
    <Collapsible.Panel
      data-slot="collapsible-panel"
      className={cn(
        "flex flex-col gap-2 overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1",
        className
      )}
      {...props}
    />
  )
}

export { CollapsibleRoot, CollapsibleTrigger, CollapsiblePanel }
