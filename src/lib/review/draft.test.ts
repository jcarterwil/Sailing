import { describe, expect, it } from "vitest";

import { EMPTY_CORRECTIONS } from "@/lib/analytics/corrections";
import {
  emptyReviewDraft,
  normalizeReviewDraft,
  reviewDraftHasContent,
  reviewDraftIsStale,
} from "@/lib/review/draft";

describe("normalizeReviewDraft", () => {
  it("returns an empty draft for junk input", () => {
    for (const junk of [null, 42, "x", [], { v: 9 }]) {
      const draft = normalizeReviewDraft(junk);
      expect(draft).toEqual(emptyReviewDraft());
    }
  });

  it("keeps valid dispositions and drops malformed ones", () => {
    const draft = normalizeReviewDraft({
      v: 1,
      corrections: { excludedWindSensorEntryIds: ["entry-1"] },
      dispositions: [
        { fingerprint: "perf:x:race:-", action: "dismissed", note: "ok", at: "2026-07-16T00:00:00.000Z" },
        { fingerprint: "", action: "dismissed", note: null, at: "2026-07-16T00:00:00.000Z" },
        { fingerprint: "a", action: "other", note: null, at: "2026-07-16T00:00:00.000Z" },
        "junk",
      ],
      cursor: "perf:x:race:-",
    });
    expect(draft.corrections.excludedWindSensorEntryIds).toEqual(["entry-1"]);
    expect(draft.dispositions).toHaveLength(1);
    expect(draft.dispositions[0].note).toBe("ok");
    expect(draft.cursor).toBe("perf:x:race:-");
  });

  it("truncates oversized notes and dedupes fingerprints keeping the newest", () => {
    const draft = normalizeReviewDraft({
      v: 1,
      corrections: {},
      dispositions: [
        { fingerprint: "f", action: "dismissed", note: "old", at: "2026-07-15T00:00:00.000Z" },
        { fingerprint: "f", action: "dismissed", note: "x".repeat(1000), at: "2026-07-16T00:00:00.000Z" },
      ],
      cursor: null,
    });
    expect(draft.dispositions).toHaveLength(1);
    expect(draft.dispositions[0].at).toBe("2026-07-16T00:00:00.000Z");
    expect(draft.dispositions[0].note?.length).toBe(500);
  });

  it("caps fingerprint and cursor at 200 chars and dispositions at 200 entries", () => {
    const long = "x".repeat(300);
    const draft = normalizeReviewDraft({
      v: 1,
      corrections: {},
      dispositions: Array.from({ length: 250 }, (_, index) => ({
        fingerprint: index === 0 ? long : `f-${index}`,
        action: "dismissed",
        note: null,
        at: "2026-07-16T00:00:00.000Z",
      })),
      cursor: long,
    });
    expect(draft.dispositions.length).toBe(200);
    expect(draft.dispositions.some((row) => row.fingerprint === long.slice(0, 200))).toBe(true);
    expect(draft.cursor).toBe(long.slice(0, 200));
  });
});

describe("reviewDraftHasContent", () => {
  it("is false for the empty draft and true with corrections or dispositions", () => {
    expect(reviewDraftHasContent(emptyReviewDraft())).toBe(false);
    expect(reviewDraftHasContent({
      ...emptyReviewDraft(),
      corrections: { ...EMPTY_CORRECTIONS, excludedWindSensorEntryIds: ["e"] },
    })).toBe(true);
    expect(reviewDraftHasContent({
      ...emptyReviewDraft(),
      dispositions: [{ fingerprint: "f", action: "dismissed", note: null, at: "2026-07-16T00:00:00.000Z" }],
    })).toBe(true);
  });
});

describe("reviewDraftIsStale", () => {
  it("detects analysis or corrections drift, ignoring exact matches and null bases", () => {
    const base = { baseAnalysisComputedAt: "a1", baseCorrectionsUpdatedAt: "c1" };
    expect(reviewDraftIsStale(base, { analysisComputedAt: "a1", correctionsUpdatedAt: "c1" })).toBe(false);
    expect(reviewDraftIsStale(base, { analysisComputedAt: "a2", correctionsUpdatedAt: "c1" })).toBe(true);
    expect(reviewDraftIsStale(base, { analysisComputedAt: "a1", correctionsUpdatedAt: null })).toBe(true);
    expect(reviewDraftIsStale(
      { baseAnalysisComputedAt: null, baseCorrectionsUpdatedAt: null },
      { analysisComputedAt: "a1", correctionsUpdatedAt: null },
    )).toBe(true);
  });
});
