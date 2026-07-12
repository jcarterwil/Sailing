import type { Json } from "@/lib/supabase/database.types";

/** One crew member on a race entry. */
export interface CrewMember {
  name: string;
  role: string;
}

/** Race-day conditions attached to a race. */
export interface RaceConditions {
  windMinKts: number | null;
  windMaxKts: number | null;
  windDirDeg: number | null;
  seaState: string | null;
  notes: string | null;
}

export interface EntryMeta {
  crew: CrewMember[];
  tags: string[];
}

export interface RaceMeta {
  conditions: RaceConditions | null;
  tags: string[];
}

/**
 * Shape carried into analyze / dossier payloads so future stats can group by
 * crew, sail tags, and conditions. No correlation logic here — just threading.
 */
export interface RaceAnalyzeContext {
  race: RaceMeta;
  entries: Array<{
    entryId: string;
    boatName: string;
    color: string;
    crew: CrewMember[];
    tags: string[];
  }>;
}

export function normalizeCrew(input: unknown): CrewMember[] {
  if (!Array.isArray(input)) return [];
  const out: CrewMember[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const name = String(record.name ?? "").trim();
    if (!name) continue;
    out.push({ name, role: String(record.role ?? "").trim() });
  }
  return out;
}

export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const tag = String(raw ?? "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeConditions(input: unknown): RaceConditions | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const conditions: RaceConditions = {
    windMinKts: optionalNumber(record.windMinKts),
    windMaxKts: optionalNumber(record.windMaxKts),
    windDirDeg: optionalNumber(record.windDirDeg),
    seaState: String(record.seaState ?? "").trim() || null,
    notes: String(record.notes ?? "").trim() || null,
  };
  const empty =
    conditions.windMinKts === null &&
    conditions.windMaxKts === null &&
    conditions.windDirDeg === null &&
    !conditions.seaState &&
    !conditions.notes;
  return empty ? null : conditions;
}

export function parseEntryMeta(crew: Json | null, tags: string[] | null): EntryMeta {
  return {
    crew: normalizeCrew(crew),
    tags: normalizeTags(tags),
  };
}

export function parseRaceMeta(conditions: Json | null, tags: string[] | null): RaceMeta {
  return {
    conditions: normalizeConditions(conditions),
    tags: normalizeTags(tags),
  };
}

export function crewToJson(crew: CrewMember[]): Json {
  return crew.map((c) => ({ name: c.name, role: c.role }));
}

export function conditionsToJson(conditions: RaceConditions | null): Json | null {
  if (!conditions) return null;
  return {
    windMinKts: conditions.windMinKts,
    windMaxKts: conditions.windMaxKts,
    windDirDeg: conditions.windDirDeg,
    seaState: conditions.seaState,
    notes: conditions.notes,
  };
}

export function buildRaceAnalyzeContext(
  race: RaceMeta,
  entries: RaceAnalyzeContext["entries"],
): RaceAnalyzeContext {
  return { race, entries };
}
