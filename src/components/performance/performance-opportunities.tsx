import { Eye, Target, Timer } from "lucide-react";

import { formatNumber, type PerformanceEntryRef } from "@/components/performance/view-model";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  PerformanceEntryOpportunitiesV1,
  PerformanceOpportunityV1,
} from "@/lib/analytics/performance/types";

function opportunityHref(opportunity: PerformanceOpportunityV1): string {
  if (opportunity.category === "start") return "#start-analysis-heading";
  if (opportunity.scope.legIndex !== undefined) return "#leg-drilldown-heading";
  return "#fleet-metrics-heading";
}

function OpportunityCard({
  opportunity,
  entry,
  fleet,
}: {
  opportunity: PerformanceOpportunityV1;
  entry: PerformanceEntryRef;
  fleet: boolean;
}) {
  return (
    <Card className="h-full border-primary/30">
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <Badge variant={opportunity.estimatedSeconds === null ? "secondary" : "default"}>
            {opportunity.estimatedSeconds === null ? "Observation" : `Priority ${opportunity.priority}`}
          </Badge>
          {opportunity.estimatedSeconds !== null && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-primary">
              <Timer className="size-4" aria-hidden="true" />
              ≈ {formatNumber(opportunity.estimatedSeconds, 1)} s
            </span>
          )}
        </div>
        {fleet && (
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
            {entry.boatName}
          </p>
        )}
        <CardTitle className="text-base leading-snug">{opportunity.headline}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-4 border-b pb-1.5">
            <dt className="text-muted-foreground">Benchmark · {opportunity.benchmark.kind.replaceAll("_", " ")}</dt>
            <dd className="text-right font-medium">{formatNumber(opportunity.benchmark.value, 2)} {opportunity.benchmark.unit}</dd>
          </div>
          {opportunity.evidence.map((fact) => (
            <div key={`${fact.label}:${fact.unit}`} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="text-right font-medium">{formatNumber(fact.value, 2)} {fact.unit}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-1 text-xs text-muted-foreground">
          {opportunity.assumptions.map((assumption) => <p key={assumption}>Assumption: {assumption}</p>)}
          {opportunity.caveats.map((caveat) => <p key={caveat}>Caveat: {caveat}</p>)}
        </div>
        <a
          href={opportunityHref(opportunity)}
          className="inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          {opportunity.category === "start"
            ? "Inspect start evidence"
            : opportunity.scope.legIndex === undefined
              ? "Inspect fleet metrics"
              : `Inspect leg ${opportunity.scope.legIndex + 1}`}
        </a>
      </CardContent>
    </Card>
  );
}

export function PerformanceOpportunities({
  entries,
  opportunities,
  selectedEntryId,
}: {
  entries: readonly PerformanceEntryRef[];
  opportunities: readonly PerformanceEntryOpportunitiesV1[];
  selectedEntryId: string;
}) {
  const entryById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const fleetPrimary = opportunities.flatMap((entry) => entry.primary)
    .sort((left, right) =>
      right.estimatedSeconds! - left.estimatedSeconds! ||
      left.scope.entryId.localeCompare(right.scope.entryId) ||
      left.code.localeCompare(right.code))
    .slice(0, 3);
  const selected = selectedEntryId === "all"
    ? null
    : opportunities.find((entry) => entry.entryId === selectedEntryId) ?? null;
  const selectedEntry = selected ? entryById.get(selected.entryId) ?? null : null;

  return (
    <section aria-labelledby="opportunities-heading" className="space-y-6">
      <div>
        <h2 id="opportunities-heading" className="flex items-center gap-2 text-xl font-semibold">
          <Target className="size-5 text-primary" aria-hidden="true" />
          Deterministic opportunities
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Ranked, bounded comparisons from persisted facts. Estimates overlap, are not causal, and must not be summed into total time lost.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">Fleet summary</h3>
        {fleetPrimary.length === 0 ? (
          <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            No material primary opportunities were emitted. Reanalyze older races to add the opportunity contract.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {fleetPrimary.map((opportunity) => {
              const entry = entryById.get(opportunity.scope.entryId) ?? {
                entryId: opportunity.scope.entryId,
                boatName: "Unknown boat",
                color: "#64748b",
              };
              return <OpportunityCard key={`${entry.entryId}:${opportunity.code}`} opportunity={opportunity} entry={entry} fleet />;
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">Boat opportunities</h3>
        {!selected || !selectedEntry ? (
          <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            Select one boat in the filter above to inspect its ranked cards, observations, and suppression reasons.
          </div>
        ) : (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: selectedEntry.color }} aria-hidden="true" />
              {selectedEntry.boatName}
            </p>
            {selected.primary.length > 0 && (
              <div className="grid gap-4 lg:grid-cols-3">
                {selected.primary.map((opportunity) => (
                  <OpportunityCard
                    key={opportunity.code}
                    opportunity={opportunity}
                    entry={selectedEntry}
                    fleet={false}
                  />
                ))}
              </div>
            )}
            {selected.observations.length > 0 && (
              <div className="space-y-3">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Eye className="size-4" aria-hidden="true" />Observations without seconds estimates
                </h4>
                <div className="grid gap-4 lg:grid-cols-3">
                  {selected.observations.map((opportunity) => (
                    <OpportunityCard
                      key={opportunity.code}
                      opportunity={opportunity}
                      entry={selectedEntry}
                      fleet={false}
                    />
                  ))}
                </div>
              </div>
            )}
            <details className="rounded-lg border px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">Why other detectors were suppressed</summary>
              <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
                {selected.suppressed.map((item, index) => (
                  <li key={`${item.category}:${item.legIndex}:${item.reason}:${index}`}>
                    <span className="font-medium text-foreground">{item.category.replaceAll("_", " ")}</span>
                    {item.legIndex === undefined ? "" : ` · leg ${item.legIndex + 1}`}: {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
