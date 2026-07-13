import { norm360 } from "@/lib/analytics/angles";
import { CORRECTION_TWS_MAX_KTS } from "@/lib/analytics/constants";
import type { RaceLegType } from "@/lib/analytics/types";

/** Organizer corrections applied during race analysis (v1). Pure JSON-safe. */
export interface RaceCorrections {
  v: 1;
  /** Entry IDs whose wind sensors are excluded from the fleet combine. */
  excludedWindSensorEntryIds: string[];
  /** Manual true-wind override; null when disabled / unset. */
  manualWind: ManualWindCorrection | null;
  /** Trim the analysis window; null keeps auto-detected bounds. */
  window: AnalysisWindowCorrection | null;
  /** Force race start time; wins over window.startMs when both set. */
  startOverride: StartOverrideCorrection | null;
  /**
   * Relabel legs by time anchor (not index — indices shift when window/start
   * change). Applied after `inferRaceLegs`.
   */
  legRelabels: LegRelabelCorrection[];
}

export interface ManualWindCorrection {
  enabled: boolean;
  twdDeg: number;
  twsKts: number | null;
  twsMinKts: number | null;
  twsMaxKts: number | null;
}

export interface AnalysisWindowCorrection {
  startMs: number;
  endMs: number;
}

export interface StartOverrideCorrection {
  timeMs: number;
}

export interface LegRelabelCorrection {
  atMs: number;
  type: RaceLegType;
}

export const EMPTY_CORRECTIONS: Readonly<RaceCorrections> = Object.freeze({
  v: 1 as const,
  excludedWindSensorEntryIds: Object.freeze([]) as unknown as string[],
  manualWind: null,
  window: null,
  startOverride: null,
  legRelabels: Object.freeze([]) as unknown as LegRelabelCorrection[],
});

const LEG_TYPES = new Set<RaceLegType>(["upwind", "downwind", "reach", "unknown"]);

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function clampTws(value: number | null): number | null {
  if (value == null) return null;
  if (value < 0) return 0;
  if (value > CORRECTION_TWS_MAX_KTS) return CORRECTION_TWS_MAX_KTS;
  return value;
}

function roundMs(value: number): number {
  return Math.round(value);
}

function normalizeManualWind(value: unknown): ManualWindCorrection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const twdRaw = finiteNumber(record.twdDeg);
  if (twdRaw == null) return null;
  const enabled = record.enabled === true;
  let twsMinKts = clampTws(finiteNumber(record.twsMinKts));
  let twsMaxKts = clampTws(finiteNumber(record.twsMaxKts));
  if (twsMinKts != null && twsMaxKts != null && twsMinKts > twsMaxKts) {
    const tmp = twsMinKts;
    twsMinKts = twsMaxKts;
    twsMaxKts = tmp;
  }
  return {
    enabled,
    twdDeg: norm360(twdRaw),
    twsKts: clampTws(finiteNumber(record.twsKts)),
    twsMinKts,
    twsMaxKts,
  };
}

function normalizeWindow(value: unknown): AnalysisWindowCorrection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const startMs = finiteNumber(record.startMs);
  const endMs = finiteNumber(record.endMs);
  if (startMs == null || endMs == null) return null;
  const a = roundMs(startMs);
  const b = roundMs(endMs);
  if (a === b) return null;
  return a < b ? { startMs: a, endMs: b } : { startMs: b, endMs: a };
}

function normalizeStartOverride(value: unknown): StartOverrideCorrection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const timeMs = finiteNumber((value as Record<string, unknown>).timeMs);
  if (timeMs == null) return null;
  return { timeMs: roundMs(timeMs) };
}

function normalizeLegRelabels(value: unknown): LegRelabelCorrection[] {
  if (!Array.isArray(value)) return [];
  const out: LegRelabelCorrection[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const atMs = finiteNumber(record.atMs);
    const type = record.type;
    if (atMs == null || typeof type !== "string" || !LEG_TYPES.has(type as RaceLegType)) {
      continue;
    }
    out.push({ atMs: roundMs(atMs), type: type as RaceLegType });
  }
  out.sort((a, b) => a.atMs - b.atMs || a.type.localeCompare(b.type));
  return out;
}

function normalizeExcludedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  out.sort();
  return out;
}

/**
 * Coerce arbitrary input into a stable `RaceCorrections` (sorted ids/relabels,
 * rounded ms, clamped angles/speeds). Track-span clamping belongs at the API
 * layer where the track extent is known.
 */
export function normalizeCorrections(input: unknown): RaceCorrections {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...EMPTY_CORRECTIONS, excludedWindSensorEntryIds: [], legRelabels: [] };
  }
  const record = input as Record<string, unknown>;
  return {
    v: 1,
    excludedWindSensorEntryIds: normalizeExcludedIds(record.excludedWindSensorEntryIds),
    manualWind: normalizeManualWind(record.manualWind),
    window: normalizeWindow(record.window),
    startOverride: normalizeStartOverride(record.startOverride),
    legRelabels: normalizeLegRelabels(record.legRelabels),
  };
}
/** True when any correction would change analysis vs the auto-detected baseline. */
export function correctionsAreActive(corrections: RaceCorrections): boolean {
  return (
    corrections.excludedWindSensorEntryIds.length > 0 ||
    corrections.manualWind?.enabled === true ||
    corrections.window != null ||
    corrections.startOverride != null ||
    corrections.legRelabels.length > 0
  );
}

function clampMs(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamp window / start override times into a known track span. */
export function clampCorrectionsToTrackSpan(
  corrections: RaceCorrections,
  span: { startMs: number; endMs: number },
): RaceCorrections {
  const next = normalizeCorrections(corrections);
  if (next.window) {
    const startMs = clampMs(next.window.startMs, span.startMs, span.endMs);
    const endMs = clampMs(next.window.endMs, span.startMs, span.endMs);
    next.window = startMs < endMs ? { startMs, endMs } : null;
  }
  if (next.startOverride) {
    let lo = span.startMs;
    let hi = span.endMs;
    // Keep start inside the trimmed window when both are present.
    if (next.window) {
      lo = Math.max(lo, next.window.startMs);
      hi = Math.min(hi, next.window.endMs);
    }
    if (lo <= hi) {
      next.startOverride = {
        timeMs: clampMs(next.startOverride.timeMs, lo, hi),
      };
    } else {
      next.startOverride = {
        timeMs: clampMs(next.startOverride.timeMs, span.startMs, span.endMs),
      };
    }
  }
  return normalizeCorrections(next);
}
