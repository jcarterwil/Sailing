/**
 * Legacy race_entries.crew/tags (+ race conditions) → Session metadata snapshot
 * payload for Boat Performance History V1 acceptance (#176).
 *
 * Pure helpers only — the CLI script owns service-role IO.
 */

import {
  normalizeTags,
  type CrewMember,
  type RaceConditions,
} from "@/lib/races/meta";
import {
  emptySessionMetadataPayload,
  parseSessionMetadataPayload,
} from "@/lib/boats/metadata/payload";
import type { SessionMetadataPayloadV1 } from "@/lib/boats/metadata/types";

export type LegacyEntryMetaBackfillInput = {
  crew: CrewMember[];
  entryTags: string[];
  raceTags?: string[];
  boatClass?: string | null;
  conditions?: RaceConditions | null;
};

function conditionSourceFromLegacy(
  conditions: RaceConditions | null | undefined,
): SessionMetadataPayloadV1["conditions"]["source"] {
  if (!conditions?.source) return null;
  if (conditions.source.evidence) {
    return {
      kind: "weather",
      detail: conditions.source.seaStateBasis || "open-meteo",
    };
  }
  return { kind: "manual", detail: conditions.source.seaStateBasis || null };
}

/**
 * Build a v1 snapshot payload from legacy Session entry/race meta.
 * Free-text crew/tags are frozen without catalog IDs (personId/tagDefId null).
 * Sails/setup are empty — legacy columns never stored them.
 */
export function legacyEntryMetaToSnapshotPayload(
  input: LegacyEntryMetaBackfillInput,
): SessionMetadataPayloadV1 {
  const base = emptySessionMetadataPayload(input.boatClass ?? null);
  const crew = input.crew
    .map((member) => ({
      personId: null as string | null,
      displayName: member.name,
      role: member.role,
    }))
    .filter((member) => member.displayName.trim().length > 0);

  const sessionTags = normalizeTags([
    ...(input.entryTags ?? []),
    ...(input.raceTags ?? []),
  ]).map((label) => ({
    tagDefId: null as string | null,
    label,
  }));

  const conditions = input.conditions
    ? {
        seaState: input.conditions.seaState,
        currentNotes: null,
        notes: input.conditions.notes,
        source: conditionSourceFromLegacy(input.conditions),
      }
    : base.conditions;

  return parseSessionMetadataPayload({
    ...base,
    crew,
    sessionTags,
    conditions,
  });
}

/** True when legacy meta has fields that map into the v1 snapshot payload. */
export function legacyEntryMetaHasContent(
  input: LegacyEntryMetaBackfillInput,
): boolean {
  if (input.crew.some((member) => member.name.trim())) return true;
  if (normalizeTags(input.entryTags).length > 0) return true;
  if (normalizeTags(input.raceTags ?? []).length > 0) return true;
  if (input.boatClass?.trim()) return true;
  const conditions = input.conditions;
  if (!conditions) return false;
  // Snapshot conditions only freeze sea/current/notes + provenance — not wind numbers.
  return Boolean(conditions.seaState || conditions.notes || conditions.source);
}

/**
 * Decide whether an entry should receive a backfill snapshot revision.
 * Existing snapshots are never rewritten (catalog/history immutability).
 */
export function shouldBackfillLegacyEntryMeta(options: {
  hasExistingSnapshot: boolean;
  input: LegacyEntryMetaBackfillInput;
}): boolean {
  if (options.hasExistingSnapshot) return false;
  return legacyEntryMetaHasContent(options.input);
}
