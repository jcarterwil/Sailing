import { describe, expect, it } from "vitest";

import { DEFAULT_LOW_POINT_CONFIG_V1 } from "@/lib/analytics/series/scoring";
import { LOW_POINT_V1 } from "@/lib/analytics/series/types";
import type { PerformanceRaceResultV1 } from "@/lib/analytics/performance/types";
import {
  projectSeriesWorkflowV1,
  type ProjectSeriesWorkflowInputV1,
  type SeriesWorkflowRaceV1,
} from "@/lib/series/workflow";

function performance(
  entryId: string,
  rank: number,
  overrides: Partial<PerformanceRaceResultV1> = {},
): PerformanceRaceResultV1 {
  return {
    entryId,
    status: "finished",
    finish: null,
    elapsedMs: rank * 60_000,
    rank,
    tied: false,
    deltaMs: rank === 1 ? 0 : (rank - 1) * 60_000,
    officialPlaceOverride: null,
    note: null,
    reviewRequired: false,
    warningCodes: [],
    provenance: {
      source: "timer-event",
      confidence: "high",
      inputs: ["test"],
      coveragePct: 100,
      note: null,
    },
    ...overrides,
  };
}

function race(overrides: Partial<SeriesWorkflowRaceV1> = {}): SeriesWorkflowRaceV1 {
  return {
    raceId: "race-1",
    raceName: "Race 1",
    sequence: 1,
    included: true,
    discardEligible: true,
    state: "completed",
    analysisStatus: "current",
    analysisVersion: 4,
    performanceCalculationVersion: "performance-v1",
    correctionsVersion: 2,
    officialResultsRevision: 0,
    storedOfficialResults: [],
    entries: [
      {
        entryId: "entry-alpha",
        sourceBoatId: "boat-alpha",
        boatName: "Alpha",
        result: performance("entry-alpha", 1),
      },
      {
        entryId: "entry-bravo",
        sourceBoatId: "boat-bravo",
        boatName: "Bravo",
        result: performance("entry-bravo", 2),
      },
    ],
    ...overrides,
  };
}

function input(overrides: Partial<ProjectSeriesWorkflowInputV1> = {}): ProjectSeriesWorkflowInputV1 {
  return {
    seriesId: "series-1",
    scoringVersion: LOW_POINT_V1,
    scoringConfig: DEFAULT_LOW_POINT_CONFIG_V1,
    competitors: [
      { boatId: "boat-alpha", role: "competitor" },
      { boatId: "boat-bravo", role: "competitor" },
    ],
    aliases: [],
    races: [race()],
    ...overrides,
  };
}

function confirmedRows(penaltyPoints = 0) {
  return [{
    raceId: "race-1",
    rows: [
      {
        entryId: "entry-alpha",
        sourceBoatId: "boat-alpha",
        boatId: "spoofed-browser-id",
        status: "fin",
        place: 1,
        tied: false,
        penaltyPoints,
        confirmed: true,
      },
      {
        entryId: "entry-bravo",
        sourceBoatId: "boat-bravo",
        boatId: "spoofed-browser-id",
        status: "fin",
        place: 2,
        tied: false,
        penaltyPoints: 0,
        confirmed: true,
      },
    ],
  }];
}

describe("projectSeriesWorkflowV1", () => {
  it("blocks until every completed-race result is explicitly confirmed", () => {
    const projection = projectSeriesWorkflowV1(input());
    expect(projection.status).toBe("blocked");
    expect(projection.issues.map((issue) => issue.code)).toEqual([
      "official-result-unconfirmed",
      "official-result-unconfirmed",
    ]);
    expect(projection.raceDrafts[0].rows).toMatchObject([
      { entryId: "entry-alpha", status: "fin", place: 1, confirmed: false },
      { entryId: "entry-bravo", status: "fin", place: 2, confirmed: false },
    ]);
  });

  it("builds a ready, deterministic preview from server identity and source revisions", () => {
    const first = projectSeriesWorkflowV1(input({ draftOfficialResults: confirmedRows() }));
    expect(first.status).toBe("ready");
    expect(first.result?.standings.map(({ boatId, rank }) => ({ boatId, rank }))).toEqual([
      { boatId: "boat-alpha", rank: 1 },
      { boatId: "boat-bravo", rank: 2 },
    ]);
    expect(first.applyRaces[0]).toMatchObject({
      expectedOfficialResultsRevision: 0,
      nextOfficialResultsRevision: 1,
      expectedAnalysisVersion: 4,
      expectedCorrectionsVersion: 2,
      officialResults: [
        { entryId: "entry-alpha", boatId: "boat-alpha", identity: "competitor" },
        { entryId: "entry-bravo", boatId: "boat-bravo", identity: "competitor" },
      ],
    });
    const identicalPreview = projectSeriesWorkflowV1(input({
      draftOfficialResults: confirmedRows(),
    }));
    expect(identicalPreview.result).toEqual(first.result);

    const stored = first.applyRaces[0].officialResults;
    const unchanged = projectSeriesWorkflowV1(input({
      races: [race({
        officialResultsRevision: 1,
        storedOfficialResults: stored,
      })],
      draftOfficialResults: confirmedRows(),
    }));
    expect(unchanged.status).toBe("ready");
    expect(unchanged.applyRaces[0].nextOfficialResultsRevision).toBe(1);
    expect(unchanged.result?.sourceFingerprint).toBe(first.result?.sourceFingerprint);

    const changed = projectSeriesWorkflowV1(input({
      races: [race({
        officialResultsRevision: 1,
        storedOfficialResults: stored,
      })],
      draftOfficialResults: confirmedRows(0.5),
    }));
    expect(changed.status).toBe("ready");
    expect(changed.applyRaces[0].nextOfficialResultsRevision).toBe(2);
    expect(changed.result?.sourceFingerprint).not.toBe(first.result?.sourceFingerprint);
  });

  it("requires current analysis and complete Performance results", () => {
    const stale = projectSeriesWorkflowV1(input({
      races: [race({ analysisStatus: "stale" })],
      draftOfficialResults: confirmedRows(),
    }));
    expect(stale.status).toBe("blocked");
    expect(stale.issues).toContainEqual(expect.objectContaining({ code: "analysis-not-current" }));

    const missing = projectSeriesWorkflowV1(input({
      races: [race({
        entries: [
          {
            entryId: "entry-alpha",
            sourceBoatId: "boat-alpha",
            boatName: "Alpha",
            result: null,
          },
        ],
      })],
      competitors: [{ boatId: "boat-alpha", role: "competitor" }],
      draftOfficialResults: [{ raceId: "race-1", rows: [] }],
    }));
    expect(missing.issues).toContainEqual(
      expect.objectContaining({ code: "missing-performance-result", entryId: "entry-alpha" }),
    );
  });

  it("creates an explicit confirmable DNS row when a competitor skips a race", () => {
    const competitors = [
      { boatId: "boat-alpha", boatName: "Alpha", role: "competitor" as const },
      { boatId: "boat-bravo", boatName: "Bravo", role: "competitor" as const },
      { boatId: "boat-charlie", boatName: "Charlie", role: "competitor" as const },
    ];
    const unconfirmed = projectSeriesWorkflowV1(input({ competitors }));
    expect(unconfirmed.status).toBe("blocked");
    expect(unconfirmed.raceDrafts[0].rows).toContainEqual(expect.objectContaining({
      entryId: "dns:boat-charlie",
      origin: "absent-competitor",
      boatId: "boat-charlie",
      status: "dns",
      confirmed: false,
    }));

    const ready = projectSeriesWorkflowV1(input({
      competitors,
      draftOfficialResults: [{
        raceId: "race-1",
        rows: [
          ...confirmedRows()[0].rows as Array<Record<string, unknown>>,
          {
            entryId: "dns:boat-charlie",
            sourceBoatId: "boat-charlie",
            status: "dns",
            place: null,
            tied: false,
            penaltyPoints: 0,
            confirmed: true,
          },
        ],
      }],
    }));
    expect(ready.status).toBe("ready");
    expect(ready.applyRaces[0].officialResults).toContainEqual(expect.objectContaining({
      entryId: "dns:boat-charlie",
      boatId: "boat-charlie",
      identity: "competitor",
      status: "dns",
    }));
  });

  it("never carries confirmation when the draft omits its source boat", () => {
    const rows = confirmedRows()[0].rows.map((row) => ({ ...row }));
    delete (rows[0] as Partial<typeof rows[number]>).sourceBoatId;
    const projection = projectSeriesWorkflowV1(input({
      draftOfficialResults: [{ raceId: "race-1", rows }],
    }));
    expect(projection.status).toBe("blocked");
    expect(projection.raceDrafts[0].rows.find((row) => row.entryId === "entry-alpha"))
      .toMatchObject({ confirmed: false, sourceBoatId: "boat-alpha" });
    expect(projection.issues).toContainEqual(expect.objectContaining({
      code: "official-result-unconfirmed",
      entryId: "entry-alpha",
    }));
  });

  it("accepts only explicit competitor aliases and keeps guests non-eligible", () => {
    const aliasedRace = race({
      entries: [
        {
          entryId: "entry-old-alpha",
          sourceBoatId: "boat-old-alpha",
          boatName: "Alpha (old record)",
          result: performance("entry-old-alpha", 1),
        },
        {
          entryId: "entry-guest",
          sourceBoatId: "boat-guest",
          boatName: "Guest",
          result: performance("entry-guest", 2),
        },
      ],
    });
    const drafts = [{
      raceId: "race-1",
      rows: [
        {
          entryId: "entry-old-alpha",
          sourceBoatId: "boat-old-alpha",
          status: "fin",
          place: 1,
          tied: false,
          penaltyPoints: 0,
          confirmed: true,
        },
        {
          entryId: "entry-guest",
          sourceBoatId: "boat-guest",
          status: "fin",
          place: 2,
          tied: false,
          penaltyPoints: 0,
          confirmed: true,
        },
      ],
    }];
    const unresolved = projectSeriesWorkflowV1(input({
      races: [aliasedRace],
      competitors: [{ boatId: "boat-alpha", role: "competitor" }],
      draftOfficialResults: drafts,
    }));
    expect(unresolved.issues).toContainEqual(
      expect.objectContaining({ code: "identity-unresolved", entryId: "entry-old-alpha" }),
    );

    const resolved = projectSeriesWorkflowV1(input({
      races: [aliasedRace],
      competitors: [
        { boatId: "boat-alpha", role: "competitor" },
        { boatId: "boat-guest", role: "guest" },
      ],
      aliases: [{ sourceBoatId: "boat-old-alpha", canonicalBoatId: "boat-alpha" }],
      draftOfficialResults: drafts,
    }));
    expect(resolved.status).toBe("ready");
    expect(resolved.applyRaces[0].officialResults).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceBoatId: "boat-old-alpha",
        boatId: "boat-alpha",
        identity: "competitor",
      }),
      expect.objectContaining({
        sourceBoatId: "boat-guest",
        boatId: "boat-guest",
        identity: "guest",
      }),
    ]));
    expect(resolved.result?.standings).toHaveLength(1);
  });
});
