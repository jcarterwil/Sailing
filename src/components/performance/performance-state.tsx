import Link from "next/link";
import { AlertTriangle, ArrowLeft, Clock3, DatabaseZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PerformancePageState } from "@/components/performance/view-model";

const STATE_COPY: Record<Exclude<PerformancePageState, "current">, {
  title: string;
  detail: string;
  icon: typeof AlertTriangle;
}> = {
  missing: {
    title: "Performance analysis is not ready",
    detail: "This race does not have a saved Performance Overview yet.",
    icon: DatabaseZap,
  },
  legacy: {
    title: "Performance analysis needs an upgrade",
    detail: "The saved analysis predates the current Performance calculation and must be reanalyzed.",
    icon: DatabaseZap,
  },
  stale: {
    title: "Performance analysis is stale",
    detail: "Tracks, entries, or organizer corrections changed after this analysis was generated.",
    icon: Clock3,
  },
  processing: {
    title: "Track processing is in progress",
    detail: "The overview will be available after all current track uploads finish processing.",
    icon: Clock3,
  },
  failed: {
    title: "A track failed to process",
    detail: "The fleet overview cannot be current until the failed track is replaced or processed again.",
    icon: AlertTriangle,
  },
  unsupported: {
    title: "Performance analysis version is unsupported",
    detail: "This saved payload was produced by a newer or incompatible analysis contract.",
    icon: AlertTriangle,
  },
  malformed: {
    title: "Performance analysis could not be read",
    detail: "The saved analysis failed bounded schema validation and was not rendered.",
    icon: AlertTriangle,
  },
};

export function PerformanceState({
  state,
  raceId,
  raceName,
  canManage,
  canReview,
  issues,
  backHref,
  backLabel,
  embedded = false,
}: {
  state: Exclude<PerformancePageState, "current">;
  raceId: string;
  raceName: string;
  canManage: boolean;
  canReview: boolean;
  issues: readonly string[];
  backHref?: string;
  backLabel?: string;
  /** When true, omit the standalone page chrome (Session workspace wraps this). */
  embedded?: boolean;
}) {
  const copy = STATE_COPY[state];
  const Icon = copy.icon;
  const dataHref = `/races/${raceId}?tab=data`;
  const Wrapper = embedded ? "div" : "main";
  const Heading = embedded ? "h2" : "h1";
  return (
    <Wrapper
      className={
        embedded
          ? "mx-auto flex w-full max-w-2xl flex-col gap-6"
          : "mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-6 px-6 py-12"
      }
    >
      {!embedded ? (
        <Link
          href={backHref ?? `/races/${raceId}`}
          className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backLabel ?? raceName}
        </Link>
      ) : null}
      <section className="rounded-xl border bg-card p-6 shadow-sm" aria-labelledby="performance-state-title">
        <Icon className="size-8 text-amber-500" aria-hidden="true" />
        <Heading id="performance-state-title" className="mt-4 text-2xl font-semibold">
          {copy.title}
        </Heading>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.detail}</p>
        {issues.length > 0 && (
          <details className="mt-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Validation details</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {issues.slice(0, 8).map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </details>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          {canManage ? (
            <>
              {canReview && (
                <Button asChild className="min-h-11">
                  <Link href={`/races/${raceId}/review`}>Review and reanalyze</Link>
                </Button>
              )}
              <Button asChild variant="outline" className="min-h-11">
                <Link href={backHref ?? dataHref}>
                  {canReview ? "Manage tracks" : "Open Data"}
                </Link>
              </Button>
            </>
          ) : (
            <Button asChild variant="outline" className="min-h-11">
              <Link href={backHref ?? `/races/${raceId}`}>Back to Session</Link>
            </Button>
          )}
        </div>
        {!canManage && (
          <p className="mt-4 text-xs text-muted-foreground">
            A race organizer must update the analysis; your access remains read-only.
          </p>
        )}
      </section>
    </Wrapper>
  );
}
