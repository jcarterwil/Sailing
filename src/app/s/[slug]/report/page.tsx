import { notFound } from "next/navigation";

import { ReportPageClient } from "@/app/races/[raceId]/report/report-page-client";
import { hasClubAiEntitlement } from "@/lib/billing/server";
import { resolveSharedRace } from "@/lib/races/share";
import {
  expireStaleReportGenerations,
  loadReportSnapshotAdmin,
} from "@/lib/report/queries";

export const dynamic = "force-dynamic";

export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { race } = await resolveSharedRace(slug);
  if (!race) notFound();
  if (!(await hasClubAiEntitlement(race.organizer_id))) notFound();

  await expireStaleReportGenerations(race.id);
  const initialSnapshot = await loadReportSnapshotAdmin(race.id, {
    includePreviousComplete: true,
  });

  return (
    <ReportPageClient
      raceId={race.id}
      raceName={race.name}
      raceVenue={race.venue}
      raceDate={race.starts_at ?? race.created_at}
      isOrganizer={false}
      readOnly
      shareSlug={slug}
      initialSnapshot={initialSnapshot}
    />
  );
}
