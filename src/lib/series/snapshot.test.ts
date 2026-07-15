import { describe, expect, it } from "vitest";

import {
  SERIES_MAX_COMPETITORS,
  SERIES_MAX_RACES,
  SERIES_MAX_RESULTS_PER_RACE,
} from "@/lib/analytics/constants";
import { LOW_POINT_V1_GOLDEN_FIXTURE } from "@/lib/analytics/series/__fixtures__/low-point-v1";
import {
  DEFAULT_LOW_POINT_CONFIG_V1,
  scoreSeriesLowPointV1,
} from "@/lib/analytics/series/scoring";
import {
  parseSeriesScoringSnapshotV1,
  parseStoredSeriesSnapshotV1,
} from "@/lib/series/snapshot";

function validSnapshot() {
  const outcome = scoreSeriesLowPointV1(LOW_POINT_V1_GOLDEN_FIXTURE);
  if (outcome.status !== "valid") throw new Error("Golden series fixture must score.");
  return structuredClone(outcome.result);
}

describe("parseSeriesScoringSnapshotV1", () => {
  it("accepts a deterministic immutable Low Point V1 result", () => {
    const snapshot = validSnapshot();
    expect(parseSeriesScoringSnapshotV1(snapshot)).toEqual({
      status: "valid",
      result: snapshot,
      issues: [],
    });
  });

  it("distinguishes missing and unsupported snapshots from malformed data", () => {
    expect(parseSeriesScoringSnapshotV1(null)).toEqual({
      status: "missing",
      result: null,
      issues: [],
    });
    expect(parseSeriesScoringSnapshotV1({ ...validSnapshot(), v: 2 })).toMatchObject({
      status: "unsupported",
      version: 2,
      result: null,
    });
    expect(parseSeriesScoringSnapshotV1({ v: 1, scoringVersion: "low-point-v1" })).toMatchObject({
      status: "malformed",
      result: null,
    });
    expect(parseSeriesScoringSnapshotV1({ races: [], standings: [] })).toMatchObject({
      status: "malformed",
      issues: [expect.stringContaining("metadata is missing")],
    });
  });

  it("rejects a plausible-looking snapshot when any stored total is changed", () => {
    const snapshot = validSnapshot();
    snapshot.standings[0].netPointsHundredths += 1;
    expect(parseSeriesScoringSnapshotV1(snapshot)).toMatchObject({
      status: "malformed",
      issues: [expect.stringContaining("does not reconcile")],
    });
  });

  it("fails closed on malformed nested rows instead of throwing", () => {
    const snapshot = validSnapshot() as unknown as { races: Array<{ rows: unknown[] }> };
    snapshot.races[0].rows[0] = null;
    expect(() => parseSeriesScoringSnapshotV1(snapshot)).not.toThrow();
    expect(parseSeriesScoringSnapshotV1(snapshot)).toMatchObject({
      status: "malformed",
      issues: [expect.stringContaining("malformed result row")],
    });
  });

  it("rejects source, discard, and tie-break fields that differ from the deterministic result", () => {
    const source = validSnapshot();
    source.races[0].source.officialResultsRevision += 1;
    expect(parseSeriesScoringSnapshotV1(source).status).toBe("malformed");

    const discard = validSnapshot();
    discard.standings[0].raceCells[0].discarded = !discard.standings[0].raceCells[0].discarded;
    expect(parseSeriesScoringSnapshotV1(discard).status).toBe("malformed");

    const tieBreak = validSnapshot();
    tieBreak.standings[0].tieBreak.explanation = "Invented explanation";
    expect(parseSeriesScoringSnapshotV1(tieBreak).status).toBe("malformed");
  });

  it("enforces race and per-race row bounds before reconstruction", () => {
    const snapshot = validSnapshot() as unknown as Record<string, unknown>;
    snapshot.races = Array.from({ length: SERIES_MAX_RACES + 1 }, () => ({}));
    expect(parseSeriesScoringSnapshotV1(snapshot)).toMatchObject({
      status: "malformed",
      issues: [expect.stringContaining(`${SERIES_MAX_RACES} races`)],
    });

    const rows = validSnapshot() as unknown as { races: Array<Record<string, unknown>> };
    rows.races[0].rows = Array.from({ length: SERIES_MAX_RESULTS_PER_RACE + 1 }, () => ({}));
    expect(parseSeriesScoringSnapshotV1(rows)).toMatchObject({
      status: "malformed",
      issues: [expect.stringContaining(`${SERIES_MAX_RESULTS_PER_RACE} rows`)],
    });
  });

  it("accepts a valid snapshot at the scorer's competitor/race product bounds", () => {
    const competitors = Array.from(
      { length: SERIES_MAX_COMPETITORS },
      (_, index) => ({ boatId: `boat-${index}` }),
    );
    const outcome = scoreSeriesLowPointV1({
      v: 1,
      scoringVersion: "low-point-v1",
      config: DEFAULT_LOW_POINT_CONFIG_V1,
      competitors,
      races: Array.from({ length: SERIES_MAX_RACES }, (_, raceIndex) => ({
        raceId: `race-${raceIndex}`,
        sequence: raceIndex + 1,
        included: true,
        state: "completed",
        discardEligible: true,
        source: {
          analysisVersion: 1,
          performanceCalculationVersion: "performance-v1",
          correctionsVersion: null,
          officialResultsRevision: 1,
        },
        results: competitors.map((competitor, competitorIndex) => ({
          entryId: `race-${raceIndex}-entry-${competitorIndex}`,
          boatId: competitor.boatId,
          identity: "competitor",
          status: "fin",
          place: competitorIndex + 1,
          tied: false,
          penaltyPoints: 0,
        })),
      })),
    });
    expect(outcome.status).toBe("valid");
    if (outcome.status !== "valid") return;
    const parsed = parseSeriesScoringSnapshotV1(outcome.result);
    if (parsed.status !== "valid") throw new Error(parsed.issues.join("; "));
    expect(parsed.status).toBe("valid");
  }, 20_000);

  it("requires database row metadata to match the result body", () => {
    const snapshot = validSnapshot();
    expect(parseStoredSeriesSnapshotV1({
      scoringVersion: snapshot.scoringVersion,
      sourceFingerprint: snapshot.sourceFingerprint,
      result: snapshot,
    }).status).toBe("valid");
    expect(parseStoredSeriesSnapshotV1({
      scoringVersion: snapshot.scoringVersion,
      sourceFingerprint: "0".repeat(64),
      result: snapshot,
    })).toMatchObject({
      status: "malformed",
      issues: [expect.stringContaining("metadata")],
    });
  });
});
