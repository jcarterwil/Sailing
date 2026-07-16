import { NextResponse } from "next/server";

import {
  requireBoatEditor,
  requireBoatViewer,
} from "@/lib/boats/performance-history/auth";
import {
  assertHandoffCitationsIntact,
  buildCitedPerformanceHistoryHandoff,
} from "@/lib/boats/performance-history/handoff";
import { generatePerformanceHistoryCoachNotes } from "@/lib/boats/performance-history/generate-coach";
import { loadBoatSessionObservations } from "@/lib/boats/performance-history/load";
import {
  parseHistoryQueryParams,
  queryBoatPerformanceHistory,
} from "@/lib/boats/performance-history/query";
import { resolveMetadataFilterContext } from "@/lib/boats/performance-history/resolve-metadata-context";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function loadCitedHandoff(boatId: string, request: Request) {
  const auth = await requireBoatViewer(boatId);
  if ("error" in auth) {
    return { ok: false as const, response: auth.error };
  }

  const filters = parseHistoryQueryParams(new URL(request.url).searchParams);
  const { snapshotsByEntryId, entryIds } = await resolveMetadataFilterContext(
    auth.supabase,
    boatId,
    filters,
  );
  const rows = await loadBoatSessionObservations(auth.supabase, boatId, filters, {
    entryIds,
  });
  const history = queryBoatPerformanceHistory(boatId, rows, filters, {
    snapshotsByEntryId: entryIds ? snapshotsByEntryId : undefined,
  });
  const handoff = buildCitedPerformanceHistoryHandoff(history);
  const citations = assertHandoffCitationsIntact(handoff);
  if (!citations.ok) {
    return {
      ok: false as const,
      response: json(
        { error: "Handoff citation integrity failed.", issues: citations.issues },
        500,
      ),
    };
  }
  return { ok: true as const, handoff };
}

/**
 * GET  — return the compact cited Coach handoff for the current filters.
 * POST — optionally generate Coach notes from that cited handoff only.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ boatId: string }> },
) {
  const { boatId } = await context.params;
  const loaded = await loadCitedHandoff(boatId, request);
  if (!loaded.ok) return loaded.response;
  return json(loaded.handoff);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ boatId: string }> },
) {
  const { boatId } = await context.params;
  // Generation burns Anthropic tokens — editors/owners only. Viewers may GET the handoff.
  const editor = await requireBoatEditor(boatId);
  if ("error" in editor) return editor.error;

  const loaded = await loadCitedHandoff(boatId, request);
  if (!loaded.ok) return loaded.response;

  try {
    const generated = await generatePerformanceHistoryCoachNotes(loaded.handoff);
    return json({ handoff: loaded.handoff, ...generated });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1_000) : "Coach generation failed.";
    const status = /ANTHROPIC_API_KEY/.test(message) ? 503 : 500;
    return json({ error: message, handoff: loaded.handoff }, status);
  }
}
