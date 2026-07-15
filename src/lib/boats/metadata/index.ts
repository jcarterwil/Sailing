export {
  normalizeCrewPersonInput,
  normalizeSailInput,
  normalizeSessionTagDefInput,
  normalizeSetupInput,
} from "@/lib/boats/metadata/catalog";
export {
  emptySessionMetadataPayload,
  normalizeSessionMetadataPayload,
  parseSessionMetadataPayload,
} from "@/lib/boats/metadata/payload";
export {
  CATALOG_BOUNDS,
  CONDITION_SOURCE_KINDS,
  SAIL_TYPES,
  SESSION_METADATA_PAYLOAD_VERSION,
  type ConditionSourceKind,
  type SailType,
  type SessionMetadataPayloadV1,
  type SnapshotConditionsV1,
  type SnapshotCrewMemberV1,
  type SnapshotSailV1,
  type SnapshotSessionTagV1,
  type SnapshotSetupV1,
} from "@/lib/boats/metadata/types";
