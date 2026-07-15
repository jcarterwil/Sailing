import {
  SERIES_MAX_COMPETITORS,
  SERIES_MAX_RACES,
  SERIES_MAX_RESULTS_PER_RACE,
} from "@/lib/analytics/constants";
import { canonicalJson } from "@/lib/analytics/series/fingerprint";
import { scoreSeriesLowPointV1 } from "@/lib/analytics/series/scoring";
import {
  LOW_POINT_V1,
  type SeriesScoringInputV1,
  type SeriesScoringResultV1,
} from "@/lib/analytics/series/types";

const MAX_SNAPSHOT_JSON_BYTES = 16 * 1024 * 1024;
// Worst-case scorer output is 200 standings × 100 race cells plus 30,000 race rows.
const MAX_SNAPSHOT_NODES = 2_000_000;
const MAX_SNAPSHOT_DEPTH = 32;
const MAX_ISSUES = 8;

export type SeriesSnapshotParseResultV1 =
  | { status: "missing"; result: null; issues: [] }
  | { status: "valid"; result: SeriesScoringResultV1; issues: [] }
  | { status: "unsupported"; result: null; version: unknown; issues: string[] }
  | { status: "malformed"; result: null; issues: string[] };

export interface StoredSeriesSnapshotV1 {
  scoringVersion: string;
  sourceFingerprint: string;
  result: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function malformed(...issues: string[]): SeriesSnapshotParseResultV1 {
  return {
    status: "malformed",
    result: null,
    issues: issues.slice(0, MAX_ISSUES),
  };
}

function inspectJson(value: unknown): string | null {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return "Snapshot is not JSON-serializable.";
  }
  if (serialized === undefined) return "Snapshot must be a JSON object.";
  if (new TextEncoder().encode(serialized).byteLength > MAX_SNAPSHOT_JSON_BYTES) {
    return "Snapshot exceeds the report payload limit.";
  }

  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes++;
    if (nodes > MAX_SNAPSHOT_NODES) return "Snapshot exceeds the report complexity limit.";
    if (current.depth > MAX_SNAPSHOT_DEPTH) return "Snapshot exceeds the report nesting limit.";
    if (typeof current.value === "number" && !Number.isFinite(current.value)) {
      return "Snapshot contains a non-finite number.";
    }
    if (current.value === null || typeof current.value !== "object") continue;
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
  }
  return null;
}

function boundedResultShape(record: Record<string, unknown>): string | null {
  if (!Array.isArray(record.races)) return "Snapshot races must be an array.";
  if (!Array.isArray(record.standings)) return "Snapshot standings must be an array.";
  if (record.races.length > SERIES_MAX_RACES) {
    return `Snapshot may contain at most ${SERIES_MAX_RACES} races.`;
  }
  if (record.standings.length > SERIES_MAX_COMPETITORS) {
    return `Snapshot may contain at most ${SERIES_MAX_COMPETITORS} standings.`;
  }
  for (const [index, standing] of record.standings.entries()) {
    if (!isRecord(standing) || !Array.isArray(standing.raceCells)) {
      return `Snapshot standing ${index + 1} has malformed race cells.`;
    }
    if (standing.raceCells.length > SERIES_MAX_RACES) {
      return `Snapshot standing ${index + 1} may contain at most ${SERIES_MAX_RACES} race cells.`;
    }
  }
  for (const [index, race] of record.races.entries()) {
    if (!isRecord(race) || !Array.isArray(race.rows)) {
      return `Snapshot race ${index + 1} has malformed result rows.`;
    }
    if (race.rows.length > SERIES_MAX_RESULTS_PER_RACE) {
      return `Snapshot race ${index + 1} may contain at most ${SERIES_MAX_RESULTS_PER_RACE} rows.`;
    }
    if (race.rows.some((row) => !isRecord(row))) {
      return `Snapshot race ${index + 1} contains a malformed result row.`;
    }
  }
  return null;
}

function reconstructInput(record: Record<string, unknown>): SeriesScoringInputV1 {
  const standings = record.standings as Array<Record<string, unknown>>;
  const races = record.races as Array<Record<string, unknown>>;
  return {
    v: record.v as 1,
    scoringVersion: record.scoringVersion as typeof LOW_POINT_V1,
    config: record.config as SeriesScoringInputV1["config"],
    competitors: standings.map((standing) => ({
      boatId: standing?.boatId as string,
    })),
    races: races.map((race) => ({
      raceId: race.raceId as string,
      sequence: race.sequence as number,
      included: race.included as boolean,
      state: race.state as SeriesScoringInputV1["races"][number]["state"],
      discardEligible: race.discardEligible as boolean,
      source: race.source as SeriesScoringInputV1["races"][number]["source"],
      results: (race.rows as Array<Record<string, unknown>>).map((row) => ({
        entryId: row.entryId as string,
        boatId: row.boatId as string,
        identity: row.identity as SeriesScoringInputV1["races"][number]["results"][number]["identity"],
        status: row.status as SeriesScoringInputV1["races"][number]["results"][number]["status"],
        place: row.place as number | null,
        tied: row.tied as boolean,
        penaltyPoints: (row.penaltyPointsHundredths as number) / 100,
      })),
    })),
  };
}

/**
 * Validates an immutable score snapshot by reconstructing its bounded source
 * contract and requiring byte-for-value equivalence with the deterministic
 * scorer. The returned object is always the stored snapshot, never a newly
 * calculated replacement.
 */
export function parseSeriesScoringSnapshotV1(value: unknown): SeriesSnapshotParseResultV1 {
  if (value === null || value === undefined) return { status: "missing", result: null, issues: [] };
  const jsonIssue = inspectJson(value);
  if (jsonIssue) return malformed(jsonIssue);
  if (!isRecord(value)) return malformed("Snapshot must be an object.");

  if (!("v" in value) || !("scoringVersion" in value)) {
    return malformed("Snapshot version metadata is missing.");
  }

  if (value.v !== 1 || value.scoringVersion !== LOW_POINT_V1) {
    const version = value.v !== 1 ? value.v : value.scoringVersion;
    return {
      status: "unsupported",
      result: null,
      version,
      issues: [`Unsupported series scoring snapshot: ${String(version)}.`],
    };
  }
  const shapeIssue = boundedResultShape(value);
  if (shapeIssue) return malformed(shapeIssue);

  const scored = scoreSeriesLowPointV1(reconstructInput(value));
  if (scored.status === "unsupported") {
    return {
      status: "unsupported",
      result: null,
      version: scored.version,
      issues: scored.issues.map((issue) => issue.message).slice(0, MAX_ISSUES),
    };
  }
  if (scored.status !== "valid") {
    return malformed(...scored.issues.map((issue) => `${issue.path}: ${issue.message}`));
  }
  if (canonicalJson(scored.result) !== canonicalJson(value)) {
    return malformed("Snapshot does not reconcile with the deterministic Low Point V1 result.");
  }
  return { status: "valid", result: value as unknown as SeriesScoringResultV1, issues: [] };
}

/** Validate row metadata as well as the immutable result body. */
export function parseStoredSeriesSnapshotV1(
  snapshot: StoredSeriesSnapshotV1 | null,
): SeriesSnapshotParseResultV1 {
  if (!snapshot) return { status: "missing", result: null, issues: [] };
  const parsed = parseSeriesScoringSnapshotV1(snapshot.result);
  if (parsed.status !== "valid") return parsed;
  if (
    snapshot.scoringVersion !== parsed.result.scoringVersion ||
    snapshot.sourceFingerprint !== parsed.result.sourceFingerprint
  ) {
    return malformed("Snapshot row metadata does not match its immutable result body.");
  }
  return parsed;
}
