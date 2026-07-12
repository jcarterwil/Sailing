import { notFound, redirect } from "next/navigation";

import { ReportPageClient } from "@/app/races/[raceId]/report/report-page-client";
import { loadReportSnapshot } from "@/lib/report/queries";
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

  const [raceResult, organizerResult, initialSnapshot] = await Promise.all([
    supabase
      .from("races")
      .select("id, name, venue, starts_at, created_at")
      .eq("id", raceId)
      .maybeSingle(),
    supabase.rpc("is_race_organizer", { rid: raceId }),
    loadReportSnapshot(supabase, raceId),
  ]);
  if (raceResult.error) throw new Error(`Could not load race: ${raceResult.error.message}`);
  if (!raceResult.data) notFound();
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
