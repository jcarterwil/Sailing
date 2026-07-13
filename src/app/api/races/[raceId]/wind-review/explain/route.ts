import { NextResponse } from "next/server";

import type { WindQualityReport } from "@/lib/analytics/types";
import { explainWindQuality } from "@/lib/report/wind-explain";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

function isWindQualityReport(value: unknown): value is WindQualityReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.boats);
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
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

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
      { error: "Only the organizer can request wind explanations." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const report =
    body && typeof body === "object" && !Array.isArray(body) && "windQuality" in body
      ? (body as { windQuality: unknown }).windQuality
      : body;
  if (!isWindQualityReport(report)) {
    return NextResponse.json({ error: "windQuality report is required." }, { status: 400 });
  }

  const result = await explainWindQuality(report);
  return NextResponse.json(result);
}
