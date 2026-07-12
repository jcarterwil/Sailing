import { NextResponse } from "next/server";

import { interpretWeatherWithAi } from "@/lib/ai/settings";
import type { RaceConditions } from "@/lib/races/meta";
import { createClient } from "@/lib/supabase/server";
import {
  fetchRaceWeatherEvidence,
  formatWeatherLocation,
  geocodeWeatherLocation,
} from "@/lib/weather/open-meteo";

export const maxDuration = 30;

interface SuggestRequest {
  location?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [{ data: race }, { data: isAdmin }] = await Promise.all([
    supabase.from("races").select("id, organizer_id").eq("id", raceId).maybeSingle(),
    supabase.rpc("is_admin"),
  ]);
  if (!race) return NextResponse.json({ error: "Race not found." }, { status: 404 });
  if (race.organizer_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: "Only the organizer or an admin can fill race weather." }, { status: 403 });
  }

  let body: SuggestRequest;
  try {
    body = (await request.json()) as SuggestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const locationQuery = typeof body.location === "string" ? body.location.trim() : "";
  const start = new Date(typeof body.startsAt === "string" ? body.startsAt : "");
  const end = new Date(typeof body.endsAt === "string" ? body.endsAt : "");
  if (!locationQuery) {
    return NextResponse.json({ error: "Race location is required." }, { status: 400 });
  }
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return NextResponse.json({ error: "Valid race start and end times are required." }, { status: 400 });
  }
  const earliest = Date.UTC(1940, 0, 1);
  const latest = Date.now() + 16 * 24 * 60 * 60 * 1000;
  if (start.getTime() < earliest || end.getTime() > latest) {
    return NextResponse.json(
      { error: "Weather lookup supports dates from 1940 through 16 days from now." },
      { status: 400 },
    );
  }

  try {
    const location = await geocodeWeatherLocation(locationQuery);
    const evidence = await fetchRaceWeatherEvidence(location, start, end);
    const interpretation = await interpretWeatherWithAi(evidence);
    const conditions: RaceConditions = {
      windMinKts: evidence.windMinKts,
      windMaxKts: evidence.windMaxKts,
      windDirDeg: evidence.windDirectionDeg,
      seaState: interpretation.seaState,
      notes: interpretation.notes,
      source: {
        evidence,
        ai: interpretation.model
          ? { provider: "anthropic", model: interpretation.model, generatedAt: new Date().toISOString() }
          : null,
        seaStateBasis: interpretation.seaStateBasis,
      },
    };
    return NextResponse.json({
      conditions,
      resolvedLocation: formatWeatherLocation(location),
      warning: interpretation.warning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate weather metadata.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
