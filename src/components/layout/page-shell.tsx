import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const WIDTHS = {
  narrow: "max-w-3xl",
  prose: "max-w-5xl",
  default: "max-w-6xl",
  wide: "max-w-7xl",
} as const;

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
  width?: keyof typeof WIDTHS;
}) {
  return (
    <div
      className={cn(
        "mx-auto min-h-screen w-full px-6 py-8 sm:px-10 lg:px-12",
        WIDTHS[width],
        className,
      )}
    >
      {children}
    </div>
  );
}
