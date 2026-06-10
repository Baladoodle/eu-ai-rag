"use client"

import * as React from "react"
import { Tooltip } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/**
 * Provider must wrap any Tooltip usage in the tree. Defaults are tuned for
 * the chat UI: short delay, instant dismiss on pointer-leave.
 */
function TooltipProvider({
  delay = 200,
  closeDelay = 80,
  ...props
}: Tooltip.Provider.Props) {
  return <Tooltip.Provider delay={delay} closeDelay={closeDelay} {...props} />
}

function TooltipRoot({ ...props }: Tooltip.Root.Props) {
  return <Tooltip.Root {...props} />
}

function TooltipTrigger({ ...props }: Tooltip.Trigger.Props) {
  return <Tooltip.Trigger {...props} />
}

interface TooltipContentProps extends Tooltip.Popup.Props {
  sideOffset?: number;
  children: React.ReactNode;
}

/**
 * Wraps the popup in a Portal + Positioner. We split Positioner from Popup
 * to keep the prop types clean (Positioner carries positioning params, Popup
 * carries visual ones).
 */
function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <Tooltip.Portal>
      <Tooltip.Positioner sideOffset={sideOffset}>
        <Tooltip.Popup
          className={cn(
            "z-50 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md outline-none",
            className
          )}
          {...props}
        >
          {children}
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  )
}

export { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent }
