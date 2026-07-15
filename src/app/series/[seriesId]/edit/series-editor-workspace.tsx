"use client";

import { Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SeriesWorkflowEditor } from "@/app/series/[seriesId]/edit/series-workflow-editor";
import { PageHeader } from "@/components/layout/page-header";
import { SeriesSharePanel } from "@/components/series/series-share-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SeriesEditorModelV1 } from "@/lib/series/server";

/** Keep every revision-sensitive editor control on one compare-and-swap revision. */
export function SeriesEditorWorkspace({ model }: { model: SeriesEditorModelV1 }) {
  const [revision, setRevision] = useState(model.series.revision);

  return (
    <>
      <PageHeader
        title={model.series.name}
        description="Organizer workflow for ordered races, canonical identity, official decisions, and immutable score snapshots."
        backHref="/series"
        backLabel="Race series"
        actions={(
          <Button asChild variant="outline">
            <Link href={`/series/${model.series.id}`}>
              <Trophy className="size-4" aria-hidden="true" />
              View standings
            </Link>
          </Button>
        )}
      >
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="outline">Revision {revision}</Badge>
          <Badge variant="secondary">{model.series.scoringVersion}</Badge>
          {model.series.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
        </div>
      </PageHeader>
      <div className="pt-8">
        <SeriesSharePanel
          seriesId={model.series.id}
          revision={revision}
          initialSlug={model.series.shareSlug}
          onRevisionChange={setRevision}
        />
      </div>
      <SeriesWorkflowEditor
        model={model}
        revision={revision}
        onRevisionChange={setRevision}
      />
    </>
  );
}
