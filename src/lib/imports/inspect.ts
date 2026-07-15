import { parseTrackCsv } from "@/lib/analytics/parse/csv";
import { parseVkx } from "@/lib/analytics/parse/vkx";
import { buildTrackImportDigest } from "@/lib/analytics/track/import-digest";
import { buildProcessedTrack, summarizeTrack } from "@/lib/analytics/track/process";
import { ParseError } from "@/lib/analytics/types";
import { buildSessionCandidates, type SessionCandidateRow } from "@/lib/imports/candidates";
import { resolveDuplicateState, type TrackDuplicateProbe } from "@/lib/imports/duplicates";
import { sha256HexBytes } from "@/lib/imports/hash";
import type { HistoricalImportFormat } from "@/lib/imports/limits";
import { suggestSessionType } from "@/lib/imports/suggest-session-type";
import type { HistoricalImportInspection } from "@/lib/imports/types";

export function inspectHistoricalImportBytes(input: {
  bytes: Uint8Array;
  format: HistoricalImportFormat;
  byteSize: number;
  boatId: string;
  userId: string;
  canOrganizeByRaceId: ReadonlySet<string>;
  sessionRows: SessionCandidateRow[];
  boatTracks: TrackDuplicateProbe[];
}): HistoricalImportInspection {
  const contentSha256 = sha256HexBytes(input.bytes);
  let raw;
  try {
    raw =
      input.format === "vkx"
        ? parseVkx(input.bytes)
        : parseTrackCsv(new TextDecoder().decode(input.bytes));
  } catch (error) {
    if (error instanceof ParseError) throw error;
    throw new ParseError(
      error instanceof Error ? error.message : "Could not parse track file.",
    );
  }

  if (raw.points.length === 0) {
    throw new ParseError("Track file contains no usable points.");
  }

  const processed = buildProcessedTrack(raw, "historical-import-inspect");
  const summary = summarizeTrack(processed);
  const digest = buildTrackImportDigest(processed);
  const startedAtMs = processed.t0;
  const endedAtMs = processed.t0 + processed.t[processed.t.length - 1]!;
  const pointCount = processed.t.length;

  const proposedSessionType = suggestSessionType({
    timerEvents: processed.extras?.timerEvents,
    timerEventCount: digest.timerEventCount,
    linePingCount: digest.linePingCount,
  });

  const candidates = buildSessionCandidates({
    logStartMs: startedAtMs,
    logEndMs: endedAtMs,
    boatId: input.boatId,
    userId: input.userId,
    canOrganizeByRaceId: input.canOrganizeByRaceId,
    rows: input.sessionRows,
  });

  const duplicate = resolveDuplicateState({
    contentSha256,
    startedAtMs,
    endedAtMs,
    pointCount,
    boatTracks: input.boatTracks,
  });

  return {
    format: input.format,
    byteSize: input.byteSize,
    contentSha256,
    pointCount,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: endedAtMs - startedAtMs,
    bbox: summary.bbox,
    distanceNm: summary.distanceNm,
    digest: {
      warningCount: digest.warningCount,
      warnings: digest.warnings.slice(0, 20),
      hasWind: digest.hasWind,
      timerEventCount: digest.timerEventCount,
      linePingCount: digest.linePingCount,
    },
    proposedSessionType,
    candidates,
    duplicate,
  };
}
