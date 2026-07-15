import Link from "next/link";
import { Waves } from "lucide-react";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SessionPrimaryAction } from "@/lib/sessions/resolve-session-primary-action";
import {
  formatSessionDateTime,
  isLegacySessionDate,
  sessionBadgeLabel,
} from "@/lib/sessions/format";
import type { SessionType } from "@/lib/sessions/types";

/** Shared Session workspace header with one permission-aware primary action. */
export function SessionHeader({
  name,
  venue,
  startsAt,
  timezone,
  startsAtSource,
  sessionType,
  joinCode,
  showJoinCode,
  boatContext,
  tags = [],
  primaryAction,
  backHref = "/dashboard",
  backLabel = "My Sailing",
  children,
}: {
  name: string;
  venue: string | null;
  startsAt: string;
  timezone: string | null;
  startsAtSource: string | null | undefined;
  sessionType: SessionType;
  joinCode?: string | null;
  showJoinCode?: boolean;
  boatContext?: string | null;
  tags?: readonly string[];
  primaryAction: SessionPrimaryAction | null;
  backHref?: string;
  backLabel?: string;
  children?: ReactNode;
}) {
  const descriptionParts = [
    venue,
    formatSessionDateTime(startsAt, timezone),
    boatContext,
  ].filter(Boolean);

  return (
    <PageHeader
      title={
        <span className="flex items-center gap-2">
          <Waves className="size-6 text-primary" aria-hidden="true" />
          {name}
        </span>
      }
      description={
        <>
          {descriptionParts.join(" · ")}
          {showJoinCode && joinCode ? (
            <>
              {" · join code "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {joinCode}
              </code>
            </>
          ) : null}
        </>
      }
      backHref={backHref}
      backLabel={backLabel}
      actions={
        primaryAction ? (
          primaryAction.href && !primaryAction.disabled ? (
            <Button asChild className="min-h-11">
              <Link href={primaryAction.href}>{primaryAction.label}</Link>
            </Button>
          ) : (
            <Button className="min-h-11" disabled aria-disabled="true">
              {primaryAction.label}
            </Button>
          )
        ) : null
      }
    >
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant="outline">{sessionBadgeLabel(sessionType)}</Badge>
        {isLegacySessionDate(startsAtSource) ? (
          <Badge variant="secondary">Date needs review</Badge>
        ) : null}
        {tags.map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
      </div>
      {children}
    </PageHeader>
  );
}
