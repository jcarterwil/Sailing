"use client";

import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { useEffect, useState } from "react";

import {
  getHelpTerm,
  helpGlossaryHref,
  type HelpTermKey,
} from "@/content/help-registry";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function HelpTipTrigger({
  label,
  className,
  onClick,
  onPointerDown,
  onKeyDown,
  ...props
}: {
  label: string;
  className?: string;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      aria-label={label}
      {...props}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown?.(event);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        onKeyDown?.(event);
      }}
    >
      <CircleHelp className="size-3.5" aria-hidden="true" />
    </button>
  );
}

function HelpPopoverBody({ termKey }: { termKey: HelpTermKey }) {
  const term = getHelpTerm(termKey);
  const meta = [
    term.units ? `Units: ${term.units}` : null,
    term.frame ? `Frame: ${term.frame}` : null,
    term.provenance ? `Provenance: ${term.provenance}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PopoverHeader>
        <PopoverTitle>{term.title}</PopoverTitle>
        <PopoverDescription className="text-pretty">{term.summary}</PopoverDescription>
      </PopoverHeader>
      {meta ? <p className="text-xs text-muted-foreground text-pretty">{meta}</p> : null}
      <Link
        href={helpGlossaryHref(termKey)}
        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        Learn more in the metrics glossary
      </Link>
    </>
  );
}

/**
 * Contextual help: hover/focus → tooltip; click/touch → accessible popover.
 * Required instructions must remain visible elsewhere — this is supplementary.
 */
export function HelpTip({
  termKey,
  className,
}: {
  termKey: HelpTermKey;
  className?: string;
}) {
  const term = getHelpTerm(termKey);
  const label = `Help: ${term.title}`;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarsePointer(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const trigger = <HelpTipTrigger label={label} className={className} />;

  // Touch / coarse pointers: popover only (tooltips are unreliable on tap).
  if (coarsePointer) {
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]"
          onEscapeKeyDown={() => setPopoverOpen(false)}
        >
          <HelpPopoverBody termKey={termKey} />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <Tooltip open={popoverOpen ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-pretty">
          {term.summary}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]"
        onEscapeKeyDown={() => setPopoverOpen(false)}
      >
        <HelpPopoverBody termKey={termKey} />
      </PopoverContent>
    </Popover>
  );
}
