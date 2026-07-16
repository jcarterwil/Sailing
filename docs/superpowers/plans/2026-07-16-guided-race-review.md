# Guided Race Review (Review Assistant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the already-persisted analysis warnings into a guided, resumable organizer review: a prioritized findings queue with one-click fixes on the Review page, server-persisted draft state, and a "Reviewed ✓ / N items to review" badge on every report surface.

**Architecture:** A pure findings engine (`src/lib/review/findings.ts`) derives review items from persisted `PerformanceWarningV1[]` + `WindQualityReport` + `RaceCorrections` + dismissals, so the Review panel, Overview card, and report badges can never disagree. A new `race_review_drafts` table (service-role only) persists in-progress corrections + dispositions for disconnect-safe resume; drafts never touch `race_corrections` — only the existing Apply & re-analyze endpoint does, and on success it clears the draft's corrections while keeping dispositions.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres + RLS, service-role via `createAdminClient`), Vitest, Tailwind 4 + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-07-16-guided-race-review-design.md`

## Global Constraints

- Node 24 locally (matches CI and `engines`); npm. Fast checks: `npm run lint`, `npm run typecheck`, `npm run test`. CI owns `npm run build` — do not run a local production build.
- Migrations must be additive/backward-compatible; app and schema may deploy in either order. After schema change run `npm run db:types` and commit the regenerated `src/lib/supabase/database.types.ts`.
- The admin (service-role) client bypasses RLS — every call site must do its own authorization first (`is_race_organizer` RPC for writes; race membership / share-slug resolution for badge reads).
- Drafts NEVER write `race_corrections` (spec §4). Only `POST /api/races/[raceId]/corrections` does.
- "Null is not zero": findings/ badges derive only from a `valid` parsed analysis; otherwise render nothing new (existing states already cover stale/upgrade).
- Vitest is scoped to `src/**/*.test.ts` (pure TS only — no jsdom). UI components are verified by typecheck + dev-server smoke, with logic extracted into testable pure modules.
- Branch: `feature/guided-race-review` off `main`. Squash-merge PRs; each PR maps to a roadmap issue.
- Copy rules (exact strings): badge states are `Reviewed ✓` and `{n} items to review` (singular `1 item to review`); panel title is `Review Assistant`.

---

### Task 1: Findings engine (`src/lib/review/findings.ts`)

**Files:**
- Create: `src/lib/review/findings.ts`
- Create: `src/lib/review/findings.test.ts`

**Interfaces:**
- Consumes: `PerformanceWarningV1` (`src/lib/analytics/performance/types.ts:275`), `WindQualityReport`/`BoatWindQuality`/`WindQualityFindingCode` (`src/lib/analytics/types.ts:247-284`), `RaceCorrections` (`src/lib/analytics/corrections.ts:79`).
- Produces (used by Tasks 6–8):
  - `type ReviewDisposition = { fingerprint: string; action: "dismissed"; note: string | null; at: string }`
  - `type ReviewSuggestedFix = { kind: "exclude-wind-sensor"; entryId: string } | { kind: "finish-fleet-median" } | { kind: "use-inferred-result"; entryId: string }`
  - `interface ReviewFinding { fingerprint; code; severity: "blocker"|"warning"|"info"; title: string; detail: string; target: "wind"|"start-course"|"results"; entryId: string|null; legIndex: number|null; suggestedFix: ReviewSuggestedFix|null; status: "open"|"resolved"|"dismissed" }`
  - `deriveReviewFindings(input: { warnings: readonly PerformanceWarningV1[]; windQuality: WindQualityReport | null | undefined; corrections: RaceCorrections; dispositions: readonly ReviewDisposition[] }): ReviewFinding[]`
  - `countOpenReviewFindings(input: same): number`

- [ ] **Step 1: Write the failing test**

Create `src/lib/review/findings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/review/findings.test.ts`
Expected: FAIL — cannot resolve `@/lib/review/findings`.

- [ ] **Step 3: Implement `src/lib/review/findings.ts`**

```ts
import type { RaceCorrections } from "@/lib/analytics/corrections";
import type {
  PerformanceWarningCode,
  PerformanceWarningV1,
} from "@/lib/analytics/performance/types";
import type {
  WindQualityFindingCode,
  WindQualityReport,
} from "@/lib/analytics/types";

export type ReviewFindingSeverity = "blocker" | "warning" | "info";
export type ReviewFindingStatus = "open" | "resolved" | "dismissed";
export type ReviewTargetTab = "wind" | "start-course" | "results";

export interface ReviewDisposition {
  fingerprint: string;
  action: "dismissed";
  note: string | null;
  at: string;
}

export type ReviewSuggestedFix =
  | { kind: "exclude-wind-sensor"; entryId: string }
  | { kind: "finish-fleet-median" }
  | { kind: "use-inferred-result"; entryId: string };

export interface ReviewFinding {
  fingerprint: string;
  code: string;
  severity: ReviewFindingSeverity;
  title: string;
  detail: string;
  target: ReviewTargetTab;
  entryId: string | null;
  legIndex: number | null;
  suggestedFix: ReviewSuggestedFix | null;
  status: ReviewFindingStatus;
}

export interface DeriveReviewFindingsInput {
  warnings: readonly PerformanceWarningV1[];
  windQuality: WindQualityReport | null | undefined;
  corrections: RaceCorrections;
  dispositions: readonly ReviewDisposition[];
}

interface PerfCatalogRow {
  severity: ReviewFindingSeverity;
  target: ReviewTargetTab;
  priority: number;
  title: string;
  /** True when the current draft corrections address this finding. */
  resolvedBy: (corrections: RaceCorrections, warning: PerformanceWarningV1) => boolean;
  suggestedFix: (warning: PerformanceWarningV1) => ReviewSuggestedFix | null;
}

const never = () => false;
const noFix = () => null;
const marksChanged = (corrections: RaceCorrections) => corrections.course.marks.length > 0;

/** Catalog: spec §5.1. Lower priority sorts first. */
const PERF_CATALOG: Record<PerformanceWarningCode, PerfCatalogRow> = {
  "unavailable-finish-geometry": {
    severity: "blocker",
    target: "start-course",
    priority: 0,
    title: "No finish could be detected",
    resolvedBy: (corrections) => corrections.course.finish !== null,
    suggestedFix: () => ({ kind: "finish-fleet-median" }),
  },
  "unresolved-finish": {
    severity: "blocker",
    target: "results",
    priority: 1,
    title: "A boat's finish could not be resolved",
    resolvedBy: (corrections, warning) =>
      warning.entryId !== null &&
      corrections.entryResults.some((result) => result.entryId === warning.entryId),
    suggestedFix: (warning) =>
      warning.entryId ? { kind: "use-inferred-result", entryId: warning.entryId } : null,
  },
  "dispersed-mark-cluster": {
    severity: "warning",
    target: "start-course",
    priority: 2,
    title: "A mark rounding cluster is dispersed",
    resolvedBy: marksChanged,
    suggestedFix: noFix,
  },
  "unsupported-mark": {
    severity: "warning",
    target: "start-course",
    priority: 3,
    title: "A course mark lacks fleet support",
    resolvedBy: marksChanged,
    suggestedFix: noFix,
  },
  "missing-entry-passage": {
    severity: "warning",
    target: "start-course",
    priority: 4,
    title: "A boat is missing a mark passage",
    resolvedBy: marksChanged,
    suggestedFix: noFix,
  },
  "non-monotonic-passage": {
    severity: "warning",
    target: "start-course",
    priority: 5,
    title: "A boat's passages are out of order",
    resolvedBy: marksChanged,
    suggestedFix: noFix,
  },
  "incomplete-start-geometry": {
    severity: "warning",
    target: "start-course",
    priority: 6,
    title: "Start-line geometry is incomplete",
    resolvedBy: (corrections) =>
      corrections.course.startLine !== null || corrections.startOverride !== null,
    suggestedFix: noFix,
  },
  "insufficient-coverage": {
    severity: "info",
    target: "results",
    priority: 8,
    title: "Track coverage is insufficient for some metrics",
    resolvedBy: never,
    suggestedFix: noFix,
  },
  "source-gap": {
    severity: "info",
    target: "results",
    priority: 9,
    title: "A track has recording gaps",
    resolvedBy: never,
    suggestedFix: noFix,
  },
  "distribution-omitted": {
    severity: "info",
    target: "results",
    priority: 10,
    title: "A VMG distribution was omitted",
    resolvedBy: never,
    suggestedFix: noFix,
  },
  "payload-limited": {
    severity: "info",
    target: "results",
    priority: 11,
    title: "The persisted payload was size-limited",
    resolvedBy: never,
    suggestedFix: noFix,
  },
};

interface WindCatalogRow {
  severity: ReviewFindingSeverity;
  priority: number;
  title: string;
  /** Exclusion always resolves; some codes also resolve via manual wind. */
  manualWindResolves: boolean;
  excludeFix: boolean;
}

const WIND_CATALOG: Record<WindQualityFindingCode, WindCatalogRow> = {
  "direction-outlier": {
    severity: "warning", priority: 7, title: "A wind sensor disagrees with the fleet",
    manualWindResolves: false, excludeFix: true,
  },
  "dominates-fleet": {
    severity: "warning", priority: 7, title: "One sensor dominates the fleet wind",
    manualWindResolves: false, excludeFix: true,
  },
  "implausible-tws": {
    severity: "warning", priority: 7, title: "A sensor reports implausible wind speed",
    manualWindResolves: false, excludeFix: true,
  },
  "disagrees-with-estimate": {
    severity: "warning", priority: 7, title: "Sensor wind disagrees with the GPS estimate",
    manualWindResolves: true, excludeFix: false,
  },
  "low-internal-consistency": {
    severity: "warning", priority: 7, title: "A sensor's wind readings are inconsistent",
    manualWindResolves: true, excludeFix: false,
  },
  "sparse-samples": {
    severity: "info", priority: 12, title: "A sensor has sparse wind samples",
    manualWindResolves: false, excludeFix: false,
  },
};

export function performanceWarningFingerprint(warning: PerformanceWarningV1): string {
  return `perf:${warning.code}:${warning.entryId ?? "race"}:${warning.legIndex ?? "-"}`;
}

export function deriveReviewFindings(input: DeriveReviewFindingsInput): ReviewFinding[] {
  const dismissed = new Set(
    input.dispositions
      .filter((disposition) => disposition.action === "dismissed")
      .map((disposition) => disposition.fingerprint),
  );
  const status = (fingerprint: string, resolved: boolean): ReviewFindingStatus =>
    resolved ? "resolved" : dismissed.has(fingerprint) ? "dismissed" : "open";

  const rows: Array<ReviewFinding & { priority: number }> = [];
  const seen = new Set<string>();

  for (const warning of input.warnings) {
    const catalog = PERF_CATALOG[warning.code];
    if (!catalog) continue;
    const fingerprint = performanceWarningFingerprint(warning);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    rows.push({
      fingerprint,
      code: warning.code,
      severity: catalog.severity,
      title: catalog.title,
      detail: warning.message,
      target: catalog.target,
      entryId: warning.entryId,
      legIndex: warning.legIndex,
      suggestedFix: catalog.suggestedFix(warning),
      status: status(fingerprint, catalog.resolvedBy(input.corrections, warning)),
      priority: catalog.priority,
    });
  }

  const manualWindEnabled = input.corrections.manualWind?.enabled === true;
  for (const boat of input.windQuality?.boats ?? []) {
    const excluded =
      boat.excluded ||
      input.corrections.excludedWindSensorEntryIds.includes(boat.entryId);
    for (const finding of boat.findings) {
      const catalog = WIND_CATALOG[finding.code];
      if (!catalog) continue;
      const fingerprint = `wind:${finding.code}:${boat.entryId}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const resolved = excluded || (catalog.manualWindResolves && manualWindEnabled);
      rows.push({
        fingerprint,
        code: finding.code,
        severity: catalog.severity,
        title: catalog.title,
        detail: finding.message,
        target: "wind",
        entryId: boat.entryId,
        legIndex: null,
        suggestedFix: catalog.excludeFix
          ? { kind: "exclude-wind-sensor", entryId: boat.entryId }
          : null,
        status: status(fingerprint, resolved),
        priority: catalog.priority,
      });
    }
  }

  rows.sort(
    (left, right) =>
      left.priority - right.priority ||
      (left.legIndex ?? -1) - (right.legIndex ?? -1) ||
      (left.entryId ?? "").localeCompare(right.entryId ?? "") ||
      left.fingerprint.localeCompare(right.fingerprint),
  );
  return rows.map(({ priority: _priority, ...finding }) => finding);
}

export function countOpenReviewFindings(input: DeriveReviewFindingsInput): number {
  return deriveReviewFindings(input).filter((finding) => finding.status === "open").length;
}

/** Exact badge copy (Global Constraints). */
export function reviewBadgeLabel(openCount: number): string {
  if (openCount === 0) return "Reviewed ✓";
  return openCount === 1 ? "1 item to review" : `${openCount} items to review`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/review/findings.test.ts`
Expected: PASS (4 tests). If ordering assertions fail, check the sort: priorities are finish 0, unresolved 1, wind warnings 7, info 8+.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: clean.

```bash
git add src/lib/review/findings.ts src/lib/review/findings.test.ts
git commit -m "feat(review): pure findings engine derived from persisted warnings"
```

---

### Task 2: Draft document helpers (`src/lib/review/draft.ts`)

**Files:**
- Create: `src/lib/review/draft.ts`
- Create: `src/lib/review/draft.test.ts`

**Interfaces:**
- Consumes: `normalizeCorrections`, `EMPTY_CORRECTIONS`, `RaceCorrections` (`src/lib/analytics/corrections.ts`); `ReviewDisposition` (Task 1).
- Produces (used by Tasks 4–7):
  - `interface ReviewDraftV1 { v: 1; corrections: RaceCorrections; dispositions: ReviewDisposition[]; cursor: string | null }`
  - `emptyReviewDraft(): ReviewDraftV1`
  - `normalizeReviewDraft(input: unknown): ReviewDraftV1`
  - `reviewDraftHasContent(draft: ReviewDraftV1): boolean`
  - `reviewDraftIsStale(base: { baseAnalysisComputedAt: string | null; baseCorrectionsUpdatedAt: string | null }, current: { analysisComputedAt: string | null; correctionsUpdatedAt: string | null }): boolean`
  - `REVIEW_DRAFT_MAX_JSON_CHARS = 200_000`

- [ ] **Step 1: Write the failing test**

Create `src/lib/review/draft.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/review/draft.test.ts`
Expected: FAIL — cannot resolve `@/lib/review/draft`.

- [ ] **Step 3: Implement `src/lib/review/draft.ts`**

```ts
import {
  EMPTY_CORRECTIONS,
  correctionsAreActive,
  normalizeCorrections,
  type RaceCorrections,
} from "@/lib/analytics/corrections";
import type { ReviewDisposition } from "@/lib/review/findings";

export const REVIEW_DRAFT_MAX_JSON_CHARS = 200_000;
const MAX_FINGERPRINT_CHARS = 200;
const MAX_NOTE_CHARS = 500;
const MAX_DISPOSITIONS = 200;

export interface ReviewDraftV1 {
  v: 1;
  corrections: RaceCorrections;
  dispositions: ReviewDisposition[];
  cursor: string | null;
}

export function emptyReviewDraft(): ReviewDraftV1 {
  return {
    v: 1,
    corrections: normalizeCorrections(EMPTY_CORRECTIONS),
    dispositions: [],
    cursor: null,
  };
}

function normalizeDispositions(value: unknown): ReviewDisposition[] {
  if (!Array.isArray(value)) return [];
  const rows = value.flatMap((raw): ReviewDisposition[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    if (record.action !== "dismissed") return [];
    const fingerprint =
      typeof record.fingerprint === "string" ? record.fingerprint.trim().slice(0, MAX_FINGERPRINT_CHARS) : "";
    const at = typeof record.at === "string" && Number.isFinite(Date.parse(record.at)) ? record.at : null;
    if (!fingerprint || !at) return [];
    const note = typeof record.note === "string" && record.note.trim()
      ? record.note.trim().slice(0, MAX_NOTE_CHARS)
      : null;
    return [{ fingerprint, action: "dismissed", note, at }];
  });
  // Keep the newest disposition per fingerprint.
  rows.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const byFingerprint = new Map<string, ReviewDisposition>();
  for (const row of rows) if (!byFingerprint.has(row.fingerprint)) byFingerprint.set(row.fingerprint, row);
  return [...byFingerprint.values()].slice(0, MAX_DISPOSITIONS);
}

/** Normalize arbitrary persisted input into one stable V1 draft document. */
export function normalizeReviewDraft(input: unknown): ReviewDraftV1 {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  if (record.v !== undefined && record.v !== 1) return emptyReviewDraft();
  const cursor = typeof record.cursor === "string" && record.cursor.trim()
    ? record.cursor.trim().slice(0, MAX_FINGERPRINT_CHARS)
    : null;
  return {
    v: 1,
    corrections: normalizeCorrections(record.corrections ?? null),
    dispositions: normalizeDispositions(record.dispositions),
    cursor,
  };
}

/** True when a draft carries anything worth resuming. */
export function reviewDraftHasContent(draft: ReviewDraftV1): boolean {
  return correctionsAreActive(draft.corrections) || draft.dispositions.length > 0;
}

/** Spec §7: base snapshots no longer match the live analysis/corrections state. */
export function reviewDraftIsStale(
  base: { baseAnalysisComputedAt: string | null; baseCorrectionsUpdatedAt: string | null },
  current: { analysisComputedAt: string | null; correctionsUpdatedAt: string | null },
): boolean {
  return (
    base.baseAnalysisComputedAt !== current.analysisComputedAt ||
    base.baseCorrectionsUpdatedAt !== current.correctionsUpdatedAt
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/review/draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck
git add src/lib/review/draft.ts src/lib/review/draft.test.ts
git commit -m "feat(review): draft document normalization and staleness helpers"
```

---

### Task 3: `race_review_drafts` migration + server store helpers

**Files:**
- Create: `supabase/migrations/20260717000000_race_review_drafts.sql`
- Create: `src/lib/review/draft-store.ts`
- Modify: `src/lib/supabase/database.types.ts` (regenerated by `npm run db:types`)

**Interfaces:**
- Consumes: `createAdminClient` (`src/lib/supabase/admin.ts`), Task 2's `normalizeReviewDraft`/`ReviewDraftV1`, Task 1's `ReviewDisposition`.
- Produces (used by Tasks 4–6):
  - `interface StoredReviewDraft { draft: ReviewDraftV1; baseAnalysisComputedAt: string | null; baseCorrectionsUpdatedAt: string | null; updatedBy: string | null; updatedAt: string }`
  - `loadReviewDraft(raceId: string): Promise<StoredReviewDraft | null>` — missing table/row ⇒ `null`
  - `loadReviewDispositions(raceId: string): Promise<ReviewDisposition[]>` — missing ⇒ `[]`
  - `saveReviewDraft(input: { raceId; userId; draft: ReviewDraftV1; baseAnalysisComputedAt: string | null; baseCorrectionsUpdatedAt: string | null }): Promise<{ updatedAt: string }>`
  - `deleteReviewDraft(raceId: string): Promise<void>`
  - `clearReviewDraftAfterApply(input: { raceId; baseAnalysisComputedAt: string | null; baseCorrectionsUpdatedAt: string | null }): Promise<void>` — keeps dispositions, clears corrections/cursor; no-op when table/row missing

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260717000000_race_review_drafts.sql`:

```sql
-- Organizer in-progress review drafts (spec 2026-07-16-guided-race-review).
-- One row per race: draft corrections + finding dispositions + queue cursor.
-- Drafts NEVER touch race_corrections; only Apply & re-analyze promotes them.
-- Service-role only: no anon/authenticated access. Organizer checks happen in
-- the /api/races/[raceId]/review-draft route; members only ever see derived
-- open-finding counts, never draft contents.

create table public.race_review_drafts (
  race_id uuid primary key references public.races (id) on delete cascade,
  draft jsonb not null default '{}'::jsonb,
  base_analysis_computed_at timestamptz,
  base_corrections_updated_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint race_review_drafts_draft_is_object
    check (jsonb_typeof(draft) = 'object')
);

alter table public.race_review_drafts enable row level security;

revoke all on table public.race_review_drafts from anon;
revoke all on table public.race_review_drafts from authenticated;
```

- [ ] **Step 2: Apply locally and regenerate types**

Run: `npm run db:push`
Expected: `Applying migration 20260717000000_race_review_drafts.sql... Finished npm run db:push`.

Run: `npm run db:types`
Expected: `src/lib/supabase/database.types.ts` now contains a `race_review_drafts` table type. Verify with: `git diff --stat src/lib/supabase/database.types.ts` (nonzero diff).

- [ ] **Step 3: Implement `src/lib/review/draft-store.ts`**

```ts
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import {
  emptyReviewDraft,
  normalizeReviewDraft,
  type ReviewDraftV1,
} from "@/lib/review/draft";
import type { ReviewDisposition } from "@/lib/review/findings";

export interface StoredReviewDraft {
  draft: ReviewDraftV1;
  baseAnalysisComputedAt: string | null;
  baseCorrectionsUpdatedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

/** Postgres "relation does not exist" — app deployed before the migration. */
function missingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

/** Load a race's draft row. Missing table or row degrades to null (spec §7). */
export async function loadReviewDraft(raceId: string): Promise<StoredReviewDraft | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("race_review_drafts")
    .select("draft, base_analysis_computed_at, base_corrections_updated_at, updated_by, updated_at")
    .eq("race_id", raceId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw new Error(`Could not load review draft: ${error.message}`);
  }
  if (!data) return null;
  return {
    draft: normalizeReviewDraft(data.draft),
    baseAnalysisComputedAt: data.base_analysis_computed_at,
    baseCorrectionsUpdatedAt: data.base_corrections_updated_at,
    updatedBy: data.updated_by,
    updatedAt: data.updated_at,
  };
}

/** Dispositions only — used for badge counts after the caller verified access. */
export async function loadReviewDispositions(raceId: string): Promise<ReviewDisposition[]> {
  try {
    const stored = await loadReviewDraft(raceId);
    return stored?.draft.dispositions ?? [];
  } catch {
    // Badge counts must never break a report page.
    return [];
  }
}

export async function saveReviewDraft(input: {
  raceId: string;
  userId: string;
  draft: ReviewDraftV1;
  baseAnalysisComputedAt: string | null;
  baseCorrectionsUpdatedAt: string | null;
}): Promise<{ updatedAt: string }> {
  const admin = createAdminClient();
  const updatedAt = new Date().toISOString();
  const { error } = await admin.from("race_review_drafts").upsert(
    {
      race_id: input.raceId,
      draft: input.draft as unknown as Json,
      base_analysis_computed_at: input.baseAnalysisComputedAt,
      base_corrections_updated_at: input.baseCorrectionsUpdatedAt,
      updated_by: input.userId,
      updated_at: updatedAt,
    },
    { onConflict: "race_id" },
  );
  if (error) throw new Error(`Could not save review draft: ${error.message}`);
  return { updatedAt };
}

export async function deleteReviewDraft(raceId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("race_review_drafts").delete().eq("race_id", raceId);
  if (error && !missingTable(error)) {
    throw new Error(`Could not delete review draft: ${error.message}`);
  }
}

/**
 * After a successful Apply & re-analyze: clear draft corrections + cursor,
 * KEEP dispositions, refresh base snapshots (spec §5.2). Atomic with apply —
 * called from the corrections route, never the client.
 */
export async function clearReviewDraftAfterApply(input: {
  raceId: string;
  baseAnalysisComputedAt: string | null;
  baseCorrectionsUpdatedAt: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("race_review_drafts")
    .select("draft, updated_by")
    .eq("race_id", input.raceId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return;
    throw new Error(`Could not read review draft: ${error.message}`);
  }
  if (!data) return;
  const kept = normalizeReviewDraft(data.draft);
  const next: ReviewDraftV1 = { ...emptyReviewDraft(), dispositions: kept.dispositions };
  const { error: updateError } = await admin
    .from("race_review_drafts")
    .update({
      draft: next as unknown as Json,
      base_analysis_computed_at: input.baseAnalysisComputedAt,
      base_corrections_updated_at: input.baseCorrectionsUpdatedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("race_id", input.raceId);
  if (updateError) throw new Error(`Could not clear review draft: ${updateError.message}`);
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean. If `race_review_drafts` is unknown to the Supabase types, re-run `npm run db:types` (Step 2).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260717000000_race_review_drafts.sql src/lib/review/draft-store.ts src/lib/supabase/database.types.ts
git commit -m "feat(review): race_review_drafts table and service-role draft store"
```

---

### Task 4: Review-draft API route

**Files:**
- Create: `src/app/api/races/[raceId]/review-draft/route.ts`

**Interfaces:**
- Consumes: Task 2 (`normalizeReviewDraft`, `REVIEW_DRAFT_MAX_JSON_CHARS`), Task 3 (`loadReviewDraft`, `saveReviewDraft`, `deleteReviewDraft`).
- Produces (used by Task 6's hook):
  - `GET` → `200 { stored: StoredReviewDraft | null }`
  - `PUT` body `{ draft: unknown; baseAnalysisComputedAt: string | null; baseCorrectionsUpdatedAt: string | null }` → `200 { updatedAt: string }`
  - `DELETE` → `200 { ok: true }`
  - All: `401` unsigned, `404` race invisible, `403` non-organizer, `413` oversized draft.

- [ ] **Step 1: Implement the route**

Create `src/app/api/races/[raceId]/review-draft/route.ts` (auth mirrors `src/app/api/races/[raceId]/corrections/route.ts:41-72`):

```ts
import { NextResponse } from "next/server";

import {
  REVIEW_DRAFT_MAX_JSON_CHARS,
  normalizeReviewDraft,
} from "@/lib/review/draft";
import {
  deleteReviewDraft,
  loadReviewDraft,
  saveReviewDraft,
} from "@/lib/review/draft-store";
import { createClient } from "@/lib/supabase/server";

async function requireOrganizer(raceId: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  // RLS-visible read proves membership.
  const { data: race } = await supabase.from("races").select("id").eq("id", raceId).maybeSingle();
  if (!race) {
    return { ok: false, response: NextResponse.json({ error: "Race not found." }, { status: 404 }) };
  }
  const { data: canOrganize, error } = await supabase.rpc("is_race_organizer", { rid: raceId });
  if (error) {
    return { ok: false, response: NextResponse.json({ error: "Could not verify access." }, { status: 500 }) };
  }
  if (!canOrganize) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Only the organizer can edit the review draft." }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const auth = await requireOrganizer(raceId);
  if (!auth.ok) return auth.response;
  const stored = await loadReviewDraft(raceId);
  return NextResponse.json({ stored });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const auth = await requireOrganizer(raceId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (JSON.stringify(body).length > REVIEW_DRAFT_MAX_JSON_CHARS) {
    return NextResponse.json({ error: "Review draft is too large." }, { status: 413 });
  }
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  // Autosave is lightweight: normalize only. Deep span/entry validation stays
  // in POST /corrections at apply time (spec §5.2).
  const draft = normalizeReviewDraft(record.draft);
  const baseAnalysisComputedAt =
    typeof record.baseAnalysisComputedAt === "string" ? record.baseAnalysisComputedAt : null;
  const baseCorrectionsUpdatedAt =
    typeof record.baseCorrectionsUpdatedAt === "string" ? record.baseCorrectionsUpdatedAt : null;
  const { updatedAt } = await saveReviewDraft({
    raceId,
    userId: auth.userId,
    draft,
    baseAnalysisComputedAt,
    baseCorrectionsUpdatedAt,
  });
  return NextResponse.json({ updatedAt });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const auth = await requireOrganizer(raceId);
  if (!auth.ok) return auth.response;
  await deleteReviewDraft(raceId);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck, lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Smoke-test the route against the dev server**

Run `npm run dev`, sign in as an organizer in the browser, then from browser devtools on a race page run:

```js
await (await fetch(`/api/races/${location.pathname.split("/")[2]}/review-draft`)).json()
```

Expected: `{ stored: null }` on first call. Then:

```js
await (await fetch(`/api/races/${location.pathname.split("/")[2]}/review-draft`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ draft: { v: 1, corrections: {}, dispositions: [], cursor: null }, baseAnalysisComputedAt: null, baseCorrectionsUpdatedAt: null }),
})).json()
```

Expected: `{ updatedAt: "<ISO>" }`, and a follow-up GET returns the stored draft.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/races/[raceId]/review-draft/route.ts"
git commit -m "feat(review): organizer-gated review-draft GET/PUT/DELETE route"
```

---

### Task 5: Apply-integration — clear draft on successful corrections apply

**Files:**
- Modify: `src/app/api/races/[raceId]/corrections/route.ts:186-201`

**Interfaces:**
- Consumes: Task 3's `clearReviewDraftAfterApply`.
- Produces: no API shape change; after a successful apply the draft row keeps only dispositions and fresh `base_*` snapshots.

- [ ] **Step 1: Add the import**

In `src/app/api/races/[raceId]/corrections/route.ts`, after the existing `@/lib/races/analyze-race` import block add:

```ts
import { clearReviewDraftAfterApply } from "@/lib/review/draft-store";
```

- [ ] **Step 2: Clear the draft after a successful reanalysis**

Replace the success branch (currently `const result = await analyzeAndPersistRace(raceId); return NextResponse.json({ ... })`) with:

```ts
    const result = await analyzeAndPersistRace(raceId);
    // Spec §5.2: promote-then-clear. Keep dispositions; refresh base snapshots
    // so a resumed draft is no longer flagged stale. Draft cleanup must never
    // fail the apply itself.
    try {
      await clearReviewDraftAfterApply({
        raceId,
        baseAnalysisComputedAt: result.computedAt,
        baseCorrectionsUpdatedAt: result.correctionsUpdatedAt ?? updatedAt,
      });
    } catch (draftError) {
      console.error("review draft cleanup failed", draftError);
    }
    return NextResponse.json({
```

(The remainder of the JSON body is unchanged.)

- [ ] **Step 3: Typecheck, lint**

Run: `npm run typecheck && npm run lint`
Expected: clean. `updatedAt` is already in scope from the corrections upsert (`route.ts:136`).

- [ ] **Step 4: Smoke-test**

With the dev server running as organizer: save a PUT draft (Task 4 Step 3), then on the Review page change anything and Apply & re-analyze. Fetch the draft route again.
Expected: `stored.draft.corrections` equals the empty corrections document, `stored.draft.dispositions` unchanged, `base_analysis_computed_at` equals the new analysis `computedAt`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/races/[raceId]/corrections/route.ts"
git commit -m "feat(review): clear draft corrections (keep dispositions) after apply"
```

---

### Task 6: Review badge on Overview, Report tab, and public share

**Files:**
- Create: `src/components/review/review-status-badge.tsx`
- Modify: `src/components/performance/performance-overview.tsx:107-131` (new optional prop) and `:208-224` (render)
- Modify: `src/app/races/[raceId]/page.tsx` (Session status card + corrections select)
- Modify: `src/app/races/[raceId]/performance/page.tsx` (compute + pass `review`)
- Modify: `src/app/s/[slug]/performance/page.tsx` (compute + pass `review`)

**Interfaces:**
- Consumes: Task 1 (`countOpenReviewFindings`, `reviewBadgeLabel`), Task 3 (`loadReviewDispositions`), existing `parseStoredRaceAnalysis`, `normalizeCorrections`.
- Produces: `ReviewStatusBadge({ openCount }: { openCount: number })` component; `PerformanceOverview` gains optional `review?: { openCount: number } | null`.

- [ ] **Step 1: Create the badge component**

Create `src/components/review/review-status-badge.tsx`:

```tsx
import { BadgeCheck, ListTodo } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { reviewBadgeLabel } from "@/lib/review/findings";

/** Spec §5.3: auto-publish with a visible review state on every report surface. */
export function ReviewStatusBadge({ openCount }: { openCount: number }) {
  const reviewed = openCount === 0;
  return (
    <Badge variant={reviewed ? "default" : "secondary"}>
      {reviewed ? (
        <BadgeCheck className="size-3" aria-hidden="true" />
      ) : (
        <ListTodo className="size-3" aria-hidden="true" />
      )}
      {reviewBadgeLabel(openCount)}
    </Badge>
  );
}
```

- [ ] **Step 2: Add the `review` prop to `PerformanceOverview`**

In `src/components/performance/performance-overview.tsx`:

1. Add the import next to the other component imports:

```tsx
import { ReviewStatusBadge } from "@/components/review/review-status-badge";
```

2. Extend the props (after the `navigation?` member of the props object type):

```tsx
  /** Open review-finding count; null hides the badge (e.g. stale analysis). */
  review?: { openCount: number } | null;
```

and destructure it in the function signature: `export function PerformanceOverview({ model, drilldown, navigation, review }: { ... })`.

3. Render it next to the "Race report" eyebrow. Replace:

```tsx
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
              Race report
            </p>
```

with:

```tsx
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
                Race report
              </p>
              {review ? <ReviewStatusBadge openCount={review.openCount} /> : null}
            </div>
```

- [ ] **Step 3: Compute the count on the authenticated Report page**

In `src/app/races/[raceId]/performance/page.tsx`:

1. Add imports:

```tsx
import { normalizeCorrections } from "@/lib/analytics/corrections";
import { loadReviewDispositions } from "@/lib/review/draft-store";
import { countOpenReviewFindings } from "@/lib/review/findings";
```

2. Widen the corrections select (currently `select("updated_at")`) to:

```tsx
    supabase
      .from("race_corrections")
      .select("corrections, updated_at")
      .eq("race_id", raceId)
      .maybeSingle(),
```

3. After `const drilldownTracks = await loadPerformanceTrackMetas(raceId);` add (membership was already proven by `loadSessionWorkspaceChrome`, satisfying the admin-client authorization rule):

```tsx
  const dispositions = await loadReviewDispositions(raceId);
  const reviewOpenCount = countOpenReviewFindings({
    warnings: parsed.performance.warnings,
    windQuality: currentAnalysis.windQuality,
    corrections: normalizeCorrections(correctionsResult.data?.corrections ?? null),
    dispositions,
  });
```

4. Pass `review={{ openCount: reviewOpenCount }}` to `<PerformanceOverview ...>`.

- [ ] **Step 4: Compute the count on the public share page**

In `src/app/s/[slug]/performance/page.tsx`, mirror Step 3: add the same three imports; widen the corrections select from `select("updated_at")` to `select("corrections, updated_at")`; after `publicPerformance` is built add:

```tsx
  const dispositions = await loadReviewDispositions(race.id);
  const reviewOpenCount = countOpenReviewFindings({
    warnings: parsed.performance.warnings,
    windQuality: currentAnalysis.windQuality,
    corrections: normalizeCorrections(correctionsResult.data?.corrections ?? null),
    dispositions,
  });
```

and pass `review={{ openCount: reviewOpenCount }}` to `<PerformanceOverview ...>`. (Access is authorized by `resolveSharedRace` slug resolution.)

- [ ] **Step 5: Add the review line to the Overview Session status card**

In `src/app/races/[raceId]/page.tsx`:

1. Add the same three imports as Step 3, plus `parseStoredRaceAnalysis` is already imported? It is NOT — add:

```tsx
import { parseStoredRaceAnalysis } from "@/lib/races/stored-analysis";
```

2. Widen the corrections select (in the `Promise.all`, currently `select("updated_at")`) to `select("corrections, updated_at")`.

3. After the `reportAvailable` computation (`page.tsx:215-221`) add:

```tsx
  const parsedForReview = isRaceSession
    ? parseStoredRaceAnalysis({
        value: analysisRow?.analysis,
        computedAt: analysisRow?.computed_at,
        processedTrackUpdatedAts: processedUpdatedAts,
        correctionsUpdatedAt: correctionsRow?.updated_at,
      })
    : null;
  const reviewOpenCount =
    parsedForReview?.status === "valid" && parsedForReview.performance
      ? countOpenReviewFindings({
          warnings: parsedForReview.performance.warnings,
          windQuality: parsedForReview.analysis?.windQuality,
          corrections: normalizeCorrections(correctionsRow?.corrections ?? null),
          dispositions: await loadReviewDispositions(raceId),
        })
      : null;
```

4. In the Session status `CardContent` (after the `Next action:` paragraph block) add:

```tsx
                {reviewOpenCount !== null ? (
                  <p className="text-muted-foreground">
                    Data review:{" "}
                    <span className="font-medium text-foreground">
                      {reviewOpenCount === 0
                        ? "Reviewed ✓"
                        : reviewOpenCount === 1
                          ? "1 item to review"
                          : `${reviewOpenCount} items to review`}
                    </span>
                    {canManageRace && reviewOpenCount > 0 ? (
                      <>
                        {" · "}
                        <Link
                          href={`/races/${race.id}/review`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          Review data
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
```

- [ ] **Step 6: Typecheck, lint, smoke**

Run: `npm run typecheck && npm run lint`
Expected: clean.

Dev-server smoke: open the July 7 race — Overview shows `N items to review · Review data`; the Report tab shows the badge next to "Race report"; the public share page (if the race has a share slug) shows the same count.

- [ ] **Step 7: Commit**

```bash
git add src/components/review/review-status-badge.tsx src/components/performance/performance-overview.tsx "src/app/races/[raceId]/page.tsx" "src/app/races/[raceId]/performance/page.tsx" "src/app/s/[slug]/performance/page.tsx"
git commit -m "feat(review): Reviewed/N-items badge on overview, report, and public share"
```

---

### Task 7: `useReviewDraft` hook + resume banner + autosave

**Files:**
- Create: `src/app/races/[raceId]/review/use-review-draft.ts`
- Modify: `src/app/races/[raceId]/review/page.tsx` (load draft + bases, pass props)
- Modify: `src/app/races/[raceId]/review/review-page-client.tsx` (wire hook, resume banner, save indicator)

**Interfaces:**
- Consumes: Tasks 2–4 (`ReviewDraftV1`, `reviewDraftHasContent`, `reviewDraftIsStale`, `StoredReviewDraft`, the `/review-draft` route), existing `corrections` state + `setCorrections` in `ReviewPageClient`.
- Produces (used by Task 8):
  - `useReviewDraft(input: { raceId: string; corrections: RaceCorrections; setCorrections: (next: RaceCorrections) => void; persistedCorrections: RaceCorrections; initialStoredDraft: StoredReviewDraft | null; analysisComputedAt: string | null; correctionsUpdatedAt: string | null }): { dispositions: ReviewDisposition[]; dismissFinding: (fingerprint: string, note: string | null) => void; undismissFinding: (fingerprint: string) => void; cursor: string | null; setCursor: (fingerprint: string | null) => void; resume: { available: boolean; stale: boolean; updatedAt: string | null; accept: () => void; discard: () => void } | null; saveState: "idle" | "saving" | "saved" | "error" }`
  - Resume banner shows the draft's saved timestamp only (deliberate simplification of spec §6.4's "by {name}" — the `updated_by` uuid is persisted for a future name lookup).

- [ ] **Step 1: Implement the hook**

Create `src/app/races/[raceId]/review/use-review-draft.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RaceCorrections } from "@/lib/analytics/corrections";
import {
  reviewDraftHasContent,
  reviewDraftIsStale,
  type ReviewDraftV1,
} from "@/lib/review/draft";
import type { StoredReviewDraft } from "@/lib/review/draft-store";
import type { ReviewDisposition } from "@/lib/review/findings";

const AUTOSAVE_DEBOUNCE_MS = 2_000;
const RETRY_DELAY_MS = 10_000;

export type ReviewDraftSaveState = "idle" | "saving" | "saved" | "error";

export function useReviewDraft(input: {
  raceId: string;
  corrections: RaceCorrections;
  setCorrections: (next: RaceCorrections) => void;
  /** The applied (persisted) corrections — the baseline "Start fresh" restores. */
  persistedCorrections: RaceCorrections;
  initialStoredDraft: StoredReviewDraft | null;
  analysisComputedAt: string | null;
  correctionsUpdatedAt: string | null;
}) {
  const {
    raceId, corrections, setCorrections, persistedCorrections,
    initialStoredDraft, analysisComputedAt, correctionsUpdatedAt,
  } = input;
  const resumable =
    initialStoredDraft !== null && reviewDraftHasContent(initialStoredDraft.draft);
  const [pendingResume, setPendingResume] = useState(resumable);
  const [dispositions, setDispositions] = useState<ReviewDisposition[]>(
    // Dispositions always carry forward, even without an explicit resume.
    initialStoredDraft?.draft.dispositions ?? [],
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<ReviewDraftSaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(true);

  const persist = useCallback(async (draft: ReviewDraftV1) => {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/races/${raceId}/review-draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          baseAnalysisComputedAt: analysisComputedAt,
          baseCorrectionsUpdatedAt: correctionsUpdatedAt,
        }),
        keepalive: true,
      });
      if (res.ok) {
        setSaveState("saved");
        return;
      }
      setSaveState("error");
      // Spec §7 disconnect handling: retry once the connection may be back.
      timer.current = setTimeout(() => void persist(draft), RETRY_DELAY_MS);
    } catch {
      setSaveState("error");
      timer.current = setTimeout(() => void persist(draft), RETRY_DELAY_MS);
    }
  }, [raceId, analysisComputedAt, correctionsUpdatedAt]);

  // Debounced autosave on any draft change. Skip the initial mount so merely
  // opening the page never creates a draft row.
  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    const draft: ReviewDraftV1 = { v: 1, corrections, dispositions, cursor };
    timer.current = setTimeout(() => void persist(draft), AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [corrections, dispositions, cursor, persist]);

  // Flush on tab-hide (spec §6.4) — fetch keepalive survives navigation.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== "hidden") return;
      if (timer.current) {
        clearTimeout(timer.current);
        void persist({ v: 1, corrections, dispositions, cursor });
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [corrections, dispositions, cursor, persist]);

  const dismissFinding = useCallback((fingerprint: string, note: string | null) => {
    setDispositions((current) => [
      ...current.filter((row) => row.fingerprint !== fingerprint),
      { fingerprint, action: "dismissed", note, at: new Date().toISOString() },
    ]);
  }, []);

  const undismissFinding = useCallback((fingerprint: string) => {
    setDispositions((current) => current.filter((row) => row.fingerprint !== fingerprint));
  }, []);

  const resume = pendingResume && initialStoredDraft
    ? {
        available: true,
        stale: reviewDraftIsStale(
          {
            baseAnalysisComputedAt: initialStoredDraft.baseAnalysisComputedAt,
            baseCorrectionsUpdatedAt: initialStoredDraft.baseCorrectionsUpdatedAt,
          },
          { analysisComputedAt, correctionsUpdatedAt },
        ),
        updatedAt: initialStoredDraft.updatedAt,
        accept: () => {
          setCorrections(initialStoredDraft.draft.corrections);
          setDispositions(initialStoredDraft.draft.dispositions);
          setCursor(initialStoredDraft.draft.cursor);
          setPendingResume(false);
        },
        discard: () => {
          setPendingResume(false);
          setDispositions([]);
          setCursor(null);
          void fetch(`/api/races/${raceId}/review-draft`, { method: "DELETE" });
          // "Start fresh" = back to the APPLIED corrections baseline, not empty.
          skipNextSave.current = true;
          setCorrections(persistedCorrections);
        },
      }
    : null;

  return { dispositions, dismissFinding, undismissFinding, cursor, setCursor, resume, saveState };
}
```

- [ ] **Step 2: Pass server data through the Review page**

In `src/app/races/[raceId]/review/page.tsx`:

1. Add import:

```tsx
import { loadReviewDraft } from "@/lib/review/draft-store";
```

2. After `const initialCorrections: RaceCorrections = ...` add:

```tsx
  const storedDraft = await loadReviewDraft(raceId);
```

3. Extend the `<ReviewPageClient>` props:

```tsx
      initialStoredDraft={storedDraft}
      analysisComputedAt={analysisRow?.computed_at ?? null}
```

- [ ] **Step 3: Wire the hook + resume banner + save indicator into `ReviewPageClient`**

In `src/app/races/[raceId]/review/review-page-client.tsx`:

1. Add imports:

```tsx
import { useReviewDraft } from "@/app/races/[raceId]/review/use-review-draft";
import type { StoredReviewDraft } from "@/lib/review/draft-store";
```

2. Extend the props type and destructuring with:

```tsx
  initialStoredDraft: StoredReviewDraft | null;
  analysisComputedAt: string | null;
```

3. After the `useReviewPreview(...)` call add:

```tsx
  const reviewDraft = useReviewDraft({
    raceId,
    corrections,
    setCorrections,
    persistedCorrections: initialCorrections,
    initialStoredDraft,
    analysisComputedAt,
    correctionsUpdatedAt,
  });
```

(`correctionsUpdatedAt` is already a prop — it just was not destructured; add it to the destructuring list.)

4. Render the resume banner as the FIRST child of the alerts `<section aria-live="polite">` (make that section render whenever `reviewDraft.resume` is non-null too, by adding `|| reviewDraft.resume` to its condition):

```tsx
          {reviewDraft.resume && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
              <span>
                Resume review draft
                {reviewDraft.resume.updatedAt
                  ? ` · saved ${new Date(reviewDraft.resume.updatedAt).toLocaleString()}`
                  : ""}
                {reviewDraft.resume.stale
                  ? " · analysis changed since this draft (may be stale)"
                  : ""}
              </span>
              <div className="ml-auto flex gap-2">
                <Button type="button" size="sm" onClick={reviewDraft.resume.accept}>
                  Resume
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={reviewDraft.resume.discard}>
                  Start fresh
                </Button>
              </div>
            </div>
          )}
```

5. Add the save indicator next to the header spinner (inside the `<header>`, after the `(previewing || pending)` loader):

```tsx
        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {reviewDraft.saveState === "saving" && "Saving draft…"}
          {reviewDraft.saveState === "saved" && "Draft saved"}
          {reviewDraft.saveState === "error" && "Reconnecting — changes not yet saved"}
        </span>
```

(Change the existing loader's `className` from `ml-auto size-4 ...` to `size-4 ...` so the two do not both claim `ml-auto`.)

- [ ] **Step 4: Typecheck, lint, smoke**

Run: `npm run typecheck && npm run lint`
Expected: clean.

Dev smoke: open Review as organizer, toggle a wind exclusion, wait 2 s → "Draft saved" appears. Reload the page → resume banner appears; Resume restores the exclusion; Start fresh clears it and deletes the row (verify via GET returning `stored` with empty content or `null`).

- [ ] **Step 5: Commit**

```bash
git add "src/app/races/[raceId]/review/use-review-draft.ts" "src/app/races/[raceId]/review/page.tsx" "src/app/races/[raceId]/review/review-page-client.tsx"
git commit -m "feat(review): server-persisted resumable review drafts with autosave"
```

---

### Task 8: Review Assistant panel

**Files:**
- Create: `src/app/races/[raceId]/review/review-assistant.tsx`
- Modify: `src/app/races/[raceId]/review/review-page-client.tsx` (derive findings, controlled tabs, accept-fix handlers, mount panel)

**Interfaces:**
- Consumes: Task 1 (`deriveReviewFindings`, `ReviewFinding`, `ReviewSuggestedFix`), Task 7 (`reviewDraft.dispositions/dismissFinding/undismissFinding/cursor/setCursor`), existing helpers `fleetMedianPositionAt`, `inferredResultCorrection`, `replaceEntryResultCorrection` (`review-state.ts`), `usePlaybackStore`.
- Produces: `ReviewAssistant` component rendered between the alerts section and the tabs grid.

- [ ] **Step 1: Create the panel component**

Create `src/app/races/[raceId]/review/review-assistant.tsx`:

```tsx
"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Info, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reviewBadgeLabel, type ReviewFinding } from "@/lib/review/findings";

function severityIcon(severity: ReviewFinding["severity"]) {
  if (severity === "blocker") return <CircleAlert className="size-4 text-destructive" aria-hidden="true" />;
  if (severity === "warning") return <CircleAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />;
  return <Info className="size-4 text-muted-foreground" aria-hidden="true" />;
}

function fixLabel(finding: ReviewFinding): string | null {
  const fix = finding.suggestedFix;
  if (!fix) return null;
  if (fix.kind === "exclude-wind-sensor") return "Exclude this wind sensor";
  if (fix.kind === "use-inferred-result") return "Use inferred result";
  return "Finish = fleet median at playhead";
}

export function ReviewAssistant({
  findings,
  boatNameById,
  activeFingerprint,
  onActivate,
  onAcceptFix,
  onAdjustManually,
  onDismiss,
  onUndismiss,
}: {
  findings: readonly ReviewFinding[];
  boatNameById: ReadonlyMap<string, string>;
  activeFingerprint: string | null;
  onActivate: (fingerprint: string) => void;
  onAcceptFix: (finding: ReviewFinding) => void;
  onAdjustManually: (finding: ReviewFinding) => void;
  onDismiss: (fingerprint: string, note: string | null) => void;
  onUndismiss: (fingerprint: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const open = findings.filter((finding) => finding.status === "open");
  const resolved = findings.filter((finding) => finding.status === "resolved");
  const dismissed = findings.filter((finding) => finding.status === "dismissed");
  const active =
    open.find((finding) => finding.fingerprint === activeFingerprint) ?? open[0] ?? null;

  return (
    <section
      aria-labelledby="review-assistant-heading"
      className="rounded-lg border border-border"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
      >
        <h2 id="review-assistant-heading" className="text-sm font-medium">
          Review Assistant
        </h2>
        <Badge variant={open.length === 0 ? "default" : "secondary"}>
          {reviewBadgeLabel(open.length)}
        </Badge>
        {resolved.length > 0 && (
          <span className="text-xs text-muted-foreground">{resolved.length} resolved</span>
        )}
        <span className="ml-auto">
          {collapsed
            ? <ChevronDown className="size-4" aria-hidden="true" />
            : <ChevronUp className="size-4" aria-hidden="true" />}
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-3 border-t border-border p-4">
          {open.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
              No open review items. Apply &amp; re-analyze below to persist any accepted fixes.
            </p>
          ) : (
            <ol className="space-y-2">
              {open.map((finding) => {
                const isActive = finding.fingerprint === active?.fingerprint;
                const boatName = finding.entryId
                  ? boatNameById.get(finding.entryId) ?? finding.entryId.slice(0, 8)
                  : null;
                return (
                  <li
                    key={finding.fingerprint}
                    className={`rounded-lg border p-3 ${isActive ? "border-primary/60 bg-primary/5" : "border-border"}`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 text-left"
                      onClick={() => onActivate(finding.fingerprint)}
                    >
                      {severityIcon(finding.severity)}
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">
                          {finding.title}
                          {boatName ? ` — ${boatName}` : ""}
                          {finding.legIndex !== null ? ` (leg ${finding.legIndex + 1})` : ""}
                        </span>
                        {isActive && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {finding.detail}
                          </span>
                        )}
                      </span>
                    </button>
                    {isActive && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {finding.suggestedFix && (
                          <Button type="button" size="sm" onClick={() => onAcceptFix(finding)}>
                            {fixLabel(finding)}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onAdjustManually(finding)}
                        >
                          Adjust manually
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onDismiss(finding.fingerprint, null)}
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {dismissed.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                Dismissed ({dismissed.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {dismissed.map((finding) => (
                  <li key={finding.fingerprint} className="flex items-center gap-2">
                    <span>{finding.title}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2"
                      onClick={() => onUndismiss(finding.fingerprint)}
                    >
                      <Undo2 className="size-3" aria-hidden="true" />
                      Un-dismiss
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Wire findings + handlers into `ReviewPageClient`**

In `src/app/races/[raceId]/review/review-page-client.tsx`:

1. Add imports:

```tsx
import { ReviewAssistant } from "@/app/races/[raceId]/review/review-assistant";
import {
  fleetMedianPositionAt,
  inferredResultCorrection,
  replaceEntryResultCorrection,
} from "@/app/races/[raceId]/review/review-state";
import { deriveReviewFindings, type ReviewFinding } from "@/lib/review/findings";
```

(`review-state` is already imported for `resetReviewDraft` etc. — merge into that import statement.)

2. Make the tabs controlled. Add state next to the other `useState` calls:

```tsx
  const [activeTab, setActiveTab] = useState("wind");
```

and change `<Tabs defaultValue="wind" className="min-w-0">` to
`<Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0">`.

3. Derive findings from the STABLE baseline (initial analysis) + live draft state, after the `validationErrors` memo:

```tsx
  const findings = useMemo(
    () =>
      deriveReviewFindings({
        warnings: initialAnalysis?.performance?.warnings ?? [],
        windQuality: initialAnalysis?.windQuality,
        corrections,
        dispositions: reviewDraft.dispositions,
      }),
    [initialAnalysis, corrections, reviewDraft.dispositions],
  );
```

4. Add the accept-fix handler beneath `toggleExclude`:

```tsx
  function acceptSuggestedFix(finding: ReviewFinding) {
    const fix = finding.suggestedFix;
    if (!fix) return;
    if (fix.kind === "exclude-wind-sensor") {
      toggleExclude(fix.entryId, true);
      setActiveTab("wind");
      return;
    }
    if (fix.kind === "use-inferred-result") {
      const inferred = initialAnalysis?.performance?.results.find(
        (result) => result.entryId === fix.entryId,
      );
      setCorrections((current) =>
        replaceEntryResultCorrection(
          current,
          inferredResultCorrection(fix.entryId, inferred),
          fix.entryId,
        ));
      setActiveTab("results");
      return;
    }
    // finish-fleet-median: spec §6.3 walked input — playhead supplies the time.
    const position = processed
      ? fleetMedianPositionAt(processed, usePlaybackStore.getState().timeMs)
      : null;
    if (!position) {
      setApplyError(
        "Scrub the playhead to when the fleet crossed the finish, then accept the fix again.",
      );
      return;
    }
    updateCorrections({
      course: { ...corrections.course, finish: { kind: "point", position } },
    });
    setActiveTab("start-course");
  }
```

5. Apply-conflict re-derivation (spec §7): in the existing `apply()` function's `!res.ok` branch, refresh on a 409 so the queue re-derives from the fresh analysis (dispositions survive server-side). After the `setApplyError(...)` call add:

```tsx
          if (res.status === 409) router.refresh();
```

6. Mount the panel between the alerts section and the `grid` div:

```tsx
      <ReviewAssistant
        findings={findings}
        boatNameById={boatNameById}
        activeFingerprint={reviewDraft.cursor}
        onActivate={reviewDraft.setCursor}
        onAcceptFix={acceptSuggestedFix}
        onAdjustManually={(finding) => {
          setActiveTab(finding.target === "start-course" ? "start-course" : finding.target);
          reviewDraft.setCursor(finding.fingerprint);
        }}
        onDismiss={reviewDraft.dismissFinding}
        onUndismiss={reviewDraft.undismissFinding}
      />
```

- [ ] **Step 3: Typecheck, lint**

Run: `npm run typecheck && npm run lint`
Expected: clean. Note `setCorrections` accepts an updater function (it is a `useState` setter), which Step 2.4 relies on.

- [ ] **Step 4: Dev-server walkthrough**

On the July 7 race Review page:
1. Panel lists open findings, blockers first ("No finish could be detected" on top).
2. Click the finish finding → drag the replay playhead to the fleet's finish → accept "Finish = fleet median at playhead" → finding flips to resolved; Preview summary's course distance/unresolved counts update.
3. Accept "Use inferred result" on an unresolved boat → Results tab shows the DNF/finish correction.
4. Dismiss an info finding → it moves to the Dismissed section; badge count drops; un-dismiss restores it.
5. Wait 2 s → "Draft saved"; reload → resume works with the accepted fixes intact.

- [ ] **Step 5: Commit**

```bash
git add "src/app/races/[raceId]/review/review-assistant.tsx" "src/app/races/[raceId]/review/review-page-client.tsx"
git commit -m "feat(review): guided Review Assistant panel with one-click fixes"
```

---

### Task 9: Full verification + acceptance on the July 7 fixture

**Files:**
- No new files. Fix anything the gates flag.

- [ ] **Step 1: Run every local gate**

Run: `npm run lint && npm run typecheck && npm run test`
Expected: all clean/green (findings, draft, plus all pre-existing suites).

- [ ] **Step 2: Acceptance walkthrough (spec §8)**

Against the dev server on race `09d36915-a267-4bc0-bf51-e60da5aca77c` (July 7 — Little Traverse Bay), signed in as the organizer:

1. Overview shows `N items to review · Review data`.
2. Review Assistant walks: finish geometry (playhead → fleet median) and each unresolved finish (inferred result), plus any wind findings.
3. Apply & re-analyze succeeds; page refreshes.
4. Report tab: results table now shows resolved finishes/ranks/deltas with `organizer-override` provenance where corrected; badge reads `Reviewed ✓` (or the remaining open count if info findings were left undismissed — dismiss or document).
5. Draft row: GET `/api/races/<id>/review-draft` shows cleared corrections, kept dispositions, fresh `base_*`.
6. Reload Review → no resume banner (draft has no content) and findings reflect the NEW analysis.

Capture before/after screenshots of the Overview card, Review Assistant, and the Report results table for the PR body.

- [ ] **Step 3: Commit any fixes and push**

```bash
git add -A
git commit -m "test(review): acceptance fixes from July 7 walkthrough"   # only if changes exist
git push -u origin feature/guided-race-review
```

CI (`npm run verify`) owns the production build; fix anything it flags.
