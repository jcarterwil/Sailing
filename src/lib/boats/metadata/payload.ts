import {
  CATALOG_BOUNDS,
  CONDITION_SOURCE_KINDS,
  SAIL_TYPES,
  SESSION_METADATA_PAYLOAD_VERSION,
  type ConditionSourceKind,
  type SailType,
  type SessionMetadataPayloadV1,
  type SnapshotConditionSourceV1,
  type SnapshotConditionsV1,
  type SnapshotCrewMemberV1,
  type SnapshotSailV1,
  type SnapshotSessionTagV1,
  type SnapshotSetupV1,
} from "@/lib/boats/metadata/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimBounded(
  value: unknown,
  max: number,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function optionalUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed,
    )
  ) {
    return null;
  }
  return trimmed.toLowerCase();
}

function normalizeSailType(value: unknown): SailType | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return (SAIL_TYPES as readonly string[]).includes(trimmed)
    ? (trimmed as SailType)
    : null;
}

function normalizeSourceKind(value: unknown): ConditionSourceKind | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return (CONDITION_SOURCE_KINDS as readonly string[]).includes(trimmed)
    ? (trimmed as ConditionSourceKind)
    : null;
}

function normalizeSetupFields(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (Object.keys(out).length >= CATALOG_BOUNDS.maxSetupFields) break;
    const key = trimBounded(rawKey, CATALOG_BOUNDS.setupFieldKey);
    const fieldValue = trimBounded(rawValue, CATALOG_BOUNDS.setupFieldValue);
    if (!key || fieldValue === null) continue;
    out[key] = fieldValue;
  }
  return out;
}

function normalizeCrew(input: unknown): SnapshotCrewMemberV1[] {
  if (!Array.isArray(input)) return [];
  const out: SnapshotCrewMemberV1[] = [];
  for (const row of input) {
    if (out.length >= CATALOG_BOUNDS.maxCrew) break;
    if (!isRecord(row)) continue;
    const displayName = trimBounded(row.displayName, CATALOG_BOUNDS.displayName);
    if (!displayName) continue;
    const role =
      trimBounded(row.role, CATALOG_BOUNDS.defaultRole) ?? "";
    out.push({
      personId: optionalUuid(row.personId),
      displayName,
      role,
    });
  }
  return out;
}

function normalizeSails(input: unknown): SnapshotSailV1[] {
  if (!Array.isArray(input)) return [];
  const out: SnapshotSailV1[] = [];
  for (const row of input) {
    if (out.length >= CATALOG_BOUNDS.maxSails) break;
    if (!isRecord(row)) continue;
    const label = trimBounded(row.label, CATALOG_BOUNDS.sailLabel);
    if (!label) continue;
    out.push({
      sailId: optionalUuid(row.sailId),
      label,
      sailType: normalizeSailType(row.sailType),
    });
  }
  return out;
}

function normalizeSetup(input: unknown): SnapshotSetupV1 {
  if (!isRecord(input)) {
    return { setupId: null, name: null, notes: null, fields: {} };
  }
  return {
    setupId: optionalUuid(input.setupId),
    name: trimBounded(input.name, CATALOG_BOUNDS.setupName),
    notes: trimBounded(input.notes, CATALOG_BOUNDS.notes),
    fields: normalizeSetupFields(input.fields),
  };
}

function normalizeSessionTags(input: unknown): SnapshotSessionTagV1[] {
  if (!Array.isArray(input)) return [];
  const out: SnapshotSessionTagV1[] = [];
  const seen = new Set<string>();
  for (const row of input) {
    if (out.length >= CATALOG_BOUNDS.maxSessionTags) break;
    if (!isRecord(row)) continue;
    const label = trimBounded(row.label, CATALOG_BOUNDS.tagLabel);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      tagDefId: optionalUuid(row.tagDefId),
      label,
    });
  }
  return out;
}

function normalizeConditionSource(
  input: unknown,
): SnapshotConditionSourceV1 | null {
  if (!isRecord(input)) return null;
  const kind = normalizeSourceKind(input.kind);
  if (!kind) return null;
  return {
    kind,
    detail: trimBounded(input.detail, CATALOG_BOUNDS.sourceDetail),
  };
}

function normalizeConditions(input: unknown): SnapshotConditionsV1 {
  if (!isRecord(input)) {
    return {
      seaState: null,
      currentNotes: null,
      notes: null,
      source: null,
    };
  }
  return {
    seaState: trimBounded(input.seaState, CATALOG_BOUNDS.conditionText),
    currentNotes: trimBounded(input.currentNotes, CATALOG_BOUNDS.conditionText),
    notes: trimBounded(input.notes, CATALOG_BOUNDS.notes),
    source: normalizeConditionSource(input.source),
  };
}

/**
 * Normalize unknown JSON into a valid v1 snapshot payload.
 * Returns null when the top-level shape is not a v1 object.
 */
export function normalizeSessionMetadataPayload(
  input: unknown,
): SessionMetadataPayloadV1 | null {
  if (!isRecord(input)) return null;
  const version = input.v;
  if (version !== SESSION_METADATA_PAYLOAD_VERSION && version !== "1") {
    return null;
  }
  return {
    v: SESSION_METADATA_PAYLOAD_VERSION,
    crew: normalizeCrew(input.crew),
    sails: normalizeSails(input.sails),
    setup: normalizeSetup(input.setup),
    sessionTags: normalizeSessionTags(input.sessionTags),
    boatClass: trimBounded(input.boatClass, CATALOG_BOUNDS.displayName),
    conditions: normalizeConditions(input.conditions),
  };
}

/** Strict parse used before RPC write. */
export function parseSessionMetadataPayload(
  input: unknown,
): SessionMetadataPayloadV1 {
  const normalized = normalizeSessionMetadataPayload(input);
  if (!normalized) {
    throw new Error("Snapshot payload must be a v=1 object");
  }
  return normalized;
}

export function emptySessionMetadataPayload(
  boatClass: string | null = null,
): SessionMetadataPayloadV1 {
  return {
    v: SESSION_METADATA_PAYLOAD_VERSION,
    crew: [],
    sails: [],
    setup: { setupId: null, name: null, notes: null, fields: {} },
    sessionTags: [],
    boatClass: trimBounded(boatClass, CATALOG_BOUNDS.displayName),
    conditions: {
      seaState: null,
      currentNotes: null,
      notes: null,
      source: null,
    },
  };
}
