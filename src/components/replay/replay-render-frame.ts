import type { LoadedTrack } from "@/components/replay/track-loader";
import {
  sampleAt,
  type TrackSampleSource,
} from "@/components/replay/track-index";
import type {
  ReplayWindReading,
  ReplayWindResolver,
} from "@/components/replay/wind-resolution";
import { norm360 } from "@/lib/analytics/angles";
import {
  PRESTART_WINDOW_MS,
  startForLine,
  startLineAt,
  type StartLine,
} from "@/lib/analytics/start-line";
import {
  signedTwaDeg,
  tackFromSignedTwa,
  type SailingTack,
} from "@/lib/analytics/sailing";
import type {
  RaceLegType,
  RaceLine,
  RaceStructure,
} from "@/lib/analytics/types";

const DEG_TO_RAD = Math.PI / 180;
const EARTH_METERS_PER_DEGREE = 111_320;
const BOOM_CENTER_EPSILON_DEG = 1e-6;
const PRESENTATION_HEAVE_AMPLITUDE_M = 0.18;
const PRESENTATION_HEAVE_HZ = 0.14;
const PRESENTATION_WAKE_FULL_SPEED_KTS = 12;

export const PRESENTATION_ONLY_SYNTHETIC =
  "presentation-only-synthetic" as const;

export type ReplayRenderUpdateKind = "initial" | "continuous" | "snap";
export type ReplayRenderBoomSide = "port" | "center" | "starboard";
export type ReplayRenderPoseHeadingSource =
  | "recorded-heading"
  | "recorded-cog-fallback"
  | "default-zero";
export type ReplayRenderPoseScalarSource = "recorded" | "default-zero";
export type ReplayRenderBoomSource =
  | "resolved-wind"
  | "recorded-heel-fallback"
  | "default-center";

export interface ReplayRenderOrigin {
  lat: number;
  lon: number;
}

export interface ReplayRenderPosition {
  lat: number;
  lon: number;
  /** Eastward offset from the fixed frame origin. */
  eastM: number;
  /** Northward offset from the fixed frame origin. */
  northM: number;
}

export interface ReplayRenderPlaybackState {
  timeMs: number;
  playing: boolean;
  selectedEntryId: string | null;
}

export interface ReplayRenderFrameInputs {
  tracks: readonly LoadedTrack[];
  /** Fixed for the source lifetime; never follows the selected boat. */
  origin: ReplayRenderOrigin;
  startsMs: readonly number[];
  windAt: ReplayWindResolver | null;
  raceStructure: RaceStructure | null;
}

export interface ReplayRenderWind {
  twdDeg: number;
  twsKts: number | null;
  twsRangeKts: readonly [number | null, number | null] | null;
  provenance: {
    source: ReplayWindReading["source"];
    confidence: ReplayWindReading["confidence"];
  };
}

export interface ReplayRenderBoat {
  entryId: string;
  boatName: string;
  color: string;
  selected: boolean;
  inTrack: boolean;
  position: ReplayRenderPosition;
  /**
   * Data-honest sampled values. Missing sensor values stay null; renderers
   * consume the finite pose below instead of silently treating null as data.
   */
  recorded: {
    sogKts: number | null;
    cogDeg: number | null;
    headingDeg: number | null;
    heelDeg: number | null;
    trimDeg: number | null;
  };
  pose: {
    headingDeg: number;
    heelDeg: number;
    trimDeg: number;
    boomSide: ReplayRenderBoomSide;
  };
  sailing: {
    signedTwaDeg: number | null;
    tack: SailingTack | null;
  };
  provenance: {
    sample: TrackSampleSource;
    pose: {
      headingDeg: ReplayRenderPoseHeadingSource;
      heelDeg: ReplayRenderPoseScalarSource;
      trimDeg: ReplayRenderPoseScalarSource;
      boomSide: ReplayRenderBoomSource;
    };
  };
  presentation: {
    heaveM: {
      value: number;
      provenance: typeof PRESENTATION_ONLY_SYNTHETIC;
    };
    wakeStrength: {
      value: number;
      provenance: typeof PRESENTATION_ONLY_SYNTHETIC;
    };
  };
}

export interface ReplayRenderStartLine {
  gunTimeMs: number | null;
  pin: ReplayRenderPosition;
  boat: ReplayRenderPosition;
  provenance: RaceLine["source"];
}

export interface ReplayRenderMark {
  id: string;
  legIndex: number;
  legType: RaceLegType;
  position: ReplayRenderPosition;
  provenance: "analysis-derived" | "organizer-override";
}

export interface ReplayRenderCourse {
  startLine: ReplayRenderStartLine | null;
  marks: readonly ReplayRenderMark[];
}

export interface ReplayRenderFrame {
  version: 1;
  sequence: number;
  timeMs: number;
  playing: boolean;
  updateKind: ReplayRenderUpdateKind;
  origin: ReplayRenderOrigin;
  wind: ReplayRenderWind | null;
  boats: readonly ReplayRenderBoat[];
  course: ReplayRenderCourse;
}

export interface BuildReplayRenderFrameOptions {
  sequence?: number;
  updateKind?: ReplayRenderUpdateKind;
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

export function toReplayRenderPosition(
  origin: ReplayRenderOrigin,
  coordinate: { lat: number; lon: number },
): ReplayRenderPosition {
  const latitudeScale = Math.cos(origin.lat * DEG_TO_RAD);
  return {
    lat: coordinate.lat,
    lon: coordinate.lon,
    eastM:
      (coordinate.lon - origin.lon) *
      EARTH_METERS_PER_DEGREE *
      latitudeScale,
    northM:
      (coordinate.lat - origin.lat) * EARTH_METERS_PER_DEGREE,
  };
}

function resolvedWind(
  windAt: ReplayWindResolver | null,
  timeMs: number,
): ReplayRenderWind | null {
  const reading = windAt?.(timeMs);
  if (!reading || !Number.isFinite(reading.twdDeg)) return null;

  return {
    twdDeg: norm360(reading.twdDeg),
    twsKts:
      reading.twsKts != null && Number.isFinite(reading.twsKts)
        ? reading.twsKts
        : null,
    twsRangeKts: reading.twsRangeKts
      ? [reading.twsRangeKts[0], reading.twsRangeKts[1]]
      : null,
    provenance: {
      source: reading.source,
      confidence: reading.confidence,
    },
  };
}

function entryPhase(entryId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < entryId.length; i++) {
    hash ^= entryId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

function presentationValues(
  entryId: string,
  timeMs: number,
  sogKts: number | null,
  inTrack: boolean,
): ReplayRenderBoat["presentation"] {
  const heaveM = inTrack
    ? Math.sin(
        timeMs * (PRESENTATION_HEAVE_HZ * Math.PI * 2 / 1_000) +
          entryPhase(entryId),
      ) * PRESENTATION_HEAVE_AMPLITUDE_M
    : 0;
  const wakeStrength =
    inTrack && sogKts != null
      ? Math.min(1, Math.max(0, sogKts / PRESENTATION_WAKE_FULL_SPEED_KTS))
      : 0;

  return {
    heaveM: {
      value: heaveM,
      provenance: PRESENTATION_ONLY_SYNTHETIC,
    },
    wakeStrength: {
      value: wakeStrength,
      provenance: PRESENTATION_ONLY_SYNTHETIC,
    },
  };
}

function buildBoat(
  track: LoadedTrack,
  origin: ReplayRenderOrigin,
  timeMs: number,
  selectedEntryId: string | null,
  wind: ReplayRenderWind | null,
): ReplayRenderBoat {
  const sample = sampleAt(track, timeMs);
  const recordedSog = finiteOrNull(sample.sogKts);
  const recordedCog = finiteOrNull(sample.cogDeg);
  const recordedHeading = finiteOrNull(sample.hdgDeg);
  const recordedHeel = finiteOrNull(sample.heelDeg);
  const recordedTrim = finiteOrNull(sample.trimDeg);

  const headingDeg =
    recordedHeading != null
      ? norm360(recordedHeading)
      : recordedCog != null
        ? norm360(recordedCog)
        : 0;
  const headingSource: ReplayRenderPoseHeadingSource =
    recordedHeading != null
      ? "recorded-heading"
      : recordedCog != null
        ? "recorded-cog-fallback"
        : "default-zero";
  const heelDeg = recordedHeel ?? 0;
  const trimDeg = recordedTrim ?? 0;
  const courseDeg = recordedCog ?? headingDeg;
  const twaDeg =
    wind != null && Number.isFinite(courseDeg)
      ? signedTwaDeg(wind.twdDeg, courseDeg)
      : null;

  let boomSide: ReplayRenderBoomSide = "center";
  let boomSource: ReplayRenderBoomSource = "default-center";
  if (twaDeg != null) {
    boomSource = "resolved-wind";
    if (Math.abs(twaDeg) > BOOM_CENTER_EPSILON_DEG) {
      boomSide = twaDeg > 0 ? "port" : "starboard";
    }
  } else if (recordedHeel != null && Math.abs(recordedHeel) > BOOM_CENTER_EPSILON_DEG) {
    // Positive heel is starboard-down, implying port tack and a starboard boom.
    boomSide = recordedHeel > 0 ? "starboard" : "port";
    boomSource = "recorded-heel-fallback";
  }

  return {
    entryId: track.entryId,
    boatName: track.boatName,
    color: track.color,
    selected: selectedEntryId === track.entryId,
    inTrack: sample.inTrack,
    position: toReplayRenderPosition(origin, sample),
    recorded: {
      sogKts: recordedSog,
      cogDeg: recordedCog,
      headingDeg: recordedHeading,
      heelDeg: recordedHeel,
      trimDeg: recordedTrim,
    },
    pose: {
      headingDeg,
      heelDeg,
      trimDeg,
      boomSide,
    },
    sailing: {
      signedTwaDeg: twaDeg,
      tack: twaDeg == null ? null : tackFromSignedTwa(twaDeg),
    },
    provenance: {
      sample: sample.sampleSource,
      pose: {
        headingDeg: headingSource,
        heelDeg: recordedHeel == null ? "default-zero" : "recorded",
        trimDeg: recordedTrim == null ? "default-zero" : "recorded",
        boomSide: boomSource,
      },
    },
    presentation: presentationValues(
      track.entryId,
      timeMs,
      recordedSog,
      sample.inTrack,
    ),
  };
}

function analyzedStartVisible(
  raceStructure: RaceStructure,
  timeMs: number,
): boolean {
  const startMs = raceStructure.start.timeMs;
  return startMs == null || timeMs >= startMs - PRESTART_WINDOW_MS;
}

function resolveCourseStartLine(
  inputs: ReplayRenderFrameInputs,
  timeMs: number,
): ReplayRenderStartLine | null {
  const gunTimeMs = startForLine(Array.from(inputs.startsMs), timeMs);
  let line: StartLine | null = null;
  if (gunTimeMs != null) {
    line = startLineAt(
      inputs.tracks.map((track) => track.extras),
      gunTimeMs,
      timeMs,
    );
  }
  if (line) {
    return {
      gunTimeMs,
      pin: toReplayRenderPosition(inputs.origin, line.pin),
      boat: toReplayRenderPosition(inputs.origin, line.boat),
      provenance: "vkx-line-pings",
    };
  }

  const analyzed = inputs.raceStructure?.startLine;
  if (
    !analyzed ||
    !inputs.raceStructure ||
    !analyzedStartVisible(inputs.raceStructure, timeMs)
  ) {
    return null;
  }
  return {
    gunTimeMs: gunTimeMs ?? inputs.raceStructure.start.timeMs,
    pin: toReplayRenderPosition(inputs.origin, analyzed.pin),
    boat: toReplayRenderPosition(inputs.origin, analyzed.boat),
    provenance: analyzed.source,
  };
}

function resolveMarks(
  raceStructure: RaceStructure | null,
  origin: ReplayRenderOrigin,
): ReplayRenderMark[] {
  const marks: ReplayRenderMark[] = [];
  for (const leg of raceStructure?.legs ?? []) {
    if (
      !leg.mark ||
      !Number.isFinite(leg.mark.lat) ||
      !Number.isFinite(leg.mark.lon)
    ) {
      continue;
    }
    marks.push({
      id: `leg-${leg.index}-mark`,
      legIndex: leg.index,
      legType: leg.type,
      position: toReplayRenderPosition(origin, leg.mark),
      provenance: leg.markOverridden
        ? "organizer-override"
        : "analysis-derived",
    });
  }
  return marks;
}

/**
 * Build one immutable-by-convention, renderer-neutral replay snapshot.
 * Presentation synthesis is derived only into tagged presentation fields and
 * never feeds position, recorded values, timing, selection, or analytics.
 */
export function buildReplayRenderFrame(
  inputs: ReplayRenderFrameInputs,
  playback: ReplayRenderPlaybackState,
  options: BuildReplayRenderFrameOptions = {},
): ReplayRenderFrame {
  const wind = resolvedWind(inputs.windAt, playback.timeMs);
  return {
    version: 1,
    sequence: options.sequence ?? 0,
    timeMs: playback.timeMs,
    playing: playback.playing,
    updateKind: options.updateKind ?? "initial",
    origin: { ...inputs.origin },
    wind,
    boats: inputs.tracks.map((track) =>
      buildBoat(
        track,
        inputs.origin,
        playback.timeMs,
        playback.selectedEntryId,
        wind,
      ),
    ),
    course: {
      startLine: resolveCourseStartLine(inputs, playback.timeMs),
      marks: resolveMarks(inputs.raceStructure, inputs.origin),
    },
  };
}

export const createReplayRenderFrame = buildReplayRenderFrame;
