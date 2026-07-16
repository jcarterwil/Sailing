import { describe, expect, it } from "vitest";

import { EMPTY_CORRECTIONS, normalizeCorrections } from "@/lib/analytics/corrections";
import type { PerformanceWarningV1 } from "@/lib/analytics/performance/types";
import type { WindQualityReport } from "@/lib/analytics/types";
import {
  countOpenReviewFindings,
  deriveReviewFindings,
  type ReviewDisposition,
} from "@/lib/review/findings";

const FINISH_WARNING: PerformanceWarningV1 = {
  code: "unavailable-finish-geometry",
  message: "No finish geometry could be inferred.",
  entryId: null,
  legIndex: null,
};

const UNRESOLVED_WARNING: PerformanceWarningV1 = {
  code: "unresolved-finish",
  message: "Finish could not be resolved.",
  entryId: "entry-1",
  legIndex: null,
};

const INFO_WARNING: PerformanceWarningV1 = {
  code: "payload-limited",
  message: "Distribution payload truncated.",
  entryId: null,
  legIndex: 2,
};

const WIND_QUALITY: WindQualityReport = {
  consensusTwdDeg: 280,
  estimateTwdDeg: 282,
  boats: [
    {
      entryId: "entry-2",
      sampleCount: 100,
      dominancePct: 0.34,
      meanTwdDeg: 310,
      resultantStrength: 0.9,
      meanTwsKts: 10,
      deviationFromConsensusDeg: 30,
      deviationFromEstimateDeg: 28,
      excluded: false,
      findings: [
        { code: "direction-outlier", severity: "critical", message: "30° off consensus." },
      ],
      status: "critical",
    },
  ],
};

describe("deriveReviewFindings", () => {
  it("maps performance warnings and wind findings with stable fingerprints", () => {
    const findings = deriveReviewFindings({
      warnings: [FINISH_WARNING, UNRESOLVED_WARNING, INFO_WARNING],
      windQuality: WIND_QUALITY,
      corrections: EMPTY_CORRECTIONS,
      dispositions: [],
    });
    const fingerprints = findings.map((finding) => finding.fingerprint);
    expect(fingerprints).toEqual([
      "perf:unavailable-finish-geometry:race:-",
      "perf:unresolved-finish:entry-1:-",
      "wind:direction-outlier:entry-2",
      "perf:payload-limited:race:2",
    ]);
    // Blockers first, info last.
    expect(findings[0].severity).toBe("blocker");
    expect(findings[0].suggestedFix).toEqual({ kind: "finish-fleet-median" });
    expect(findings[1].suggestedFix).toEqual({ kind: "use-inferred-result", entryId: "entry-1" });
    expect(findings[2].suggestedFix).toEqual({ kind: "exclude-wind-sensor", entryId: "entry-2" });
    expect(findings[3].severity).toBe("info");
    expect(findings[3].suggestedFix).toBeNull();
    expect(findings.every((finding) => finding.status === "open")).toBe(true);
  });

  it("resolves findings from corrections", () => {
    const corrections = normalizeCorrections({
      ...EMPTY_CORRECTIONS,
      excludedWindSensorEntryIds: ["entry-2"],
      course: {
        startLine: null,
        marks: [],
        finish: { kind: "point", position: { lat: 45.4, lon: -84.9 } },
      },
      entryResults: [
        { entryId: "entry-1", status: "dnf", finishTimeMs: null, placeOverride: null, note: null },
      ],
    });
    const findings = deriveReviewFindings({
      warnings: [FINISH_WARNING, UNRESOLVED_WARNING],
      windQuality: WIND_QUALITY,
      corrections,
      dispositions: [],
    });
    expect(findings.map((finding) => finding.status)).toEqual([
      "resolved",
      "resolved",
      "resolved",
    ]);
  });

  it("dismisses by fingerprint and counts only open findings", () => {
    const dispositions: ReviewDisposition[] = [
      {
        fingerprint: "perf:unavailable-finish-geometry:race:-",
        action: "dismissed",
        note: "committee boat finish, no geometry",
        at: "2026-07-16T00:00:00.000Z",
      },
    ];
    const input = {
      warnings: [FINISH_WARNING, UNRESOLVED_WARNING],
      windQuality: null,
      corrections: EMPTY_CORRECTIONS,
      dispositions,
    };
    const findings = deriveReviewFindings(input);
    expect(findings[0].status).toBe("dismissed");
    expect(countOpenReviewFindings(input)).toBe(1);
  });

  it("deduplicates repeated warning fingerprints and skips excluded boats", () => {
    const findings = deriveReviewFindings({
      warnings: [UNRESOLVED_WARNING, UNRESOLVED_WARNING],
      windQuality: {
        ...WIND_QUALITY,
        boats: [{ ...WIND_QUALITY.boats[0], excluded: true }],
      },
      corrections: EMPTY_CORRECTIONS,
      dispositions: [],
    });
    expect(findings.filter((finding) => finding.fingerprint === "perf:unresolved-finish:entry-1:-")).toHaveLength(1);
    const wind = findings.find((finding) => finding.fingerprint === "wind:direction-outlier:entry-2");
    expect(wind?.status).toBe("resolved");
  });
});
