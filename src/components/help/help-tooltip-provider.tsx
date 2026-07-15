"use client";

import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

/** Root tooltip delay for HelpTip and any other shared tooltips. */
export const HELP_TOOLTIP_DELAY_MS = 400;

export function HelpTooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={HELP_TOOLTIP_DELAY_MS}>
      {children}
    </TooltipProvider>
  );
}
