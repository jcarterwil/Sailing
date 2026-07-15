/**
 * Pure helpers for admin boat-duplicate merge preview.
 * The merge_boats RPC re-checks every rule under row locks.
 */

export interface BoatMergeIdentity {
  id: string;
  name: string;
  sailNumber: string | null;
  boatClass: string | null;
  ownerId: string | null;
  ownerName: string | null;
  claimEmail: string | null;
  hasPendingInvitation: boolean;
  entryCount: number;
  membershipCount: number;
  mergedIntoId: string | null;
}

export type BoatMergeBlockerCode =
  | "self_merge"
  | "source_missing"
  | "target_missing"
  | "source_already_merged"
  | "target_already_merged"
  | "source_is_merge_destination"
  | "same_race_entries"
  | "same_series_competitors"
  | "conflicting_owners"
  | "source_pending_invitation"
  | "target_pending_invitation";

export interface BoatMergeBlocker {
  code: BoatMergeBlockerCode;
  message: string;
  raceIds?: string[];
  seriesIds?: string[];
}

export interface BoatMergePreviewInput {
  source: BoatMergeIdentity | null;
  target: BoatMergeIdentity | null;
  /** Race IDs that contain both source and target entries. */
  conflictingRaceIds: string[];
  /** Series IDs where both boats are competitors. */
  conflictingSeriesIds: string[];
  /** True when another boat already has merged_into_id = source.id. */
  sourceIsMergeDestination: boolean;
  /** Analyses/reports that will be invalidated for source-only races. */
  affectedRaceIds: string[];
  analysesToInvalidate: number;
  reportsToInvalidate: number;
}

export interface BoatMergePreview {
  canMerge: boolean;
  blockers: BoatMergeBlocker[];
  source: BoatMergeIdentity | null;
  target: BoatMergeIdentity | null;
  survivingIdentity: {
    name: string;
    sailNumber: string | null;
    boatClass: string | null;
    ownerId: string | null;
    ownerInherited: boolean;
  } | null;
  entriesMoved: number;
  membershipsConsidered: number;
  affectedRaceIds: string[];
  analysesToInvalidate: number;
  reportsToInvalidate: number;
}

export function evaluateBoatMergePreview(input: BoatMergePreviewInput): BoatMergePreview {
  const blockers: BoatMergeBlocker[] = [];
  const { source, target } = input;

  if (!source) {
    blockers.push({ code: "source_missing", message: "Source boat was not found." });
  }
  if (!target) {
    blockers.push({ code: "target_missing", message: "Target boat was not found." });
  }

  if (source && target && source.id === target.id) {
    blockers.push({
      code: "self_merge",
      message: "Cannot merge a boat into itself.",
    });
  }

  if (source?.mergedIntoId) {
    blockers.push({
      code: "source_already_merged",
      message: "Source boat is already merged into another boat.",
    });
  }
  if (target?.mergedIntoId) {
    blockers.push({
      code: "target_already_merged",
      message: "Target boat is already merged; choose an active canonical boat.",
    });
  }
  if (source && input.sourceIsMergeDestination) {
    blockers.push({
      code: "source_is_merge_destination",
      message: "Source boat is already a merge destination; resolve that chain first.",
    });
  }

  if (input.conflictingRaceIds.length > 0) {
    blockers.push({
      code: "same_race_entries",
      message:
        "Both boats have entries in the same race(s). Resolve those races before merging.",
      raceIds: [...input.conflictingRaceIds],
    });
  }
  if (input.conflictingSeriesIds.length > 0) {
    blockers.push({
      code: "same_series_competitors",
      message:
        "Both boats are competitors in the same series. Resolve those series before merging.",
      seriesIds: [...input.conflictingSeriesIds],
    });
  }

  if (
    source?.ownerId &&
    target?.ownerId &&
    source.ownerId !== target.ownerId
  ) {
    blockers.push({
      code: "conflicting_owners",
      message: "Boats have different owners; transfer or clear ownership before merging.",
    });
  }

  if (source?.hasPendingInvitation) {
    blockers.push({
      code: "source_pending_invitation",
      message: "Source boat has a pending owner invitation or transfer; revoke it before merging.",
    });
  }
  if (target?.hasPendingInvitation) {
    blockers.push({
      code: "target_pending_invitation",
      message: "Target boat has a pending owner invitation or transfer; revoke it before merging.",
    });
  }

  const ownerInherited = Boolean(
    source && target && !target.ownerId && source.ownerId,
  );

  const survivingIdentity =
    source && target
      ? {
          name: target.name,
          sailNumber: target.sailNumber,
          boatClass: target.boatClass,
          ownerId: ownerInherited ? source.ownerId : target.ownerId,
          ownerInherited,
        }
      : null;

  return {
    canMerge: blockers.length === 0 && Boolean(source && target),
    blockers,
    source,
    target,
    survivingIdentity,
    entriesMoved: source?.entryCount ?? 0,
    membershipsConsidered: source?.membershipCount ?? 0,
    affectedRaceIds: [...input.affectedRaceIds],
    analysesToInvalidate: input.analysesToInvalidate,
    reportsToInvalidate: input.reportsToInvalidate,
  };
}

/** Active boats omit tombstones (`merged_into_id is null`). */
export function isActiveBoatRow(row: { merged_into_id?: string | null }): boolean {
  return row.merged_into_id == null;
}
