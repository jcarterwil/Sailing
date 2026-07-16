import { NextResponse } from "next/server";

import {
  REVIEW_DRAFT_MAX_JSON_CHARS,
  normalizeReviewDraft,
} from "@/lib/review/draft";
import {
  deleteReviewDraft,
  loadReviewDraft,
  saveReviewDraft,
} from "@/lib/review/draft-store";
import { createClient } from "@/lib/supabase/server";

async function requireOrganizer(raceId: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  // RLS-visible read proves membership.
  const { data: race } = await supabase.from("races").select("id").eq("id", raceId).maybeSingle();
  if (!race) {
    return { ok: false, response: NextResponse.json({ error: "Race not found." }, { status: 404 }) };
  }
  const { data: canOrganize, error } = await supabase.rpc("is_race_organizer", { rid: raceId });
  if (error) {
    return { ok: false, response: NextResponse.json({ error: "Could not verify access." }, { status: 500 }) };
  }
  if (!canOrganize) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Only the organizer can edit the review draft." }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const auth = await requireOrganizer(raceId);
  if (!auth.ok) return auth.response;
  const stored = await loadReviewDraft(raceId);
  return NextResponse.json({ stored });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const auth = await requireOrganizer(raceId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (JSON.stringify(body).length > REVIEW_DRAFT_MAX_JSON_CHARS) {
    return NextResponse.json({ error: "Review draft is too large." }, { status: 413 });
  }
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  // Autosave is lightweight: normalize only. Deep span/entry validation stays
  // in POST /corrections at apply time (spec §5.2).
  const draft = normalizeReviewDraft(record.draft);
  const baseAnalysisComputedAt =
    typeof record.baseAnalysisComputedAt === "string" ? record.baseAnalysisComputedAt : null;
  const baseCorrectionsUpdatedAt =
    typeof record.baseCorrectionsUpdatedAt === "string" ? record.baseCorrectionsUpdatedAt : null;
  const { updatedAt } = await saveReviewDraft({
    raceId,
    userId: auth.userId,
    draft,
    baseAnalysisComputedAt,
    baseCorrectionsUpdatedAt,
  });
  return NextResponse.json({ updatedAt });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const auth = await requireOrganizer(raceId);
  if (!auth.ok) return auth.response;
  await deleteReviewDraft(raceId);
  return NextResponse.json({ ok: true });
}
