import type {
  PerformanceAnalysisV1,
  PerformanceMetricsV1,
  PerformanceProvenanceV1,
} from "@/lib/analytics/performance/types";
import {
  FIXTURE_COURSE_POSITIONS,
  FIXTURE_GUN_MS,
  FIXTURE_LEG_TYPES,
  FIXTURE_START_LINE,
  SIX_BOAT_FIVE_LEG_FIXTURE,
} from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";

const ENTRY_IDS = [...SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds];
const FINISHES = SIX_BOAT_FIVE_LEG_FIXTURE.expected.finishTimesMs;
const RANKS: Record<string, number> = {
  alpha: 3,
  bravo: 2,
  charlie: 5,
  delta: 1,
  echo: 6,
  foxtrot: 4,
};
const WINNER_FINISH_MS = FINISHES.delta;

function provenance(
  source: PerformanceProvenanceV1["source"] = "computed",
  confidence: PerformanceProvenanceV1["confidence"] = "high",
): PerformanceProvenanceV1 {
  return {
    source,
    confidence,
    inputs: ["synthetic-six-boat-five-leg-v1"],
    coveragePct: confidence === "unavailable" ? null : 100,
    note: null,
  };
}

function metrics(entryId: string, legIndex: number | null = null): PerformanceMetricsV1 {
  const elapsedMs = legIndex == null
    ? FINISHES[entryId as keyof typeof FINISHES] - FIXTURE_GUN_MS
    : 120_000 + RANKS[entryId] * 1_000 + legIndex * 250;
  return {
    entryId,
    elapsedMs,
    rank: RANKS[entryId],
    tied: false,
    deltaMs: legIndex == null ? FINISHES[entryId as keyof typeof FINISHES] - WINNER_FINISH_MS : (RANKS[entryId] - 1) * 1_000,
    avgSogKts: 6.1,
    maxSogKts: 7.4,
    sailedDistanceM: legIndex == null ? 3_500 : 700,
    courseDistanceM: legIndex == null ? 3_247 : 649.4,
    excessDistanceM: legIndex == null ? 253 : 50.6,
    courseEfficiencyPct: legIndex == null ? 92.77 : 92.77,
    upwindVmg: legIndex == null || FIXTURE_LEG_TYPES[legIndex] === "upwind"
      ? { straightKts: 4.8, maneuverKts: 2.7, straightDurationSec: 240, maneuverDurationSec: 30 }
      : null,
    downwindVmg: legIndex == null || FIXTURE_LEG_TYPES[legIndex] === "downwind"
      ? { straightKts: 5.2, maneuverKts: 3.1, straightDurationSec: 180, maneuverDurationSec: 24 }
      : null,
    avgAbsTwaDeg: 88,
    avgAbsHeelDeg: entryId === "foxtrot" ? null : 11,
    avgSignedTrimDeg: entryId === "foxtrot" ? null : 1.5,
    maneuvers: { tacks: 3, gybes: 2, botched: 1, unassigned: 0 },
    maneuverWindowDurationSec: 54,
    avgVmgRetention: 0.71,
    contributingDurationSec: elapsedMs / 1_000,
    sampleCount: Math.floor(elapsedMs / 1_000),
    excludedDurationSec: entryId === "echo" && legIndex === 2 ? 13 : 0,
    partial: false,
    warningCodes: entryId === "echo" && legIndex === 2 ? ["source-gap"] : [],
    provenance: provenance("computed"),
  };
}

export const VALID_PERFORMANCE_V1_FIXTURE: PerformanceAnalysisV1 = {
  v: 1,
  metricContract: "performance-overview-v1",
  calculationVersion: "fixture-contract-1",
  timezone: { iana: "America/Detroit", source: "race" },
  course: {
    points: FIXTURE_COURSE_POSITIONS.map((position, index) => ({
      index,
      kind: index === 0 ? "start" : index === FIXTURE_COURSE_POSITIONS.length - 1 ? "finish" : "mark",
      atMs: index === 0 ? FIXTURE_GUN_MS : Math.min(...ENTRY_IDS.map((entryId) => SIX_BOAT_FIVE_LEG_FIXTURE.expected.passageTimesMs[entryId as keyof typeof SIX_BOAT_FIVE_LEG_FIXTURE.expected.passageTimesMs][index - 1])),
      position,
      line: index === 0 ? { ...FIXTURE_START_LINE, lengthM: 90, bearingDeg: 90 } : null,
      supportingEntryCount: 6,
      spreadM: index === 0 ? 0 : 6,
      provenance: provenance(index === 0 ? "detected-geometry" : "passage-approach"),
    })),
    legs: FIXTURE_LEG_TYPES.map((type, index) => ({
      index,
      type,
      startPointIndex: index,
      endPointIndex: index + 1,
      start: FIXTURE_COURSE_POSITIONS[index],
      end: FIXTURE_COURSE_POSITIONS[index + 1],
      distanceM: [650.1, 643.1, 648.1, 652.1, 653.6][index],
      bearingDeg: type === "upwind" ? 359 : 179,
      courseTwaDeg: type === "upwind" ? 0 : 180,
      supportingEntryCount: 6,
      provenance: provenance("computed"),
    })),
    courseDistanceM: 3_247,
    passagesByEntry: ENTRY_IDS.map((entryId) => ({
      entryId,
      passages: [
        {
          pointIndex: 0,
          timeMs: FIXTURE_GUN_MS,
          minDistanceM: 0,
          source: "gun",
          confidence: "high",
          warningCodes: [],
        },
        ...SIX_BOAT_FIVE_LEG_FIXTURE.expected.passageTimesMs[entryId as keyof typeof SIX_BOAT_FIVE_LEG_FIXTURE.expected.passageTimesMs].map((timeMs, index) => ({
          pointIndex: index + 1,
          timeMs,
          minDistanceM: 2,
          source: index === 4 ? "timer-event" as const : "segment-approach" as const,
          confidence: "high" as const,
          warningCodes: [] as string[],
        })),
      ],
    })),
    reviewRequired: false,
    provenance: provenance("computed"),
  },
  results: ENTRY_IDS.map((entryId) => {
    const finishMs = FINISHES[entryId as keyof typeof FINISHES];
    return {
      entryId,
      status: "finished" as const,
      finish: {
        timeMs: finishMs,
        source: "timer-event" as const,
        confidence: "high" as const,
        distanceM: 2,
        crossing: true,
      },
      elapsedMs: finishMs - FIXTURE_GUN_MS,
      rank: RANKS[entryId],
      tied: false,
      deltaMs: finishMs - WINNER_FINISH_MS,
      officialPlaceOverride: null,
      note: null,
      reviewRequired: false,
      warningCodes: [],
      provenance: provenance("timer-event"),
    };
  }),
  start: {
    gunTimeMs: FIXTURE_GUN_MS,
    line: { ...FIXTURE_START_LINE, lengthM: 90, bearingDeg: 90 },
    courseSideBearingDeg: 359,
    windowStartMs: FIXTURE_GUN_MS - 60_000,
    windowEndMs: FIXTURE_GUN_MS + 60_000,
    entries: ENTRY_IDS.map((entryId, index) => {
      const ocs = entryId === "charlie";
      const crossingTimeMs = SIX_BOAT_FIVE_LEG_FIXTURE.expected.startCrossingTimesMs[entryId as keyof typeof SIX_BOAT_FIVE_LEG_FIXTURE.expected.startCrossingTimesMs];
      return {
        entryId,
        status: ocs ? "ocs-recrossed" as const : "legal" as const,
        crossingTimeMs,
        timeToLineMs: crossingTimeMs - FIXTURE_GUN_MS,
        sogAtGunKts: 5.4,
        sogAtLineKts: 5.8,
        distanceToLineAtGunM: ocs ? 6 : index + 2,
        signedLineSideDistanceAtGunM: ocs ? 6 : -(index + 2),
        dmg30M: 85 - index * 3,
        vmg30Kts: (85 - index * 3) / 30 / 0.514444,
        rank: SIX_BOAT_FIVE_LEG_FIXTURE.expected.startRanks[entryId as keyof typeof SIX_BOAT_FIVE_LEG_FIXTURE.expected.startRanks],
        warningCodes: [],
        provenance: provenance("line-crossing"),
      };
    }),
    provenance: provenance("corrected-analysis"),
  },
  wholeRace: ENTRY_IDS.map((entryId) => metrics(entryId)),
  legs: FIXTURE_LEG_TYPES.map((type, index) => ({
    index,
    type,
    startPointIndex: index,
    endPointIndex: index + 1,
    metrics: ENTRY_IDS.map((entryId) => metrics(entryId, index)),
    provenance: provenance("computed"),
  })),
  bestIntervals: ENTRY_IDS.map((entryId) => ({ entryId, intervals: [null, null, null] })),
  distributions: [],
  warnings: [{
    code: "source-gap",
    message: "Echo contains a synthetic source gap longer than 10 seconds.",
    entryId: "echo",
    legIndex: 2,
  }],
  provenance: {
    metricContract: "performance-overview-v1",
    calculationVersion: "fixture-contract-1",
    windSource: "manual",
    windConfidence: "high",
    correctionsVersion: 1,
    entryIds: ENTRY_IDS,
    constants: {
      resampleHz: 1,
      maxSourceGapMs: 10_000,
      distributionBinKts: 0.25,
      distributionMaxKts: 50,
    },
  },
};
