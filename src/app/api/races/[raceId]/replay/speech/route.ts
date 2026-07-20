import { NextResponse } from "next/server";

import { buildReplayCommentaryItems } from "@/components/replay/replay-commentary-model";
import {
  clipReplaySpeechText,
  generateReplaySpeech,
  parseReplaySpeechRequest,
} from "@/lib/ai/speech";
import { hasClubAiEntitlement } from "@/lib/billing/server";
import { parseStoredRaceAnalysis } from "@/lib/races/stored-analysis";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function boatName(boats: { name: string | null } | { name: string | null }[] | null): string {
  if (!boats) return "Unknown boat";
  const row = Array.isArray(boats) ? boats[0] : boats;
  return row?.name?.trim() || "Unknown boat";
}

async function requireMember(raceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: json({ error: "Not signed in." }, 401) } as const;

  // RLS-visible read proves race membership before any AI spend.
  const { data: race, error } = await supabase
    .from("races")
    .select("id, organizer_id")
    .eq("id", raceId)
    .maybeSingle();
  if (error) return { response: json({ error: "Could not load race." }, 500) } as const;
  if (!race) return { response: json({ error: "Race not found." }, 404) } as const;
  return { supabase, user, race } as const;
}

/**
 * Speak one persisted play-by-play commentary item with OpenAI TTS.
 * The server resolves text from the race analysis ledger — clients cannot
 * inject arbitrary prompts.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const access = await requireMember(raceId);
  if ("response" in access) return access.response;

  if (!(await hasClubAiEntitlement(access.race.organizer_id))) {
    return json(
      { error: "Activate Club AI to hear OpenAI play-by-play during replay." },
      402,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const parsed = parseReplaySpeechRequest(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);

  const [{ data: analysisRow }, { data: entries }, { data: correctionsRow }] =
    await Promise.all([
      access.supabase
        .from("race_analyses")
        .select("analysis, computed_at")
        .eq("race_id", raceId)
        .maybeSingle(),
      access.supabase
        .from("race_entries")
        .select("id, boats(name), tracks(status, updated_at)")
        .eq("race_id", raceId),
      access.supabase
        .from("race_corrections")
        .select("updated_at")
        .eq("race_id", raceId)
        .maybeSingle(),
    ]);

  const processedTrackUpdatedAts = (entries ?? [])
    .map((entry) => entry.tracks)
    .filter((track) => track?.status === "processed")
    .map((track) => track?.updated_at);

  const stored = parseStoredRaceAnalysis({
    value: analysisRow?.analysis,
    computedAt: analysisRow?.computed_at ?? null,
    processedTrackUpdatedAts,
    correctionsUpdatedAt: correctionsRow?.updated_at ?? null,
  });
  if (stored.replayEventsStatus !== "valid" || !stored.analysis?.replayEvents) {
    return json({ error: "Play-by-play is not available for this race." }, 409);
  }

  const names = new Map(
    (entries ?? []).map((entry) => [entry.id, boatName(entry.boats)]),
  );
  const items = buildReplayCommentaryItems(stored.analysis.replayEvents, names);
  const item = items.find((candidate) => candidate.id === parsed.itemId);
  if (!item) {
    return json({ error: "Commentary item not found." }, 404);
  }

  try {
    const spoken = await generateReplaySpeech({
      // Long mark-rounding clusters are clipped to the TTS budget.
      text: clipReplaySpeechText(item.text),
      voice: parsed.voice,
      signal: request.signal,
    });
    return new NextResponse(Buffer.from(spoken.audio), {
      status: 200,
      headers: {
        "Content-Type": spoken.contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Replay-Speech-Item": item.id,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1_000) : "Speech generation failed.";
    const status = /AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN/.test(message) ? 503 : 502;
    return json({ error: message }, status);
  }
}
