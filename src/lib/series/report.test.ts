import { describe, expect, it } from "vitest";

import { LOW_POINT_V1_GOLDEN_FIXTURE } from "@/lib/analytics/series/__fixtures__/low-point-v1";
import { scoreSeriesLowPointV1 } from "@/lib/analytics/series/scoring";
import {
  resolveSeriesReportRaceStateV1,
  seriesReportAnalysisRequiredV1,
  seriesReportSetupMatchesSnapshotV1,
} from "@/lib/series/report";

const snapshotSource = {
  analysisVersion: 4,
  performanceCalculationVersion: "performance-v1",
  correctionsVersion: 2,
  officialResultsRevision: 3,
};

describe("resolveSeriesReportRaceStateV1", () => {
  it("marks config, ordered-race, and registered identity changes stale", () => {
    const scored = scoreSeriesLowPointV1(LOW_POINT_V1_GOLDEN_FIXTURE);
    if (scored.status !== "valid") throw new Error("Golden series fixture must score.");
    const snapshot = scored.result;
    const roles = new Map<string, "competitor" | "guest">(
      snapshot.standings.map((standing) => [standing.boatId, "competitor"]),
    );
    for (const row of snapshot.races.flatMap((race) => race.rows)) {
      if (row.identity === "competitor" || row.identity === "guest") {
        roles.set(row.boatId, row.identity);
      }
    }
    const current = {
      scoringVersion: snapshot.scoringVersion,
      scoringConfig: structuredClone(snapshot.config),
      races: snapshot.races.map((race) => ({
        raceId: race.raceId,
        sequence: race.sequence,
        included: race.included,
        discardEligible: race.discardEligible,
        state: race.state,
      })),
      boatRoles: [...roles].map(([boatId, role]) => ({ boatId, role })),
    };

    expect(seriesReportSetupMatchesSnapshotV1(current, snapshot)).toBe(true);
    expect(seriesReportSetupMatchesSnapshotV1({
      ...current,
      scoringConfig: {
        ...snapshot.config,
        countGuestsInPopulation: !snapshot.config.countGuestsInPopulation,
      },
    }, snapshot)).toBe(false);
    expect(seriesReportSetupMatchesSnapshotV1({
      ...current,
      races: current.races.map((race, index) =>
        index === 0 ? { ...race, included: !race.included } : race),
    }, snapshot)).toBe(false);
    expect(seriesReportSetupMatchesSnapshotV1({
      ...current,
      boatRoles: current.boatRoles.map((row, index) =>
        index === 0 ? { ...row, role: "guest" as const } : row),
    }, snapshot)).toBe(false);
  });

  it("requires Performance analysis only when the race has entries", () => {
    expect(seriesReportAnalysisRequiredV1(0)).toBe(false);
    expect(seriesReportAnalysisRequiredV1(1)).toBe(true);

    const entrylessSource = {
      analysisVersion: 0,
      performanceCalculationVersion: "unavailable",
      correctionsVersion: null,
      officialResultsRevision: 1,
    };
    expect(resolveSeriesReportRaceStateV1({
      evidenceState: "current",
      snapshotSource: entrylessSource,
      currentSource: entrylessSource,
      entrySetMatches: true,
    })).toBe("current");
    expect(resolveSeriesReportRaceStateV1({
      evidenceState: "current",
      snapshotSource: entrylessSource,
      currentSource: { ...entrylessSource, analysisVersion: 2 },
      entrySetMatches: true,
    })).toBe("stale");
  });

  it("is current only when every source used by the snapshot still matches", () => {
    expect(resolveSeriesReportRaceStateV1({
      evidenceState: "current",
      snapshotSource,
      currentSource: { ...snapshotSource },
      entrySetMatches: true,
    })).toBe("current");

    for (const currentSource of [
      { ...snapshotSource, analysisVersion: 5 },
      { ...snapshotSource, performanceCalculationVersion: "performance-v2" },
      { ...snapshotSource, correctionsVersion: 3 },
      { ...snapshotSource, officialResultsRevision: 4 },
    ]) {
      expect(resolveSeriesReportRaceStateV1({
        evidenceState: "current",
        snapshotSource,
        currentSource,
        entrySetMatches: true,
      })).toBe("stale");
    }
  });

  it("preserves explicit evidence failures instead of rendering plausible facts", () => {
    for (const evidenceState of [
      "missing",
      "incomplete",
      "unsupported",
      "malformed",
    ] as const) {
      expect(resolveSeriesReportRaceStateV1({
        evidenceState,
        snapshotSource,
        currentSource: { ...snapshotSource },
        entrySetMatches: true,
      })).toBe(evidenceState);
    }
    expect(resolveSeriesReportRaceStateV1({
      evidenceState: "current",
      snapshotSource,
      currentSource: { ...snapshotSource },
      entrySetMatches: false,
    })).toBe("incomplete");
  });
});
