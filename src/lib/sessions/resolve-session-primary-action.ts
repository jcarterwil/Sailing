import type { SessionType } from "@/lib/sessions/types";

export type SessionPrimaryActionKind =
  | "add-data"
  | "processing"
  | "fix-data"
  | "review-analyze"
  | "open-report"
  | "open-replay";

export interface SessionPrimaryAction {
  kind: SessionPrimaryActionKind;
  label: string;
  /** Null when the action is status-only (e.g. Processing…). */
  href: string | null;
  disabled: boolean;
}

export interface ResolveSessionPrimaryActionInput {
  raceId: string;
  sessionType: SessionType;
  /** Caller may upload / attach track data. */
  canUpload: boolean;
  /** Caller may fix validation issues and run review/analyze. */
  canEdit: boolean;
  /** At least one entry has a track row. */
  hasAnyTrack: boolean;
  /** At least one entry is still missing a track. */
  hasMissingTrack: boolean;
  /** Any track is uploaded or still processing. */
  hasProcessingTrack: boolean;
  /** Any track failed processing/validation. */
  hasErrorTrack: boolean;
  /** Every entry has a processed track (analyzer-ready). */
  allTracksProcessed: boolean;
  /** Saved analysis is present and fresh for the current entry set. */
  analysisCurrent: boolean;
  /** At least one processed track with a loadable processed_path. */
  replayAvailable: boolean;
}

export interface SessionTrackSummaryInput {
  status?: string | null;
  /** Required for replayAvailable — status alone is not enough. */
  processedPath?: string | null;
}

function dataHref(raceId: string) {
  return `/races/${raceId}?tab=data`;
}

/**
 * Pure, permission-aware next action for Session workspace surfaces.
 * Components must not reimplement this precedence.
 */
export function resolveSessionPrimaryAction(
  input: ResolveSessionPrimaryActionInput,
): SessionPrimaryAction | null {
  const { raceId, sessionType } = input;
  const reviewHref =
    sessionType === "race" ? `/races/${raceId}/review` : dataHref(raceId);

  if ((!input.hasAnyTrack || input.hasMissingTrack) && input.canUpload) {
    return {
      kind: "add-data",
      label: "Add data",
      href: dataHref(raceId),
      disabled: false,
    };
  }

  if (input.hasProcessingTrack) {
    return {
      kind: "processing",
      label: "Processing…",
      href: null,
      disabled: true,
    };
  }

  if (input.hasErrorTrack && (input.canEdit || input.canUpload)) {
    return {
      kind: "fix-data",
      label: "Fix data issue",
      href: dataHref(raceId),
      disabled: false,
    };
  }

  if (
    !input.analysisCurrent &&
    input.canEdit &&
    input.hasAnyTrack &&
    input.allTracksProcessed
  ) {
    return {
      kind: "review-analyze",
      label: "Review & analyze",
      href: reviewHref,
      disabled: false,
    };
  }

  if (input.analysisCurrent && input.replayAvailable) {
    // Race Sessions land on the deterministic #66 report; Practice has no
    // race-relative report, so Replay remains the ready-state CTA.
    if (sessionType === "practice") {
      return {
        kind: "open-replay",
        label: "Open replay",
        href: `/races/${raceId}/replay`,
        disabled: false,
      };
    }
    return {
      kind: "open-report",
      label: "Open report",
      href: `/races/${raceId}/performance`,
      disabled: false,
    };
  }

  return null;
}

/** Derive resolver flags from per-entry track rows. */
export function summarizeSessionTrackStatuses(
  tracks: readonly (SessionTrackSummaryInput | string | null | undefined)[],
): Pick<
  ResolveSessionPrimaryActionInput,
  | "hasAnyTrack"
  | "hasMissingTrack"
  | "hasProcessingTrack"
  | "hasErrorTrack"
  | "allTracksProcessed"
  | "replayAvailable"
> {
  let hasAnyTrack = false;
  let hasMissingTrack = false;
  let hasProcessingTrack = false;
  let hasErrorTrack = false;
  let replayAvailable = false;
  let processedCount = 0;

  if (tracks.length === 0) {
    return {
      hasAnyTrack: false,
      hasMissingTrack: false,
      hasProcessingTrack: false,
      hasErrorTrack: false,
      allTracksProcessed: false,
      replayAvailable: false,
    };
  }

  for (const track of tracks) {
    const status = typeof track === "string" || track == null ? track : track.status;
    const processedPath =
      typeof track === "object" && track ? track.processedPath : null;
    if (!status) {
      hasMissingTrack = true;
      continue;
    }
    hasAnyTrack = true;
    if (status === "uploaded" || status === "processing") {
      hasProcessingTrack = true;
    }
    if (status === "error") {
      hasErrorTrack = true;
    }
    if (status === "processed") {
      processedCount += 1;
      if (typeof processedPath === "string" && processedPath.length > 0) {
        replayAvailable = true;
      }
    }
  }

  return {
    hasAnyTrack,
    hasMissingTrack,
    hasProcessingTrack,
    hasErrorTrack,
    allTracksProcessed: processedCount === tracks.length && processedCount > 0,
    replayAvailable,
  };
}
