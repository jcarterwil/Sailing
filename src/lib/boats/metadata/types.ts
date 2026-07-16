/**
 * Boat Performance History V1 — metadata catalog + Session snapshot contracts.
 * Snapshots freeze denormalized labels so later catalog edits cannot rewrite history.
 */

export const SESSION_METADATA_PAYLOAD_VERSION = 1 as const;

export const SAIL_TYPES = [
  "main",
  "jib",
  "genoa",
  "spinnaker",
  "code",
  "staysail",
  "other",
] as const;

export type SailType = (typeof SAIL_TYPES)[number];

export const CONDITION_SOURCE_KINDS = [
  "manual",
  "weather",
  "import",
  "unknown",
] as const;

export type ConditionSourceKind = (typeof CONDITION_SOURCE_KINDS)[number];

export interface SnapshotCrewMemberV1 {
  personId: string | null;
  displayName: string;
  role: string;
}

export interface SnapshotSailV1 {
  sailId: string | null;
  label: string;
  sailType: SailType | null;
}

export interface SnapshotSetupV1 {
  setupId: string | null;
  name: string | null;
  notes: string | null;
  fields: Record<string, string>;
}

export interface SnapshotSessionTagV1 {
  tagDefId: string | null;
  label: string;
}

export interface SnapshotConditionSourceV1 {
  kind: ConditionSourceKind;
  detail: string | null;
}

export interface SnapshotConditionsV1 {
  seaState: string | null;
  currentNotes: string | null;
  notes: string | null;
  source: SnapshotConditionSourceV1 | null;
}

/** Frozen Session metadata payload persisted in session_metadata_snapshots.payload */
export interface SessionMetadataPayloadV1 {
  v: typeof SESSION_METADATA_PAYLOAD_VERSION;
  crew: SnapshotCrewMemberV1[];
  sails: SnapshotSailV1[];
  setup: SnapshotSetupV1;
  sessionTags: SnapshotSessionTagV1[];
  boatClass: string | null;
  conditions: SnapshotConditionsV1;
}

export const CATALOG_BOUNDS = {
  displayName: 80,
  defaultRole: 40,
  sailLabel: 80,
  setupName: 80,
  tagLabel: 40,
  notes: 500,
  setupFieldKey: 40,
  setupFieldValue: 120,
  maxCrew: 20,
  maxSails: 12,
  maxSessionTags: 20,
  maxSetupFields: 40,
  conditionText: 200,
  sourceDetail: 200,
} as const;
