import { aggregateEntry, aggregateFleet } from "@/lib/analytics/aggregates";
import { columnLength, epochAt, finite, hasMismatchedColumns } from "@/lib/analytics/internal";
import { detectManeuvers } from "@/lib/analytics/maneuvers";
import { buildRaceStructure, detectRaceWindow } from "@/lib/analytics/race";
import type {
  AnalysisWarning,
  EntryAnalysis,
  ProcessedTrack,
  RaceAnalysis,
} from "@/lib/analytics/types";
import { analyzeWind } from "@/lib/analytics/wind";

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
export function analyzeRace(tracks: ProcessedTrack[]): RaceAnalysis {
  const ordered = [...tracks].sort(
    (a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : a.t0 - b.t0),
  );
  const warnings: AnalysisWarning[] = [];
  validateTracks(ordered, warnings);

  const fleetTracks = [...ordered.reduce((byEntry, track) => {
    const current = byEntry.get(track.entryId);
    if (!current || columnLength(track) > columnLength(current)) byEntry.set(track.entryId, track);
    return byEntry;
  }, new Map<string, ProcessedTrack>()).values()];
  const window = detectRaceWindow(fleetTracks, warnings);
  const wind = analyzeWind(fleetTracks, window.start.timeMs, window.finish.timeMs, warnings);
  const race = buildRaceStructure(fleetTracks, window, wind, warnings);
  const analyzed = ordered.map((track) => {
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
    return { track, analysis };
  });
  const perEntry = analyzed.map(({ analysis }) => analysis);
  const fleetTrackSet = new Set(fleetTracks);
  const fleetEntries = analyzed
    .filter(({ track }) => fleetTrackSet.has(track))
    .map(({ analysis }) => analysis);

  return {
    v: 1,
    race,
    wind,
    perEntry,
    fleet: aggregateFleet(fleetEntries),
    warnings,
  };
}
