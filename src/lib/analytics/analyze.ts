import { aggregateEntry, aggregateFleet } from "@/lib/analytics/aggregates";
import type { RaceCorrections } from "@/lib/analytics/corrections";
import {
  columnLength,
  compactInvalidTimeRows,
  epochAt,
  finite,
  hasMismatchedColumns,
} from "@/lib/analytics/internal";
import { detectManeuvers } from "@/lib/analytics/maneuvers";
import { buildRaceStructure, detectRaceWindow } from "@/lib/analytics/race";
import type {
  AnalysisWarning,
  EntryAnalysis,
  ProcessedTrack,
  RaceAnalysis,
} from "@/lib/analytics/types";
import { analyzeWind } from "@/lib/analytics/wind";

/** Optional analysis knobs. Corrections are threaded in Phase 1+. */
export interface AnalyzeOptions {
  corrections?: RaceCorrections | null;
}

function canonicalTrack(track: ProcessedTrack, canonicalTracks: Map<ProcessedTrack, string>): string {
  const cached = canonicalTracks.get(track);
  if (cached !== undefined) return cached;
  const canonical = JSON.stringify(track);
  canonicalTracks.set(track, canonical);
  return canonical;
}

function compareTrackOrder(
  a: ProcessedTrack,
  b: ProcessedTrack,
  canonicalTracks: Map<ProcessedTrack, string>,
): number {
  if (a.entryId !== b.entryId) return a.entryId < b.entryId ? -1 : 1;
  if (a.t0 !== b.t0) return a.t0 - b.t0;
  const aCanonical = canonicalTrack(a, canonicalTracks);
  const bCanonical = canonicalTrack(b, canonicalTracks);
  return aCanonical < bCanonical ? -1 : aCanonical > bCanonical ? 1 : 0;
}

function trackQuality(track: ProcessedTrack): number[] {
  const length = columnLength(track);
  let validPositions = 0;
  let validSailingRows = 0;
  for (let i = 0; i < length; i++) {
    if (finite(epochAt(track, i)) && finite(track.lat[i]) && finite(track.lon[i])) validPositions++;
    if (finite(track.cog[i]) && finite(track.sog[i])) validSailingRows++;
  }
  return [
    track.extras?.timerEvents.length ?? 0,
    track.extras?.windSamples.length ?? 0,
    track.extras?.linePings.length ?? 0,
    length > 0 ? validPositions / length : 0,
    length > 0 ? validSailingRows / length : 0,
    validPositions,
    validSailingRows,
    length,
    -track.warnings.length,
  ];
}

function preferTrack(
  candidate: ProcessedTrack,
  current: ProcessedTrack,
  canonicalTracks: Map<ProcessedTrack, string>,
): boolean {
  const candidateQuality = trackQuality(candidate);
  const currentQuality = trackQuality(current);
  for (let i = 0; i < candidateQuality.length; i++) {
    if (candidateQuality[i] !== currentQuality[i]) return candidateQuality[i] > currentQuality[i];
  }
  return canonicalTrack(candidate, canonicalTracks) > canonicalTrack(current, canonicalTracks);
}

function validateTracks(tracks: readonly ProcessedTrack[], warnings: AnalysisWarning[]): void {
  if (tracks.length === 0) {
    warnings.push({ code: "no-tracks", message: "No processed tracks were supplied.", entryId: null });
    return;
  }
  const ids = new Set<string>();
  for (const track of tracks) {
    if (ids.has(track.entryId)) {
      warnings.push({
        code: "duplicate-entry-id",
        message: "More than one processed track uses this entry ID; both were retained in deterministic order.",
        entryId: track.entryId,
      });
    }
    ids.add(track.entryId);
    const length = columnLength(track);
    if (length === 0) {
      warnings.push({ code: "empty-track", message: "The processed track has no complete rows.", entryId: track.entryId });
      continue;
    }
    if (hasMismatchedColumns(track)) {
      warnings.push({
        code: "mismatched-track-columns",
        message: `Processed-track columns have different lengths; analysis used the shortest ${length} rows.`,
        entryId: track.entryId,
      });
    }
    let invalid = 0;
    for (let i = 0; i < length; i++) {
      if (!finite(epochAt(track, i)) || !finite(track.lat[i]) || !finite(track.lon[i])) invalid++;
    }
    if (invalid > 0) {
      warnings.push({
        code: "invalid-track-points",
        message: `${invalid} processed rows contain invalid time or position values and were ignored where necessary.`,
        entryId: track.entryId,
      });
    }
  }
}

// Deterministic fleet analytics entrypoint. It does not mutate tracks, perform
// I/O, or depend on wall-clock time, and its result is safe to JSON.stringify.
// `options` is accepted for back-compat with future correction threading (Phase 1).
export function analyzeRace(
  tracks: ProcessedTrack[],
  options?: AnalyzeOptions,
): RaceAnalysis {
  void options;
  const canonicalTracks = new Map<ProcessedTrack, string>();
  const ordered = [...tracks].sort((a, b) => compareTrackOrder(a, b, canonicalTracks));
  const warnings: AnalysisWarning[] = [];
  validateTracks(ordered, warnings);

  const fleetSourceTracks = [...ordered.reduce((byEntry, track) => {
    const current = byEntry.get(track.entryId);
    if (!current || preferTrack(track, current, canonicalTracks)) byEntry.set(track.entryId, track);
    return byEntry;
  }, new Map<string, ProcessedTrack>()).values()];
  const compactedTracks = new Map<ProcessedTrack, ProcessedTrack>();
  const compact = (track: ProcessedTrack) => {
    const current = compactedTracks.get(track);
    if (current) return current;
    const result = compactInvalidTimeRows(track);
    compactedTracks.set(track, result);
    return result;
  };
  const fleetTracks = fleetSourceTracks.map(compact);
  const window = detectRaceWindow(fleetTracks, warnings);
  const wind = analyzeWind(fleetTracks, window.start.timeMs, window.finish.timeMs, warnings);
  const race = buildRaceStructure(fleetTracks, window, wind, warnings);
  const analyzed = ordered.map((sourceTrack) => {
    const track = compact(sourceTrack);
    const maneuvers = detectManeuvers(
      track,
      wind,
      race.start.timeMs,
      race.finish.timeMs,
    );
    const analysis: EntryAnalysis = {
      entryId: track.entryId,
      maneuvers,
      aggregates: aggregateEntry(
        track,
        maneuvers,
        wind,
        race.start.timeMs,
        race.finish.timeMs,
      ),
    };
    return { sourceTrack, analysis };
  });
  const perEntry = analyzed.map(({ analysis }) => analysis);
  const analysisBySourceTrack = new Map<ProcessedTrack, EntryAnalysis>();
  for (const { sourceTrack, analysis } of analyzed) {
    if (!analysisBySourceTrack.has(sourceTrack)) analysisBySourceTrack.set(sourceTrack, analysis);
  }
  const fleetEntries = fleetSourceTracks.map((track) => analysisBySourceTrack.get(track)!);

  return {
    v: 1,
    race,
    wind,
    perEntry,
    fleet: aggregateFleet(fleetEntries),
    warnings,
  };
}
