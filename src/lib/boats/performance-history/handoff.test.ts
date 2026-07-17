import { describe, expect, it } from "vitest";

import {
  assertHandoffCitationsIntact,
  buildCitedPerformanceHistoryHandoff,
} from "@/lib/boats/performance-history/handoff";
import { queryBoatPerformanceHistory } from "@/lib/boats/performance-history/query";
import {
  buildPerformanceHistoryCoachCreateParams,
  PERFORMANCE_HISTORY_COACH_SYSTEM_PROMPT,
  validatePerformanceHistoryCoachMarkdown,
} from "@/lib/boats/performance-history/coach-request";
import type { CompactObservationRowV1 } from "@/lib/boats/performance-history/types";
import {
  BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
  BOAT_SESSION_OBSERVATION_METRIC_VERSION,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
  type BoatSessionObservationPayloadV1,
  type ObservationMetricV1,
} from "@/lib/boats/observations/types";
import { buildCompactObservationCsv } from "@/lib/boats/performance-history/export-csv";

const BOAT_ID = "11111111-1111-4111-8111-111111111111";

function metric(
  value: number | null,
  unit: ObservationMetricV1["unit"] = "kts",
): ObservationMetricV1 {
  return {
    value,
    unit,
    exclusionReason: value == null ? "metric-unavailable" : null,
    coveragePct: value == null ? null : 100,
  };
}

function payload(
  sessionType: "race" | "practice",
  avgSogKts: number,
): BoatSessionObservationPayloadV1 {
  const practice = sessionType === "practice";
  const raceMetric = (
    value: number | null,
    unit: ObservationMetricV1["unit"],
  ): ObservationMetricV1 =>
    practice
      ? { value: null, unit, exclusionReason: "practice-session", coveragePct: null }
      : metric(value, unit);

  return {
    v: BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
    metricContract: BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
    metricVersion: BOAT_SESSION_OBSERVATION_METRIC_VERSION,
    sourceCalculationVersion: "performance-overview-v1.0.0",
    sessionType,
    coverage: {
      contributingDurationSec: 600,
      sampleCount: 600,
      excludedDurationSec: 0,
      coveragePct: 100,
      partial: false,
    },
    absolute: {
      avgSogKts: metric(avgSogKts),
      maxSogKts: metric(8),
      sailedDistanceM: metric(3000, "m"),
      upwindStraightVmgKts: metric(4.5),
      downwindStraightVmgKts: metric(5.1),
      avgAbsTwaDeg: metric(40, "deg"),
      avgAbsHeelDeg: metric(12, "deg"),
      avgSignedTrimDeg: metric(1, "deg"),
      tackCount: metric(4, "count"),
      gybeCount: metric(2, "count"),
      botchedManeuverCount: metric(0, "count"),
      avgVmgRetention: metric(0.9, "ratio"),
      best500mKts: metric(7),
      best1000mKts: metric(6.5),
      best1852mKts: metric(6.2),
      elapsedMs: metric(600_000, "ms"),
    },
    raceRelative: {
      rank: raceMetric(2, "count"),
      deltaMs: raceMetric(12_000, "ms"),
      courseEfficiencyPct: raceMetric(93, "pct"),
      startRank: raceMetric(1, "count"),
      timeToLineMs: raceMetric(-5_000, "ms"),
      distanceToLineAtGunM: raceMetric(8, "m"),
      sogAtGunKts: raceMetric(5.2, "kts"),
      dmg30M: raceMetric(12, "m"),
    },
    cohort: {
      eligible: !practice,
      reason: practice ? "practice-session" : null,
      cohortSize: practice ? 0 : 8,
      finishedCount: practice ? 0 : 7,
    },
    warningCodes: [],
  };
}

function row(
  index: number,
  sessionType: "race" | "practice" = "race",
  avgSogKts = 6,
): CompactObservationRowV1 {
  return {
    entryId: `entry-${index}`,
    sessionId: `session-${index}`,
    boatId: BOAT_ID,
    sessionType,
    startsAt: `2026-07-${String(10 + index).padStart(2, "0")}T12:00:00.000Z`,
    timezone: "UTC",
    metricVersion: BOAT_SESSION_OBSERVATION_METRIC_VERSION,
    observation: payload(sessionType, avgSogKts),
  };
}

describe("buildCitedPerformanceHistoryHandoff", () => {
  it("builds cited trend claims for n >= 3 and keeps citations intact", () => {
    const history = queryBoatPerformanceHistory(BOAT_ID, [
      row(1, "race", 5),
      row(2, "race", 6),
      row(3, "practice", 7),
    ]);
    const handoff = buildCitedPerformanceHistoryHandoff(history, {
      generatedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(handoff.v).toBe(1);
    expect(handoff.contract).toBe("boat-performance-history-handoff-v1");
    expect(handoff.languagePolicy).toBe("association-or-trend-only");
    expect(handoff.n).toBe(3);
    expect(handoff.claims.some((c) => c.kind === "trend")).toBe(true);
    expect(handoff.claims.some((c) => c.kind === "coverage")).toBe(true);
    expect(
      handoff.claims.every(
        (c) =>
          !/\bbecause of setup\b|\bshould change\b|\bprescribe\b|\bcauses?\b/i.test(
            c.text,
          ),
      ),
    ).toBe(true);
    expect(
      handoff.claims.some((c) => /not a causal claim/i.test(c.text)),
    ).toBe(true);
    expect(assertHandoffCitationsIntact(handoff)).toEqual({ ok: true });

    const sog = handoff.claims.find((c) => c.id === "trend:avgSogKts");
    expect(sog?.citationSessionIds).toEqual(
      expect.arrayContaining(["session-1", "session-2", "session-3"]),
    );
  });

  it("emits withheld claims for sparse cohorts", () => {
    const history = queryBoatPerformanceHistory(BOAT_ID, [row(1), row(2)]);
    const handoff = buildCitedPerformanceHistoryHandoff(history);
    expect(handoff.aggregatesStatus).toBe("insufficient-n");
    expect(handoff.claims.some((c) => c.kind === "withheld")).toBe(true);
    expect(handoff.claims.some((c) => c.kind === "trend")).toBe(false);
    expect(assertHandoffCitationsIntact(handoff)).toEqual({ ok: true });
  });

  it("cites Practice cohort rows for withheld race-only metric claims", () => {
    const history = queryBoatPerformanceHistory(BOAT_ID, [
      row(1, "practice", 5),
      row(2, "practice", 6),
      row(3, "practice", 7),
    ]);
    const handoff = buildCitedPerformanceHistoryHandoff(history);
    const withheld = handoff.claims.find((c) => c.id === "withheld:courseEfficiencyPct");
    expect(withheld).toBeDefined();
    expect(withheld?.citationSessionIds.length).toBeGreaterThan(0);
    expect(assertHandoffCitationsIntact(handoff)).toEqual({ ok: true });
  });
});

describe("compact CSV export", () => {
  it("exports compact observation columns without storage paths", () => {
    const history = queryBoatPerformanceHistory(BOAT_ID, [row(1), row(2, "practice")]);
    const csv = buildCompactObservationCsv(history.observations);
    expect(csv).toContain("startsAt,timezone,sessionType,sessionId,entryId");
    expect(csv).toContain("practice");
    expect(csv).toMatch(/practice-session/);
    expect(csv).not.toMatch(/processed_path|raw_path|storage/);
  });
});

describe("coach request helpers", () => {
  it("builds create params from cited handoff only", () => {
    const history = queryBoatPerformanceHistory(BOAT_ID, [row(1), row(2), row(3)]);
    const handoff = buildCitedPerformanceHistoryHandoff(history);
    const params = buildPerformanceHistoryCoachCreateParams(
      {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        systemPrompt: PERFORMANCE_HISTORY_COACH_SYSTEM_PROMPT,
        maxTokens: 4000,
        thinking: "off",
        effort: null,
      },
      handoff,
    );
    expect(params.route).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    });
    expect(params.system).toContain("association");
    expect(params.system).toMatch(/never.*caus/i);
    expect(params.messages[0]?.content).toContain("boat-performance-history-handoff-v1");
    expect(params.messages[0]?.content).not.toMatch(/raw track|gps point/i);
  });

  it("validates coach markdown structure", () => {
    const good = `# Boat Performance History Coach Notes
## Cohort & provenance
n=3
## Association trends
Median SOG association
## Practice vs Race notes
Practice race-only unavailable
## Suggested next looks
Inspect Sessions session-1
## Citation appendix
trend:avgSogKts -> session-1`;
    expect(validatePerformanceHistoryCoachMarkdown(good)).toBe(true);
    expect(validatePerformanceHistoryCoachMarkdown("# Incomplete")).toBe(false);
  });
});
