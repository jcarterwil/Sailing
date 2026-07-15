import { Trophy } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SeriesWorkflowEditor } from "@/app/series/[seriesId]/edit/series-workflow-editor";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SeriesSharePanel } from "@/components/series/series-share-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { loadSeriesEditorModel } from "@/lib/series/server";

export const metadata = { title: "Series organizer" };
export const dynamic = "force-dynamic";

export default async function SeriesEditorPage({
  params,
}: {
  params: Promise<{ seriesId: string }>;
}) {
  const { seriesId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/series/${encodeURIComponent(seriesId)}/edit`);

  const model = await loadSeriesEditorModel(supabase, user.id, seriesId);
  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={model.profile.displayName}
      isAdmin={model.profile.isAdmin}
      width="wide"
    >
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
          <Badge variant="outline">Revision {model.series.revision}</Badge>
          <Badge variant="secondary">{model.series.scoringVersion}</Badge>
          {model.series.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
        </div>
      </PageHeader>
      <div className="pt-8">
        <SeriesSharePanel
          key={`${model.series.revision}:${model.series.shareSlug ?? "off"}`}
          seriesId={model.series.id}
          initialRevision={model.series.revision}
          initialSlug={model.series.shareSlug}
        />
      </div>
      <SeriesWorkflowEditor key={model.series.revision} model={model} />
    </AuthenticatedShell>
  );
}
