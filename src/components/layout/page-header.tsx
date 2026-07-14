import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Consistent page header: optional back link, title, description, and a
 * right-aligned actions cluster. Replaces the hand-rolled
 * `<header className="border-b ...">` blocks scattered across pages.
 */
export function PageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel = "Back",
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header className={cn("border-b border-border/70 pb-6", className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
              {description}
            </p>
          ) : null}
          {children}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 [&_[data-slot=button]]:min-h-11">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
