"use client";

import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { useHelpUi } from "@/components/help/help-ui-context";
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
        // Keep parent role=button rows from toggling when activating help.
        event.stopPropagation();
        onClick?.(event);
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

function HelpPopoverBody({
  termKey,
  titleId,
  glossaryLink,
}: {
  termKey: HelpTermKey;
  titleId: string;
  glossaryLink: boolean;
}) {
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
        <PopoverTitle id={titleId}>{term.title}</PopoverTitle>
        <PopoverDescription className="text-pretty">{term.summary}</PopoverDescription>
      </PopoverHeader>
      {meta ? <p className="text-xs text-muted-foreground text-pretty">{meta}</p> : null}
      {glossaryLink ? (
        <Link
          href={helpGlossaryHref(termKey)}
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          Learn more in the metrics glossary
        </Link>
      ) : (
        <p className="text-xs text-muted-foreground text-pretty">{term.body}</p>
      )}
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
  const titleId = useId();
  const { glossaryLink } = useHelpUi();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarsePointer(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const trigger = <HelpTipTrigger label={label} className={className} />;

  function onPopoverOpenChange(open: boolean) {
    setPopoverOpen(open);
    if (open) setTooltipOpen(false);
  }

  // Touch / coarse pointers: popover only (tooltips are unreliable on tap).
  if (coarsePointer) {
    return (
      <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="start"
          aria-labelledby={titleId}
          className="w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]"
          onEscapeKeyDown={() => setPopoverOpen(false)}
        >
          <HelpPopoverBody
            termKey={termKey}
            titleId={titleId}
            glossaryLink={glossaryLink}
          />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
      <Tooltip
        open={tooltipOpen}
        onOpenChange={(open) => {
          if (popoverOpen) {
            setTooltipOpen(false);
            return;
          }
          setTooltipOpen(open);
        }}
      >
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-pretty">
          {term.summary}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        aria-labelledby={titleId}
        className="w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]"
        onEscapeKeyDown={() => setPopoverOpen(false)}
      >
        <HelpPopoverBody
          termKey={termKey}
          titleId={titleId}
          glossaryLink={glossaryLink}
        />
      </PopoverContent>
    </Popover>
  );
}
