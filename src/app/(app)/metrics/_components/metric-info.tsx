"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Info } from "lucide-react";

/**
 * Inline operator-facing documentation surface for a single
 * metric. Rendered as a low-contrast info button in the tile
 * header that opens an animated popover with:
 *
 *   - title: the metric's display name (matches the tile label
 *     by convention but can be elaborated, e.g. "Read repair
 *     (batched)" → "Async read-repair dispatched via the queue")
 *   - what: 1–2 sentences on what the counter/gauge actually
 *     measures, free of dashboard jargon
 *   - read (optional): how to interpret the live value — what
 *     "good" looks like, what's worth alerting on, and how it
 *     relates to neighbouring metrics
 *
 * Why a popover instead of a Dialog: the dashboard has 30+
 * tiles; dimming the whole page on every "what does this mean"
 * click would destroy the scan flow. Radix Popover gives us
 * click-outside + Escape dismiss, focus management, and a slick
 * animation set out of the box.
 */

export type MetricInfoContent = { title: string; what: string; read?: string };

export function MetricInfo({ content }: { content: MetricInfoContent }) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={`About ${content.title}`}
        className="text-muted-foreground/60 hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background -my-1 flex h-5 w-5 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <Info
          aria-hidden
          className="h-3.5 w-3.5"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-80"
      >
        <p className="text-foreground text-sm font-semibold">{content.title}</p>
        <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
          {content.what}
        </p>
        {content.read !== undefined && (
          <>
            <div className="bg-border/60 my-2.5 h-px" />
            <p className="text-foreground/80 text-[11px] font-semibold tracking-wider uppercase">
              How to read
            </p>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {content.read}
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
