import { norm180 } from "@/lib/analytics/angles";
import { haversineM } from "@/lib/analytics/geo";
import { columnLength, epochAt, finite, mean, nullable, round } from "@/lib/analytics/internal";
import type {
  EntryAggregates,
  EntryAnalysis,
  FleetAggregates,
  Maneuver,
  ProcessedTrack,
  WindAnalysis,
} from "@/lib/analytics/types";
import { windDirectionAt } from "@/lib/analytics/wind";

export function aggregateEntry(
  track: ProcessedTrack,
  maneuvers: readonly Maneuver[],
  wind: WindAnalysis,
  raceStartMs: number | null,
  raceFinishMs: number | null,
): EntryAggregates {
  const length = columnLength(track);
  const speeds: number[] = [];
  const vmgs: number[] = [];
  let distanceM = 0;
  let pointCount = 0;
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  let previousIndex = -1;

  for (let i = 0; i < length; i++) {
    const timeMs = epochAt(track, i);
    if (!finite(timeMs)) {
      previousIndex = -1;
      continue;
    }
    if ((raceStartMs !== null && timeMs < raceStartMs) || (raceFinishMs !== null && timeMs > raceFinishMs)) {
      continue;
    }
    if (!finite(track.lat[i]) || !finite(track.lon[i])) {
      previousIndex = -1;
      continue;
    }
    pointCount++;
    firstTime ??= timeMs;
    lastTime = timeMs;
    if (finite(track.sog[i])) {
      speeds.push(track.sog[i]);
      const twdDeg = windDirectionAt(wind, timeMs);
      if (twdDeg !== null && finite(track.cog[i])) {
        const twaDeg = norm180(twdDeg - track.cog[i]);
        vmgs.push(Math.abs(track.sog[i] * Math.cos((twaDeg * Math.PI) / 180)));
      }
    }
    if (
      previousIndex >= 0 &&
      track.t[i] - track.t[previousIndex] <= 60_000 &&
      finite(track.lat[previousIndex]) &&
      finite(track.lon[previousIndex])
    ) {
      distanceM += haversineM(
        track.lat[previousIndex],
        track.lon[previousIndex],
        track.lat[i],
        track.lon[i],
      );
    }
    previousIndex = i;
  }

  const retentions = maneuvers
    .map((maneuver) => maneuver.vmgRetention)
    .filter(finite);
  return {
    pointCount,
    startTimeMs: firstTime,
    endTimeMs: lastTime,
    distanceNm: round(distanceM / 1852, 3),
    avgSogKts: nullable(mean(speeds), 3),
    maxSogKts: nullable(speeds.length > 0 ? Math.max(...speeds) : NaN, 3),
    avgAbsVmgKts: nullable(mean(vmgs), 3),
    tackCount: maneuvers.filter((maneuver) => maneuver.type === "tack").length,
    gybeCount: maneuvers.filter((maneuver) => maneuver.type === "gybe").length,
    botchedCount: maneuvers.filter((maneuver) => maneuver.botched).length,
    avgVmgRetention: nullable(mean(retentions), 3),
    inputWarningCount: track.warnings.length,
  };
}

export function aggregateFleet(entries: readonly EntryAnalysis[]): FleetAggregates {
  const withPoints = entries.filter((entry) => entry.aggregates.pointCount > 0);
  const totalPoints = withPoints.reduce((sum, entry) => sum + entry.aggregates.pointCount, 0);
  const weightedMean = (field: "avgSogKts" | "avgAbsVmgKts") => {
    let sum = 0;
    let weight = 0;
    for (const entry of withPoints) {
      const value = entry.aggregates[field];
      if (value === null) continue;
      sum += value * entry.aggregates.pointCount;
      weight += entry.aggregates.pointCount;
    }
    return weight > 0 ? sum / weight : NaN;
  };
  const maneuvers = entries.flatMap((entry) => entry.maneuvers);
  const retentions = maneuvers.map((maneuver) => maneuver.vmgRetention).filter(finite);
  const maximums = withPoints.map((entry) => entry.aggregates.maxSogKts).filter(finite);
  return {
    entryCount: entries.length,
    pointCount: totalPoints,
    avgDistanceNm: nullable(mean(withPoints.map((entry) => entry.aggregates.distanceNm)), 3),
    avgSogKts: nullable(weightedMean("avgSogKts"), 3),
    maxSogKts: nullable(maximums.length > 0 ? Math.max(...maximums) : NaN, 3),
    avgAbsVmgKts: nullable(weightedMean("avgAbsVmgKts"), 3),
    maneuverCount: maneuvers.length,
    tackCount: maneuvers.filter((maneuver) => maneuver.type === "tack").length,
    gybeCount: maneuvers.filter((maneuver) => maneuver.type === "gybe").length,
    botchedCount: maneuvers.filter((maneuver) => maneuver.botched).length,
    avgVmgRetention: nullable(mean(retentions), 3),
  };
}
