import type { LatestSessionSnapshot } from "@/lib/boats/metadata/load-snapshots";
import type { CompactObservationRowV1 } from "@/lib/boats/performance-history/types";

export interface PerformanceMetadataFilters {
  /** Match snapshot crew by personId or exact displayName (case-insensitive). */
  crew?: string | null;
  /** Match snapshot sail by sailId or exact label (case-insensitive). */
  sail?: string | null;
  /** Match snapshot setup by setupId or exact name (case-insensitive). */
  setup?: string | null;
  /**
   * Substring match against snapshot condition fields (sea state, current notes,
   * notes). Empty / null means no condition filter.
   */
  condition?: string | null;
}

export function parsePerformanceMetadataFilters(
  searchParams: URLSearchParams | Record<string, string | undefined>,
): PerformanceMetadataFilters {
  const get = (key: string): string | null => {
    if (searchParams instanceof URLSearchParams) {
      return searchParams.get(key);
    }
    return searchParams[key] ?? null;
  };
  return {
    crew: emptyToNull(get("crew")),
    sail: emptyToNull(get("sail")),
    setup: emptyToNull(get("setup")),
    condition: emptyToNull(get("condition")),
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function matchesToken(
  token: string,
  id: string | null | undefined,
  label: string | null | undefined,
): boolean {
  const needle = token.trim().toLowerCase();
  if (!needle) return true;
  if (id && id.toLowerCase() === needle) return true;
  if (label && label.trim().toLowerCase() === needle) return true;
  return false;
}

function conditionBlob(snapshot: LatestSessionSnapshot): string {
  const c = snapshot.payload.conditions;
  return [c.seaState, c.currentNotes, c.notes]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .toLowerCase();
}

/**
 * Filter compact observation rows by latest Session metadata snapshots.
 * Rows without a snapshot are excluded when any metadata filter is active.
 */
export function filterObservationsByMetadata(
  rows: readonly CompactObservationRowV1[],
  snapshotsByEntryId: ReadonlyMap<string, LatestSessionSnapshot>,
  filters: PerformanceMetadataFilters,
): CompactObservationRowV1[] {
  const crew = emptyToNull(filters.crew);
  const sail = emptyToNull(filters.sail);
  const setup = emptyToNull(filters.setup);
  const condition = emptyToNull(filters.condition);
  const active = Boolean(crew || sail || setup || condition);
  if (!active) return [...rows];

  return rows.filter((row) => {
    const snap = snapshotsByEntryId.get(row.entryId);
    if (!snap) return false;

    if (crew) {
      const hit = snap.payload.crew.some((member) =>
        matchesToken(crew, member.personId, member.displayName),
      );
      if (!hit) return false;
    }

    if (sail) {
      const hit = snap.payload.sails.some((item) =>
        matchesToken(sail, item.sailId, item.label),
      );
      if (!hit) return false;
    }

    if (setup) {
      const hit = matchesToken(
        setup,
        snap.payload.setup.setupId,
        snap.payload.setup.name,
      );
      if (!hit) return false;
    }

    if (condition) {
      const blob = conditionBlob(snap);
      if (!blob.includes(condition.toLowerCase())) return false;
    }

    return true;
  });
}

export function hasActiveMetadataFilters(
  filters: PerformanceMetadataFilters,
): boolean {
  return Boolean(
    emptyToNull(filters.crew) ||
      emptyToNull(filters.sail) ||
      emptyToNull(filters.setup) ||
      emptyToNull(filters.condition),
  );
}
