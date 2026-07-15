import { isValidIanaTimezone, normalizeIanaTimezone } from "@/lib/races/meta";
import { isSessionType } from "@/lib/sessions/types";
import type { HistoricalImportInspection, HistoricalImportMapping } from "@/lib/imports/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseHistoricalImportMapping(
  value: unknown,
): { ok: true; mapping: HistoricalImportMapping } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Mapping must be an object." };
  }
  const record = value as Record<string, unknown>;
  const importAnyway = record.importAnyway === true;

  if (record.target === "existing") {
    const existingSessionId = String(record.existingSessionId ?? "").trim();
    if (!UUID_PATTERN.test(existingSessionId)) {
      return { ok: false, error: "existingSessionId must be a valid session id." };
    }
    return {
      ok: true,
      mapping: { target: "existing", existingSessionId, importAnyway },
    };
  }

  if (record.target === "new") {
    if (!isSessionType(record.sessionType)) {
      return { ok: false, error: "sessionType must be race or practice." };
    }
    const startsAt = String(record.startsAt ?? "").trim();
    if (!Number.isFinite(Date.parse(startsAt))) {
      return { ok: false, error: "startsAt must be an ISO timestamp." };
    }
    if (!isValidIanaTimezone(record.timezone)) {
      return { ok: false, error: "timezone must be a valid IANA identifier." };
    }
    const timezone = normalizeIanaTimezone(record.timezone);
    if (!timezone) {
      return { ok: false, error: "timezone must be a valid IANA identifier." };
    }
    const venueRaw = record.venue;
    const venue =
      venueRaw === null || venueRaw === undefined || venueRaw === ""
        ? null
        : String(venueRaw).trim().slice(0, 200) || null;
    const nameRaw = record.name;
    const name =
      nameRaw === null || nameRaw === undefined || nameRaw === ""
        ? null
        : String(nameRaw).trim().slice(0, 200) || null;
    return {
      ok: true,
      mapping: {
        target: "new",
        sessionType: record.sessionType,
        startsAt: new Date(startsAt).toISOString(),
        timezone,
        venue,
        name,
        importAnyway,
      },
    };
  }

  return { ok: false, error: "target must be new or existing." };
}

export function mappingAllowsCommit(
  mapping: HistoricalImportMapping,
  inspection: HistoricalImportInspection | null,
): { ok: true } | { ok: false; error: string } {
  if (!inspection) return { ok: false, error: "Inspect the file before committing." };
  if (inspection.duplicate.kind === "exact") {
    return { ok: false, error: "Exact duplicates cannot be committed." };
  }
  if (inspection.duplicate.kind === "probable" && !mapping.importAnyway) {
    return {
      ok: false,
      error: "Set importAnyway to acknowledge a probable duplicate.",
    };
  }
  if (mapping.target === "existing") {
    const candidate = inspection.candidates.find(
      (row) => row.sessionId === mapping.existingSessionId,
    );
    if (!candidate) {
      return { ok: false, error: "Choose an eligible existing session from inspection." };
    }
    if (!candidate.eligible || candidate.hasTrack) {
      return {
        ok: false,
        error: candidate.ineligibilityReason ?? "That session is not eligible.",
      };
    }
  }
  return { ok: true };
}
