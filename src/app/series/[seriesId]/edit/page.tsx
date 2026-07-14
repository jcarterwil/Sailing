import { redirect } from "next/navigation";

import { SeriesWorkflowEditor } from "@/app/series/[seriesId]/edit/series-workflow-editor";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
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
      >
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="outline">Revision {model.series.revision}</Badge>
          <Badge variant="secondary">{model.series.scoringVersion}</Badge>
          {model.series.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
        </div>
      </PageHeader>
      <SeriesWorkflowEditor key={model.series.revision} model={model} />
    </AuthenticatedShell>
  );
}
