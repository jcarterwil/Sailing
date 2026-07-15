import { Trophy } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { SeriesReport } from "@/components/series/series-report";
import { Badge } from "@/components/ui/badge";
import { resolveSharedSeriesReportV1 } from "@/lib/series/share";

export const metadata = { title: "Shared series standings" };
export const dynamic = "force-dynamic";

export default async function SharedSeriesReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const loaded = await resolveSharedSeriesReportV1(slug);
  if (loaded.status === "not-found") notFound();
  const { report } = loaded;

  return (
    <main className="series-report-shell mx-auto min-h-screen w-full max-w-[96rem] px-4 py-6 sm:px-8 lg:px-10">
      <PageHeader
        className="print-hidden"
        title={report.series.name}
        description="Public overall standings from the latest validated immutable score snapshot. This capability link can be revoked by the organizer."
        actions={(
          <Badge variant="secondary" className="min-h-8 px-3">
            <Trophy className="size-3.5" aria-hidden="true" />
            Shared series report
          </Badge>
        )}
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
      <footer className="print-hidden border-t border-border/70 py-8 text-center text-xs text-muted-foreground">
        Shared capability report · <Link href="/login" className="underline underline-offset-4">Organizer sign in</Link>
      </footer>
    </main>
  );
}
