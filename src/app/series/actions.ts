"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  DEFAULT_LOW_POINT_CONFIG_V1,
  scoreSeriesLowPointV1,
} from "@/lib/analytics/series/scoring";
import { LOW_POINT_V1 } from "@/lib/analytics/series/types";
import { isValidIanaTimezone } from "@/lib/races/meta";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { loadSeriesEditorModel } from "@/lib/series/server";
import {
  projectSeriesWorkflowV1,
  type SeriesWorkflowProjectionV1,
} from "@/lib/series/workflow";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface SaveSeriesSetupInput {
  seriesId: string;
  expectedRevision: number;
  name: string;
  venue: string;
  timezone: string;
  startsOn: string | null;
  endsOn: string | null;
  scoringVersion: string;
  scoringConfig: unknown;
  races: Array<{
    raceId: string;
    sequence: number;
    included: boolean;
    discardEligible: boolean;
    state: "scheduled" | "completed" | "abandoned";
  }>;
  competitors: Array<{
    boatId: string;
    role: "competitor" | "guest";
  }>;
  aliases: Array<{
    sourceBoatId: string;
    canonicalBoatId: string;
    note: string;
  }>;
}

export interface SeriesDraftInput {
  seriesId: string;
  expectedRevision: number;
  draftOfficialResults: Array<{
    raceId: string;
    rows: unknown;
  }>;
}

export interface SeriesPreviewResponse {
  revision: number;
  projection: SeriesWorkflowProjectionV1;
  previousSnapshot: {
    revision: number;
    computedAt: string;
    sourceFingerprint: string;
    result: NonNullable<Awaited<ReturnType<typeof loadSeriesEditorModel>>["latestSnapshot"]>["result"];
  } | null;
}

async function requireActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");
  return { supabase, user };
}

function requireUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`Choose a valid ${label}.`);
}

function requireRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid series revision.");
}

function cleanDate(value: string | null, label: string): string | null {
  if (value === null || value === "") return null;
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Enter a valid ${label}.`);
  }
  return value;
}

function validateSetup(input: SaveSeriesSetupInput): SaveSeriesSetupInput {
  requireUuid(input.seriesId, "series");
  requireRevision(input.expectedRevision);
  const name = input.name.trim();
  const venue = input.venue.trim();
  const timezone = input.timezone.trim();
  if (!name || name.length > 160) {
    throw new Error("Series name must be between 1 and 160 characters.");
  }
  if (venue.length > 240) throw new Error("Venue must be 240 characters or fewer.");
  if (timezone && !isValidIanaTimezone(timezone)) {
    throw new Error("Enter a valid IANA timezone, such as America/Detroit.");
  }
  const startsOn = cleanDate(input.startsOn, "start date");
  const endsOn = cleanDate(input.endsOn, "end date");
  if (startsOn && endsOn && startsOn > endsOn) {
    throw new Error("The series end date cannot be before its start date.");
  }
  if (input.scoringVersion !== LOW_POINT_V1) {
    throw new Error("This organizer supports low-point-v1 scoring only.");
  }
  const scoringCheck = scoreSeriesLowPointV1({
    v: 1,
    scoringVersion: LOW_POINT_V1,
    config: input.scoringConfig,
    competitors: [],
    races: [],
  });
  if (scoringCheck.status !== "valid") {
    throw new Error(scoringCheck.issues[0]?.message ?? "Scoring configuration is invalid.");
  }
  if (input.races.length > 100 || input.competitors.length > 200 || input.aliases.length > 200) {
    throw new Error("Series setup exceeds the supported contract limits.");
  }

  const raceIds = new Set<string>();
  const sequences = new Set<number>();
  for (const race of input.races) {
    requireUuid(race.raceId, "race");
    if (raceIds.has(race.raceId) || sequences.has(race.sequence)) {
      throw new Error("Each selected race and sequence must be unique.");
    }
    if (!Number.isSafeInteger(race.sequence) || race.sequence < 1 || race.sequence > 10_000) {
      throw new Error("Race sequence is invalid.");
    }
    raceIds.add(race.raceId);
    sequences.add(race.sequence);
  }

  const competitorIds = new Set<string>();
  const competitorRoles = new Map<string, "competitor" | "guest">();
  for (const competitor of input.competitors) {
    requireUuid(competitor.boatId, "boat");
    if (competitorIds.has(competitor.boatId)) {
      throw new Error("A boat can appear only once in the competitor list.");
    }
    competitorIds.add(competitor.boatId);
    competitorRoles.set(competitor.boatId, competitor.role);
  }

  const aliasSources = new Set<string>();
  for (const alias of input.aliases) {
    requireUuid(alias.sourceBoatId, "source boat");
    requireUuid(alias.canonicalBoatId, "canonical boat");
    if (aliasSources.has(alias.sourceBoatId) || competitorIds.has(alias.sourceBoatId)) {
      throw new Error("Each alias source must be unique and cannot be registered directly.");
    }
    if (
      alias.sourceBoatId === alias.canonicalBoatId ||
      competitorRoles.get(alias.canonicalBoatId) !== "competitor"
    ) {
      throw new Error("Every alias must explicitly target a registered competitor.");
    }
    if (alias.note.trim().length > 1000) throw new Error("Alias notes are limited to 1000 characters.");
    aliasSources.add(alias.sourceBoatId);
  }

  return { ...input, name, venue, timezone, startsOn, endsOn };
}

function validateDraftInput(input: SeriesDraftInput): void {
  requireUuid(input.seriesId, "series");
  requireRevision(input.expectedRevision);
  if (!Array.isArray(input.draftOfficialResults) || input.draftOfficialResults.length > 100) {
    throw new Error("Official-result drafts exceed the supported race limit.");
  }
  const raceIds = new Set<string>();
  for (const draft of input.draftOfficialResults) {
    requireUuid(draft.raceId, "race");
    if (raceIds.has(draft.raceId) || !Array.isArray(draft.rows) || draft.rows.length > 300) {
      throw new Error("Official-result drafts are malformed or duplicated.");
    }
    raceIds.add(draft.raceId);
  }
  if (JSON.stringify(input.draftOfficialResults).length > 1_000_000) {
    throw new Error("Official-result drafts are too large.");
  }
}

function previewFromModel(
  model: Awaited<ReturnType<typeof loadSeriesEditorModel>>,
  drafts: SeriesDraftInput["draftOfficialResults"],
): SeriesPreviewResponse {
  const projection = projectSeriesWorkflowV1({
    seriesId: model.series.id,
    scoringVersion: model.series.scoringVersion,
    scoringConfig: model.series.scoringConfig,
    competitors: model.competitors,
    aliases: model.aliases,
    races: model.races,
    draftOfficialResults: drafts,
  });
  return {
    revision: model.series.revision,
    projection,
    previousSnapshot: model.latestSnapshot
      ? {
          revision: model.latestSnapshot.revision,
          computedAt: model.latestSnapshot.computedAt,
          sourceFingerprint: model.latestSnapshot.sourceFingerprint,
          result: model.latestSnapshot.result,
        }
      : null,
  };
}

export async function createSeries(formData: FormData): Promise<void> {
  const { supabase, user } = await requireActor();
  const name = String(formData.get("name") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim();
  if (!name || name.length > 160) {
    throw new Error("Series name must be between 1 and 160 characters.");
  }
  if (venue.length > 240) throw new Error("Venue must be 240 characters or fewer.");

  const { data: series, error } = await supabase
    .from("race_series")
    .insert({
      organizer_id: user.id,
      name,
      venue: venue || null,
      scoring_version: LOW_POINT_V1,
      scoring_config: DEFAULT_LOW_POINT_CONFIG_V1 as unknown as Json,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create series: ${error.message}`);
  redirect(`/series/${series.id}/edit`);
}

export async function saveSeriesSetup(input: SaveSeriesSetupInput): Promise<{ revision: number }> {
  const validated = validateSetup(input);
  const { supabase, user } = await requireActor();
  const { data: canOrganize, error: authzError } = await supabase.rpc(
    "is_race_series_organizer",
    { sid: validated.seriesId },
  );
  if (authzError) throw new Error(`Could not check series permissions: ${authzError.message}`);
  if (!canOrganize) throw new Error("Series not found or access denied.");

  // Service role is used only for the transactional setup RPC. The session and
  // organizer permission were checked above; the RPC repeats authorization.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("save_race_series_setup", {
    series_id_input: validated.seriesId,
    actor_id_input: user.id,
    expected_revision_input: validated.expectedRevision,
    name_input: validated.name,
    venue_input: validated.venue,
    timezone_input: validated.timezone,
    starts_on_input: validated.startsOn,
    ends_on_input: validated.endsOn,
    scoring_version_input: validated.scoringVersion,
    scoring_config_input: validated.scoringConfig as Json,
    races_input: validated.races.map((race) => ({
      race_id: race.raceId,
      sequence: race.sequence,
      included: race.included,
      discard_eligible: race.discardEligible,
      state: race.state,
    })) as Json,
    competitors_input: validated.competitors.map((competitor) => ({
      boat_id: competitor.boatId,
      role: competitor.role,
    })) as Json,
    aliases_input: validated.aliases.map((alias) => ({
      source_boat_id: alias.sourceBoatId,
      canonical_boat_id: alias.canonicalBoatId,
      note: alias.note.trim(),
    })) as Json,
  });
  if (error) {
    if (error.code === "40001") {
      throw new Error("This series changed in another tab. Reload before saving again.");
    }
    throw new Error(`Could not save series setup: ${error.message}`);
  }
  revalidatePath("/series");
  revalidatePath(`/series/${validated.seriesId}/edit`);
  return { revision: data };
}

export async function archiveSeries(input: {
  seriesId: string;
  expectedRevision: number;
  archived: boolean;
}): Promise<void> {
  requireUuid(input.seriesId, "series");
  requireRevision(input.expectedRevision);
  const { supabase } = await requireActor();
  const { data, error } = await supabase
    .from("race_series")
    .update({
      archived_at: input.archived ? new Date().toISOString() : null,
      revision: input.expectedRevision + 1,
    })
    .eq("id", input.seriesId)
    .eq("revision", input.expectedRevision)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not ${input.archived ? "archive" : "restore"} series: ${error.message}`);
  if (!data) throw new Error("This series changed in another tab. Reload and try again.");
  revalidatePath("/series");
  revalidatePath(`/series/${input.seriesId}/edit`);
}

export async function previewSeriesScoring(input: SeriesDraftInput): Promise<SeriesPreviewResponse> {
  validateDraftInput(input);
  const { supabase, user } = await requireActor();
  const model = await loadSeriesEditorModel(supabase, user.id, input.seriesId);
  if (model.series.revision !== input.expectedRevision) {
    throw new Error("This series changed in another tab. Reload before previewing again.");
  }
  return previewFromModel(model, input.draftOfficialResults);
}

export async function applySeriesScoring(input: SeriesDraftInput): Promise<{
  revision: number;
  snapshotId: string;
  snapshotRevision: number;
  idempotent: boolean;
  projection: SeriesWorkflowProjectionV1;
}> {
  validateDraftInput(input);
  const { supabase, user } = await requireActor();
  // Re-read all race evidence under the caller's RLS session. Browser-provided
  // analysis, source versions, and identity decisions are never authoritative.
  const model = await loadSeriesEditorModel(supabase, user.id, input.seriesId);
  if (model.series.revision !== input.expectedRevision) {
    throw new Error("This series changed in another tab. Reload before applying again.");
  }
  const preview = previewFromModel(model, input.draftOfficialResults);
  const { projection } = preview;
  if (projection.status !== "ready" || !projection.result) {
    throw new Error(projection.issues[0]?.message ?? "Resolve every scoring blocker before applying.");
  }

  // Service role performs one CAS transaction after session/authz and the
  // authoritative source re-read above. The RPC repeats actor authorization
  // and source-revision checks before appending the immutable snapshot.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_race_series_score_snapshot", {
    series_id_input: input.seriesId,
    actor_id_input: user.id,
    expected_revision_input: input.expectedRevision,
    race_updates_input: projection.applyRaces.map((race) => ({
      race_id: race.raceId,
      expected_official_results_revision: race.expectedOfficialResultsRevision,
      next_official_results_revision: race.nextOfficialResultsRevision,
      expected_analysis_version: race.expectedAnalysisVersion,
      expected_corrections_version: race.expectedCorrectionsVersion,
      official_results: race.officialResults,
    })) as Json,
    snapshot_scoring_version_input: projection.result.scoringVersion,
    snapshot_fingerprint_input: projection.result.sourceFingerprint,
    snapshot_result_input: projection.result as unknown as Json,
  });
  const applied = data?.[0];
  if (error || !applied) {
    if (error?.code === "40001") {
      throw new Error("Race evidence changed after preview. Preview again before applying.");
    }
    throw new Error(`Could not apply series scoring: ${error?.message ?? "No result returned."}`);
  }

  revalidatePath("/series");
  revalidatePath(`/series/${input.seriesId}`);
  revalidatePath(`/series/${input.seriesId}/edit`);
  return {
    revision: applied.series_revision,
    snapshotId: applied.snapshot_id,
    snapshotRevision: applied.snapshot_revision,
    idempotent: applied.idempotent,
    projection,
  };
}
