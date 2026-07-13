import { NextResponse } from "next/server";

import type { RaceAnalysis } from "@/lib/analytics/types";
import {
  analysisMatchesCurrentFleet,
  buildDossierStats,
} from "@/lib/report/dossier-stats";
import { generateDossier } from "@/lib/report/generate";
import {
  expireStaleReportGenerations,
  loadReportSnapshot,
  REPORT_GENERATION_TTL_MS,
} from "@/lib/report/queries";
import {
  REPORT_SUMMARY_COLUMNS,
  toReportSummary,
} from "@/lib/report/report-summary";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const REPORT_LIMIT = 10;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Report generation failed.";
  return message.slice(0, 1_000);
}

async function requireMember(raceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: json({ error: "Not signed in." }, 401) } as const;

  // RLS-visible read proves race membership before any service-role access.
  const { data: race, error } = await supabase
    .from("races")
    .select("id")
    .eq("id", raceId)
    .maybeSingle();
  if (error) return { response: json({ error: "Could not load race." }, 500) } as const;
  if (!race) return { response: json({ error: "Race not found." }, 404) } as const;
  return { supabase, user } as const;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const access = await requireMember(raceId);
  if ("response" in access) return access.response;

  try {
    await expireStaleReportGenerations(raceId);
    return json(await loadReportSnapshot(access.supabase, raceId));
  } catch (error) {
    return json({ error: safeErrorMessage(error) }, 500);
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const access = await requireMember(raceId);
  if ("response" in access) return access.response;

  const { data: canOrganize, error: organizerError } = await access.supabase.rpc(
    "is_race_organizer",
    { rid: raceId },
  );
  if (organizerError) {
    return json({ error: "Could not verify report access." }, 500);
  }
  if (!canOrganize) {
    return json({ error: "Only the organizer can generate a coach report." }, 403);
  }

  const admin = createAdminClient();
  const [activeResult, countResult, analysisResult, entriesResult] = await Promise.all([
    admin
      .from("race_reports")
      .select("id, created_at")
      .eq("race_id", raceId)
      .eq("status", "generating")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("race_reports")
      .select("id", { count: "exact", head: true })
      .eq("race_id", raceId),
    admin
      .from("race_analyses")
      .select("analysis")
      .eq("race_id", raceId)
      .maybeSingle(),
    admin
      .from("race_entries")
      .select("id, boats(name), tracks(status)")
      .eq("race_id", raceId),
  ]);
  if (
    activeResult.error ||
    countResult.error ||
    analysisResult.error ||
    entriesResult.error
  ) {
    return json({ error: "Could not prepare report generation." }, 500);
  }

  const now = Date.now();
  if (
    activeResult.data &&
    now - new Date(activeResult.data.created_at).getTime() < REPORT_GENERATION_TTL_MS
  ) {
    return json({ error: "A report is already being generated." }, 409);
  }
  if ((countResult.count ?? 0) >= REPORT_LIMIT) {
    return json({ error: `This race already has the maximum of ${REPORT_LIMIT} reports.` }, 429);
  }
  if (!analysisResult.data) {
    return json({ error: "Analyze the race before generating a report." }, 400);
  }

  const analysis = analysisResult.data.analysis as unknown as RaceAnalysis;
  const currentEntries = entriesResult.data ?? [];
  if (
    !analysisMatchesCurrentFleet(
      analysis,
      currentEntries.map((entry) => ({
        id: entry.id,
        processed: entry.tracks?.status === "processed",
      })),
    )
  ) {
    return json(
      { error: "The race analysis is stale. Process every current track and re-analyze first." },
      400,
    );
  }

  const staleBefore = new Date(now - REPORT_GENERATION_TTL_MS).toISOString();
  const { error: staleError } = await admin
    .from("race_reports")
    .update({
      status: "error",
      error_message: "Report generation timed out before completion.",
      completed_at: new Date(now).toISOString(),
    })
    .eq("race_id", raceId)
    .eq("status", "generating")
    .lt("created_at", staleBefore);
  if (staleError) {
    return json({ error: "Could not clear a stale report generation." }, 500);
  }

  const baseStats = buildDossierStats(analysis);
  const boatNameByEntryId = new Map(
    (entriesResult.data ?? []).map((entry) => [entry.id, entry.boats?.name ?? null]),
  );
  const statsPayload = {
    ...baseStats,
    entries: baseStats.entries.map((entry) => ({
      ...entry,
      boatName: boatNameByEntryId.get(entry.entryId) ?? null,
    })),
  };
  const { data: inserted, error: insertError } = await admin
    .from("race_reports")
    .insert({
      race_id: raceId,
      status: "generating",
      stats_payload: statsPayload as unknown as Json,
      requested_by: access.user.id,
    })
    .select(REPORT_SUMMARY_COLUMNS)
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      return json({ error: "A report is already being generated." }, 409);
    }
    return json({ error: "Could not start report generation." }, 500);
  }

  try {
    const generated = await generateDossier(statsPayload);
    const completedAt = new Date().toISOString();
    const { data: completed, error: updateError } = await admin
      .from("race_reports")
      .update({
        status: "complete",
        markdown: generated.markdown,
        model: generated.model,
        input_tokens: generated.inputTokens,
        output_tokens: generated.outputTokens,
        error_message: null,
        completed_at: completedAt,
      })
      .eq("id", inserted.id)
      .select(REPORT_SUMMARY_COLUMNS)
      .single();
    if (updateError) throw new Error(`Could not store generated report: ${updateError.message}`);
    const report = toReportSummary(completed);
    return json({ report, latestComplete: report });
  } catch (error) {
    const errorMessage = safeErrorMessage(error);
    const failedAt = new Date().toISOString();
    const { data: failed, error: failureUpdateError } = await admin
      .from("race_reports")
      .update({
        status: "error",
        error_message: errorMessage,
        completed_at: failedAt,
      })
      .eq("id", inserted.id)
      .select(REPORT_SUMMARY_COLUMNS)
      .maybeSingle();
    const report = failed
      ? toReportSummary(failed)
      : {
          ...toReportSummary(inserted),
          status: "error" as const,
          errorMessage: failureUpdateError
            ? `${errorMessage} The failure status could not be persisted.`
            : errorMessage,
          completedAt: failedAt,
        };
    return json(
      {
        error: errorMessage,
        report,
        latestComplete: null,
      },
      500,
    );
  }
}
