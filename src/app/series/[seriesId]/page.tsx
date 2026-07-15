import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SeriesReport } from "@/components/series/series-report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadSeriesReportModelV1 } from "@/lib/series/report-server";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Series standings" };
export const dynamic = "force-dynamic";

export default async function SeriesReportPage({
  params,
}: {
  params: Promise<{ seriesId: string }>;
}) {
  const { seriesId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/series/${encodeURIComponent(seriesId)}`);

  // RLS-visible series and snapshot rows enforce the authenticated read contract from #137.
  const loaded = await loadSeriesReportModelV1(supabase, user.id, seriesId);
  if (loaded.status === "not-found") notFound();
  const { report, profile } = loaded;
  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile.displayName}
      isAdmin={profile.isAdmin}
      width="wide"
      className="series-report-shell"
    >
      <PageHeader
        className="print-hidden"
        title={report.series.name}
        description="Authenticated overall standings from the latest immutable score snapshot, with version-matched compact Performance facts."
        backHref="/series"
        backLabel="Race series"
        actions={report.organizerHref ? (
          <Button asChild>
            <Link href={report.organizerHref}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit or rescore
            </Link>
          </Button>
        ) : null}
      >
        <div className="flex flex-wrap gap-2 pt-1">
          {report.series.venue ? <Badge variant="outline">{report.series.venue}</Badge> : null}
          {report.snapshot.status === "ready" ? (
            <>
              <Badge variant="secondary">Snapshot {report.snapshot.revision}</Badge>
              <Badge variant="outline">{report.snapshot.result.scoringVersion}</Badge>
            </>
          ) : <Badge variant="outline">No valid standings</Badge>}
          {report.series.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
        </div>
      </PageHeader>
      <SeriesReport report={report} />
    </AuthenticatedShell>
  );
}
