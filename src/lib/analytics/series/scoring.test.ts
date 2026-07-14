import { describe, expect, it } from "vitest";

import { LOW_POINT_V1_GOLDEN_FIXTURE } from "@/lib/analytics/series/__fixtures__/low-point-v1";
import { canonicalJson, sha256Hex } from "@/lib/analytics/series/fingerprint";
import {
  DEFAULT_LOW_POINT_CONFIG_V1,
  formatSeriesPoints,
  scoreSeriesLowPointV1,
} from "@/lib/analytics/series/scoring";
import {
  LOW_POINT_V1,
  type LowPointConfigV1,
  type SeriesOfficialResultInputV1,
  type SeriesRaceInputV1,
  type SeriesScoringInputV1,
  type SeriesScoringResultV1,
} from "@/lib/analytics/series/types";

function cloneGolden(): SeriesScoringInputV1 {
  return structuredClone(LOW_POINT_V1_GOLDEN_FIXTURE) as SeriesScoringInputV1;
}

function valid(input: unknown): SeriesScoringResultV1 {
  const outcome = scoreSeriesLowPointV1(input);
  expect(outcome.status, JSON.stringify(outcome, null, 2)).toBe("valid");
  if (outcome.status !== "valid") throw new Error("Expected valid scoring output.");
  return outcome.result;
}

function config(overrides: Partial<LowPointConfigV1> = {}): LowPointConfigV1 {
  return { ...structuredClone(DEFAULT_LOW_POINT_CONFIG_V1), ...overrides };
}

function row(
  raceId: string,
  boatId: string,
  place: number,
  options: Partial<SeriesOfficialResultInputV1> = {},
): SeriesOfficialResultInputV1 {
  return {
    entryId: `${raceId}-${boatId}`,
    boatId,
    identity: "competitor",
    status: "fin",
    place,
    tied: false,
    penaltyPoints: 0,
    ...options,
  };
}

function race(
  raceId: string,
  sequence: number,
  results: SeriesOfficialResultInputV1[],
  options: Partial<SeriesRaceInputV1> = {},
): SeriesRaceInputV1 {
  return {
    raceId,
    sequence,
    included: true,
    state: "completed",
    discardEligible: true,
    source: {
      analysisVersion: 1,
      performanceCalculationVersion: "performance-v1",
      correctionsVersion: null,
      officialResultsRevision: 1,
    },
    results,
    ...options,
  };
}

function contract(
  competitorIds: string[],
  races: SeriesRaceInputV1[],
  scoringConfig = config(),
): SeriesScoringInputV1 {
  return {
    v: 1,
    scoringVersion: LOW_POINT_V1,
    config: scoringConfig,
    competitors: competitorIds.map((boatId) => ({ boatId })),
    races,
  };
}

function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const shuffled = [...values];
  let state = seed | 0;
  for (let index = shuffled.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) | 0;
    const selected = (state >>> 0) % (index + 1);
    [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
  }
  return shuffled;
}

describe("series scoring fingerprint", () => {
  it("matches the SHA-256 standard vector and canonicalizes object keys", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}',
    );
  });
});

describe("scoreSeriesLowPointV1", () => {
  it("matches the six-competitor golden standings and preserves score evidence", () => {
    const result = valid(cloneGolden());
    expect(result).toMatchObject({
      v: 1,
      scoringVersion: "low-point-v1",
      pointsScale: 100,
      completedRaceCount: 7,
      discardCount: 2,
    });
    expect(result.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.standings.map((standing) => ({
      boatId: standing.boatId,
      rank: standing.rank,
      gross: standing.grossPointsHundredths,
      discarded: standing.discardedPointsHundredths,
      net: standing.netPointsHundredths,
    }))).toEqual([
      { boatId: "alpha", rank: 1, gross: 2_000, discarded: 1_050, net: 950 },
      { boatId: "bravo", rank: 2, gross: 2_300, discarded: 1_100, net: 1_200 },
      { boatId: "charlie", rank: 3, gross: 2_650, discarded: 1_300, net: 1_350 },
      { boatId: "delta", rank: 4, gross: 2_400, discarded: 1_000, net: 1_400 },
      { boatId: "echo", rank: 5, gross: 2_700, discarded: 1_200, net: 1_500 },
      { boatId: "foxtrot", rank: 6, gross: 3_500, discarded: 1_500, net: 2_000 },
    ]);

    const raceOne = result.races.find((candidate) => candidate.raceId === "race-1")!;
    expect(raceOne).toMatchObject({
      entrants: 7,
      starters: 6,
      completedForSeries: true,
      validation: { status: "valid", issueCount: 0 },
    });
    expect(raceOne.rows.find((candidate) => candidate.boatId === "bravo")).toMatchObject({
      baseRule: { kind: "finish-place-average", occupiedPlaces: [2, 3] },
      basePointsHundredths: 250,
      totalPointsHundredths: 250,
    });
    expect(raceOne.rows.find((candidate) => candidate.boatId === "echo")).toMatchObject({
      baseRule: { kind: "status-population", population: "starters", populationCount: 6 },
      basePointsHundredths: 700,
    });
    expect(raceOne.rows.find((candidate) => candidate.boatId === "foxtrot")).toMatchObject({
      baseRule: { kind: "status-population", population: "entrants", populationCount: 7 },
      basePointsHundredths: 800,
    });
    expect(raceOne.rows.find((candidate) => candidate.boatId === "guest-one")).toMatchObject({
      seriesEligible: false,
      totalPointsHundredths: 400,
    });
    expect([...new Set(result.races.flatMap((candidate) => candidate.rows)
      .filter((candidate) => candidate.status !== "fin")
      .map((candidate) => candidate.status))].sort()).toEqual([
      "dnf",
      "dns",
      "dsq",
      "ocs",
      "ret",
    ]);
  });

  it("activates zero, one, and two discards only at configured thresholds", () => {
    const four = cloneGolden();
    four.races = four.races.slice(0, 4);
    const five = cloneGolden();
    five.races = five.races.slice(0, 5);
    const seven = cloneGolden();
    seven.races = seven.races.slice(0, 7);
    expect(valid(four).discardCount).toBe(0);
    expect(valid(five).discardCount).toBe(1);
    expect(valid(seven).discardCount).toBe(2);
  });

  it("discards equal worst scores from the earliest race first", () => {
    const result = valid(cloneGolden());
    const delta = result.standings.find((standing) => standing.boatId === "delta")!;
    expect(delta.raceCells.filter((cell) => cell.discarded).map((cell) => cell.raceId)).toEqual([
      "race-1",
      "race-6",
    ]);
    const echo = result.standings.find((standing) => standing.boatId === "echo")!;
    expect(echo.raceCells.filter((cell) => cell.discarded).map((cell) => cell.raceId)).toEqual([
      "race-1",
      "race-3",
    ]);
  });

  it("never discards a completed race marked discard-ineligible", () => {
    const input = cloneGolden();
    input.races = input.races.slice(0, 7);
    input.races[0].discardEligible = false;
    const result = valid(input);
    const foxtrot = result.standings.find((standing) => standing.boatId === "foxtrot")!;
    expect(foxtrot.raceCells.find((cell) => cell.raceId === "race-1")).toMatchObject({
      totalPointsHundredths: 800,
      discardEligible: false,
      discarded: false,
    });
    expect(foxtrot.raceCells.filter((cell) => cell.discarded).map((cell) => cell.raceId)).toEqual([
      "race-3",
      "race-4",
    ]);
  });

  it("does not count guests in status populations when the explicit option is false", () => {
    const input = cloneGolden();
    input.config.countGuestsInPopulation = false;
    input.races = input.races.slice(0, 1);
    const result = valid(input);
    const raceOne = result.races[0];
    expect(raceOne).toMatchObject({ entrants: 6, starters: 5 });
    expect(raceOne.rows.find((candidate) => candidate.boatId === "echo")?.basePointsHundredths).toBe(600);
    expect(raceOne.rows.find((candidate) => candidate.boatId === "foxtrot")?.basePointsHundredths).toBe(700);
    expect(raceOne.rows.find((candidate) => candidate.boatId === "guest-one")?.seriesEligible).toBe(false);
  });

  it("uses configurable non-finish population bases and exact add-points values", () => {
    const input = cloneGolden();
    input.config.statusScores.ocs = { population: "entrants", addPoints: 2.25 };
    input.races = input.races.slice(0, 4);
    const result = valid(input);
    expect(result.races[3].rows.find((candidate) => candidate.boatId === "foxtrot")).toMatchObject({
      baseRule: {
        kind: "status-population",
        status: "ocs",
        population: "entrants",
        populationCount: 7,
        addPointsHundredths: 225,
      },
      basePointsHundredths: 925,
    });
  });

  it("marks abandoned and excluded races unscored and never applies their penalties", () => {
    const result = valid(cloneGolden());
    const alpha = result.standings.find((standing) => standing.boatId === "alpha")!;
    expect(alpha.raceCells.find((cell) => cell.raceId === "race-8")).toMatchObject({
      totalPointsHundredths: null,
      notScoredReason: "abandoned",
      discarded: false,
    });
    expect(alpha.raceCells.find((cell) => cell.raceId === "race-9")).toMatchObject({
      totalPointsHundredths: null,
      notScoredReason: "excluded",
      discarded: false,
    });
  });

  it("is byte-identical, including its fingerprint, across seeded input permutations", () => {
    const forward = cloneGolden();
    const expected = JSON.stringify(valid(forward));
    for (let seed = 1; seed <= 12; seed++) {
      const shuffled = cloneGolden();
      shuffled.competitors = seededShuffle(shuffled.competitors, seed);
      shuffled.races = seededShuffle(shuffled.races, seed * 17);
      for (const candidate of shuffled.races) {
        candidate.results = seededShuffle(candidate.results, seed + candidate.sequence * 31);
      }
      expect(JSON.stringify(valid(shuffled))).toBe(expected);
    }
  });

  it("round-trips the golden fixture and result through JSON byte-identically", () => {
    const result = valid(cloneGolden());
    const roundTrippedInput = JSON.parse(JSON.stringify(cloneGolden())) as unknown;
    const roundTrippedResult = valid(roundTrippedInput);
    expect(JSON.stringify(roundTrippedResult)).toBe(JSON.stringify(result));
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("changes the fingerprint and only the targeted score when an official correction changes", () => {
    const before = valid(cloneGolden());
    const correctedInput = cloneGolden();
    const corrected = correctedInput.races[2].results.find((candidate) => candidate.boatId === "alpha")!;
    corrected.penaltyPoints = 0.25;
    const after = valid(correctedInput);
    expect(after.sourceFingerprint).not.toBe(before.sourceFingerprint);
    const totals = (result: SeriesScoringResultV1) => result.races.flatMap((candidate) =>
      candidate.rows.map((scored) => [
        `${candidate.raceId}:${scored.boatId}`,
        scored.totalPointsHundredths,
      ] as const));
    const beforeTotals = new Map(totals(before));
    const afterTotals = new Map(totals(after));
    const changed = [...afterTotals].filter(([key, points]) => beforeTotals.get(key) !== points);
    expect(changed).toEqual([["race-3:alpha", 325]]);
  });

  it("rejects missing, unresolved, duplicate, and contradictory official results", () => {
    const input = cloneGolden();
    input.races = input.races.slice(0, 1);
    input.races[0].results = input.races[0].results.filter((candidate) => candidate.boatId !== "alpha");
    input.races[0].results.find((candidate) => candidate.boatId === "bravo")!.identity = "unresolved";
    input.races[0].results.push({
      ...input.races[0].results.find((candidate) => candidate.boatId === "charlie")!,
      entryId: "duplicate-charlie",
    });
    const echo = input.races[0].results.find((candidate) => candidate.boatId === "echo")!;
    echo.place = 6;
    echo.tied = true;
    const outcome = scoreSeriesLowPointV1(input);
    expect(outcome.status).toBe("invalid");
    expect(outcome.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "missing-official-result",
      "identity-unresolved",
      "duplicate-boat-result",
      "invalid-status-result",
    ]));
  });

  it("rejects malformed tie groups, place sequences, schedules, and unavailable discards", () => {
    const tie = contract(["alpha", "bravo"], [race("r1", 1, [
      row("r1", "alpha", 1, { tied: true }),
      row("r1", "bravo", 3),
    ])], config({
      discardSchedule: [
        { minCompletedRaces: 0, discards: 0 },
        { minCompletedRaces: 1, discards: 2 },
      ],
    }));
    const outcome = scoreSeriesLowPointV1(tie);
    expect(outcome.status).toBe("invalid");
    expect(outcome.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "invalid-tie-group",
      "invalid-place-sequence",
      "invalid-discard-schedule",
      "too-many-discards",
    ]));
  });

  it("returns a typed unsupported outcome for unknown contract versions", () => {
    expect(scoreSeriesLowPointV1({ v: 2, scoringVersion: "low-point-v2" })).toEqual({
      status: "unsupported",
      result: null,
      version: "low-point-v2",
      issues: [{
        code: "unsupported-version",
        path: "$.scoringVersion",
        message: "Unsupported series scoring contract: low-point-v2.",
      }],
    });
  });

  it("uses best kept scores, then the latest differing race, then a shared rank", () => {
    const bestKept = contract(["alpha", "bravo"], [
      race("r1", 1, [row("r1", "alpha", 1), row("r1", "bravo", 2)]),
      race("r2", 2, [row("r2", "alpha", 1), row("r2", "bravo", 2)]),
      race("r3", 3, [
        row("r3", "guest-1", 1, { identity: "guest" }),
        row("r3", "bravo", 2),
        row("r3", "guest-2", 3, { identity: "guest" }),
        row("r3", "alpha", 4),
      ]),
    ]);
    expect(valid(bestKept).standings.map((standing) => [
      standing.boatId,
      standing.rank,
      standing.tieBreak.decision,
    ])).toEqual([
      ["alpha", 1, "best-kept-scores"],
      ["bravo", 2, "best-kept-scores"],
    ]);

    const latest = contract(["alpha", "bravo"], [
      race("r1", 1, [row("r1", "alpha", 1), row("r1", "bravo", 2)]),
      race("r2", 2, [row("r2", "bravo", 1), row("r2", "alpha", 2)]),
    ]);
    expect(valid(latest).standings.map((standing) => [
      standing.boatId,
      standing.rank,
      standing.tieBreak.decision,
      standing.tieBreak.decisiveRaceId,
    ])).toEqual([
      ["bravo", 1, "latest-race", "r2"],
      ["alpha", 2, "latest-race", "r2"],
    ]);

    const shared = contract(["alpha", "bravo"], [race("r1", 1, [
      row("r1", "alpha", 1, { tied: true }),
      row("r1", "bravo", 1, { tied: true }),
    ])]);
    expect(valid(shared).standings.map((standing) => [
      standing.boatId,
      standing.rank,
      standing.tied,
      standing.tieBreak.decision,
    ])).toEqual([
      ["alpha", 1, true, "shared-rank"],
      ["bravo", 1, true, "shared-rank"],
    ]);
  });

  it("applies additive penalties exactly and formats integer hundredths", () => {
    const input = contract(["alpha", "bravo"], [race("r1", 1, [
      row("r1", "alpha", 1, { penaltyPoints: 0.25 }),
      row("r1", "bravo", 2),
    ])]);
    const result = valid(input);
    const alpha = result.races[0].rows.find((candidate) => candidate.boatId === "alpha")!;
    expect(alpha).toMatchObject({
      basePointsHundredths: 100,
      penaltyPointsHundredths: 25,
      totalPointsHundredths: 125,
    });
    expect([0, 100, 150, 125, -125].map(formatSeriesPoints)).toEqual([
      "0",
      "1",
      "1.5",
      "1.25",
      "-1.25",
    ]);
  });
});
