import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(
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

  const { data: entries, error } = await supabase
    .from("race_entries")
    .select("id, boats(name), tracks(id, status, error_message, point_count)")
    .eq("race_id", raceId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    entries: entries.map((e) => ({
      entryId: e.id,
      boatName: e.boats?.name ?? "Unknown",
      track: e.tracks
        ? {
            id: e.tracks.id,
            status: e.tracks.status,
            errorMessage: e.tracks.error_message,
            pointCount: e.tracks.point_count,
          }
        : null,
    })),
  });
}
