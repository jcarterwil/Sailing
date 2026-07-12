import { NextResponse } from "next/server";

import {
  AnalyzeRaceError,
  analyzeAndPersistRace,
} from "@/lib/races/analyze-race";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // RLS-visible read proves membership.
  const { data: race } = await supabase
    .from("races")
    .select("id")
    .eq("id", raceId)
    .maybeSingle();
  if (!race) {
    return NextResponse.json({ error: "Race not found." }, { status: 404 });
  }

  const { data: canOrganize, error: organizerError } = await supabase.rpc(
    "is_race_organizer",
    { rid: raceId },
  );
  if (organizerError) {
    return NextResponse.json({ error: "Could not verify access." }, { status: 500 });
  }
  if (!canOrganize) {
    return NextResponse.json(
      { error: "Only the organizer can re-analyze this race." },
      { status: 403 },
    );
  }

  try {
    const result = await analyzeAndPersistRace(raceId);
    return NextResponse.json({
      computedAt: result.computedAt,
      trackCount: result.trackCount,
      warningCount: result.analysis.warnings.length,
      startTimeMs: result.analysis.race.start.timeMs,
      twdDeg: result.analysis.wind.twdDeg,
      windSource: result.analysis.wind.source,
    });
  } catch (err) {
    if (err instanceof AnalyzeRaceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Analyze failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
