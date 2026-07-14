import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const WIDTHS = {
  narrow: "max-w-3xl",
  prose: "max-w-5xl",
  default: "max-w-6xl",
  wide: "max-w-7xl",
} as const;

export type PageShellWidth = keyof typeof WIDTHS;

/**
 * Standard centered page container. Replaces the per-page
 * `mx-auto ... max-w-* px-6 py-8 ...` idiom with one width scale.
 */
export function PageShell({
  children,
  className,
  width = "default",
}: {
  children: ReactNode;
  className?: string;
  width?: PageShellWidth;
}) {
  return (
    <main
      className={cn(
        "mx-auto min-h-[calc(100dvh-3.5rem)] min-w-0 w-full overflow-x-clip px-4 py-6 sm:px-10 sm:py-8 lg:px-12",
        WIDTHS[width],
        className,
      )}
    >
      {children}
    </main>
  );
}
