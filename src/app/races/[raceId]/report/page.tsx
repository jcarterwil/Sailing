import { notFound, redirect } from "next/navigation";

import { ReportPageClient } from "@/app/races/[raceId]/report/report-page-client";
import {
  expireStaleReportGenerations,
  loadReportSnapshot,
} from "@/lib/report/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RaceReportPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const raceResult = await supabase
    .from("races")
    .select("id, name, venue, starts_at, created_at")
    .eq("id", raceId)
    .maybeSingle();
  if (raceResult.error) throw new Error(`Could not load race: ${raceResult.error.message}`);
  if (!raceResult.data) notFound();

  await expireStaleReportGenerations(raceId);
  const [organizerResult, initialSnapshot] = await Promise.all([
    supabase.rpc("is_race_organizer", { rid: raceId }),
    loadReportSnapshot(supabase, raceId, { includePreviousComplete: true }),
  ]);
  if (organizerResult.error) {
    throw new Error(`Could not check race permissions: ${organizerResult.error.message}`);
  }

  return (
    <ReportPageClient
      raceId={raceId}
      raceName={raceResult.data.name}
      raceVenue={raceResult.data.venue}
      raceDate={raceResult.data.starts_at ?? raceResult.data.created_at}
      isOrganizer={organizerResult.data ?? false}
      initialSnapshot={initialSnapshot}
    />
  );
}
