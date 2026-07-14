import { DEFAULT_LOW_POINT_CONFIG_V1 } from "@/lib/analytics/series/scoring";
import {
  LOW_POINT_V1,
  type SeriesOfficialResultInputV1,
  type SeriesOfficialStatus,
  type SeriesRaceInputV1,
  type SeriesScoringInputV1,
} from "@/lib/analytics/series/types";

const COMPETITOR_IDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"] as const;

type ResultSpec = readonly [
  boatId: string,
  status: SeriesOfficialStatus,
  place?: number | null,
  tied?: boolean,
  penaltyPoints?: number,
  identity?: "competitor" | "guest",
];

function race(
  raceId: string,
  sequence: number,
  specs: readonly ResultSpec[],
  options: Partial<Pick<SeriesRaceInputV1, "included" | "state" | "discardEligible">> = {},
): SeriesRaceInputV1 {
  const results: SeriesOfficialResultInputV1[] = specs.map((spec) => ({
    entryId: `${raceId}-${spec[0]}`,
    boatId: spec[0],
    identity: spec[5] ?? "competitor",
    status: spec[1],
    place: spec[2] ?? null,
    tied: spec[3] ?? false,
    penaltyPoints: spec[4] ?? 0,
  }));
  return {
    raceId,
    sequence,
    included: options.included ?? true,
    state: options.state ?? "completed",
    discardEligible: options.discardEligible ?? true,
    source: {
      analysisVersion: 3,
      performanceCalculationVersion: "performance-v1",
      correctionsVersion: 2,
      officialResultsRevision: 1,
    },
    results,
  };
}

/**
 * Golden contract fixture: six competitors, one guest, seven scored races,
 * a declared finish tie, every non-finish status, a penalty, an abandoned
 * race, an excluded race, and active two-discard scoring.
 */
export const LOW_POINT_V1_GOLDEN_FIXTURE: SeriesScoringInputV1 = {
  v: 1,
  scoringVersion: LOW_POINT_V1,
  config: {
    ...structuredClone(DEFAULT_LOW_POINT_CONFIG_V1),
    discardSchedule: [
      { minCompletedRaces: 0, discards: 0 },
      { minCompletedRaces: 5, discards: 1 },
      { minCompletedRaces: 7, discards: 2 },
    ],
  },
  competitors: COMPETITOR_IDS.map((boatId) => ({ boatId })),
  races: [
    race("race-1", 1, [
      ["alpha", "fin", 1],
      ["bravo", "fin", 2, true],
      ["charlie", "fin", 2, true],
      ["guest-one", "fin", 4, false, 0, "guest"],
      ["delta", "fin", 5],
      ["echo", "dnf"],
      ["foxtrot", "dns"],
    ]),
    race("race-2", 2, [
      ["bravo", "fin", 1],
      ["alpha", "fin", 2],
      ["delta", "fin", 3],
      ["echo", "fin", 4],
      ["foxtrot", "fin", 5],
      ["guest-one", "fin", 6, false, 0, "guest"],
      ["charlie", "dsq"],
    ]),
    race("race-3", 3, [
      ["charlie", "fin", 1],
      ["delta", "fin", 2],
      ["alpha", "fin", 3],
      ["bravo", "fin", 4],
      ["echo", "fin", 5],
      ["foxtrot", "fin", 6],
      ["guest-one", "ret", null, false, 0, "guest"],
    ]),
    race("race-4", 4, [
      ["delta", "fin", 1],
      ["echo", "fin", 2],
      ["bravo", "fin", 3],
      ["alpha", "fin", 4],
      ["charlie", "fin", 5],
      ["foxtrot", "ocs"],
      ["guest-one", "dns", null, false, 0, "guest"],
    ]),
    race("race-5", 5, [
      ["echo", "fin", 1],
      ["foxtrot", "fin", 2],
      ["charlie", "fin", 3],
      ["delta", "fin", 4],
      ["bravo", "fin", 5],
      ["alpha", "fin", 6, false, 0.5],
      ["guest-one", "dnf", null, false, 0, "guest"],
    ]),
    race("race-6", 6, [
      ["foxtrot", "fin", 1],
      ["alpha", "fin", 2],
      ["echo", "fin", 3],
      ["charlie", "fin", 4],
      ["delta", "fin", 5],
      ["bravo", "fin", 6],
      ["guest-one", "dsq", null, false, 0, "guest"],
    ]),
    race("race-7", 7, [
      ["alpha", "fin", 1, true],
      ["bravo", "fin", 1, true],
      ["charlie", "fin", 3],
      ["delta", "fin", 4],
      ["echo", "fin", 5],
      ["foxtrot", "fin", 6],
      ["guest-one", "fin", 7, false, 0, "guest"],
    ]),
    race("race-8", 8, [
      ["alpha", "fin", 1],
      ["bravo", "fin", 2],
      ["charlie", "fin", 3],
      ["delta", "fin", 4],
      ["echo", "fin", 5],
      ["foxtrot", "fin", 6],
    ], { state: "abandoned" }),
    race("race-9", 9, [
      ["foxtrot", "fin", 1],
      ["echo", "fin", 2],
      ["delta", "fin", 3],
      ["charlie", "fin", 4],
      ["bravo", "fin", 5],
      ["alpha", "fin", 6],
    ], { included: false }),
  ],
};
