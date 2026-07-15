import { redirect } from "next/navigation";

import { SeriesEditorWorkspace } from "@/app/series/[seriesId]/edit/series-editor-workspace";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
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
      <SeriesEditorWorkspace key={model.series.revision} model={model} />
    </AuthenticatedShell>
  );
}
