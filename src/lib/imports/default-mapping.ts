import type {
  HistoricalImportInspection,
  HistoricalImportMapping,
} from "@/lib/imports/types";

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Best-effort mapping from inspection — user must still review before commit. */
export function suggestDefaultMapping(
  inspection: HistoricalImportInspection,
  preferredTimezone?: string | null,
): HistoricalImportMapping {
  const eligible = inspection.candidates.find(
    (candidate) => candidate.eligible && !candidate.hasTrack,
  );
  if (eligible) {
    return {
      target: "existing",
      existingSessionId: eligible.sessionId,
      importAnyway: inspection.duplicate.kind === "probable",
    };
  }

  const timezone =
    (preferredTimezone && preferredTimezone.trim()) ||
    inspection.candidates[0]?.timezone ||
    browserTimezone();

  return {
    target: "new",
    sessionType: inspection.proposedSessionType.sessionType,
    startsAt: inspection.startedAt,
    timezone,
    venue: null,
    name: null,
    importAnyway: inspection.duplicate.kind === "probable",
  };
}
