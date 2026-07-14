import type { PerformanceTimezoneV1 } from "@/lib/analytics/performance/types";
import type { Json } from "@/lib/supabase/database.types";
import {
  normalizeWeatherHourlySamples,
  type WeatherEvidence,
} from "@/lib/weather/open-meteo";

/** One crew member on a race entry. */
export interface CrewMember {
  name: string;
  role: string;
}

/** Race-day conditions attached to a race. */
export interface RaceConditionsSource {
  evidence: WeatherEvidence;
  ai: { provider: "anthropic"; model: string; generatedAt: string } | null;
  seaStateBasis: string;
}

export interface RaceConditions {
  windMinKts: number | null;
  windMaxKts: number | null;
  windDirDeg: number | null;
  seaState: string | null;
  notes: string | null;
  source?: RaceConditionsSource | null;
}

export interface EntryMeta {
  crew: CrewMember[];
  tags: string[];
}

export interface RaceMeta {
  conditions: RaceConditions | null;
  tags: string[];
  timezone: PerformanceTimezoneV1;
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

export function isValidIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timezone = value.trim();
  if (!timezone || timezone.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeIanaTimezone(value: unknown): string | null {
  return isValidIanaTimezone(value) ? value.trim() : null;
}

export function resolvePerformanceTimezone(
  raceTimezone: unknown,
  conditions: RaceConditions | null,
): PerformanceTimezoneV1 {
  const explicit = normalizeIanaTimezone(raceTimezone);
  if (explicit) return { iana: explicit, source: "race" };
  const weatherTimezone = normalizeIanaTimezone(conditions?.source?.evidence.location?.timezone);
  if (weatherTimezone) return { iana: weatherTimezone, source: "weather-location" };
  return { iana: "UTC", source: "utc-fallback" };
}

function normalizeConditionsSource(value: unknown): RaceConditionsSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const evidence = record.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const weather = evidence as Record<string, unknown>;
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(String(weather.sourceUrl ?? ""));
  } catch {
    return null;
  }
  const allowedWeatherHosts = new Set([
    "api.open-meteo.com",
    "historical-forecast-api.open-meteo.com",
    "archive-api.open-meteo.com",
  ]);
  const marineSourceValue = weather.marineSourceUrl;
  let marineSourceUrl: URL | null = null;
  if (marineSourceValue !== null && marineSourceValue !== undefined) {
    try {
      marineSourceUrl = new URL(String(marineSourceValue));
    } catch {
      return null;
    }
    if (
      marineSourceUrl.protocol !== "https:" ||
      marineSourceUrl.hostname !== "marine-api.open-meteo.com" ||
      marineSourceUrl.username !== "" ||
      marineSourceUrl.password !== "" ||
      marineSourceUrl.toString().length > 4_000
    ) {
      return null;
    }
  }
  if (
    weather.provider !== "open-meteo" ||
    sourceUrl.protocol !== "https:" ||
    sourceUrl.username !== "" ||
    sourceUrl.password !== "" ||
    sourceUrl.toString().length > 4_000 ||
    !allowedWeatherHosts.has(sourceUrl.hostname) ||
    typeof weather.windMinKts !== "number" ||
    !Number.isFinite(weather.windMinKts) ||
    typeof weather.windMaxKts !== "number" ||
    !Number.isFinite(weather.windMaxKts) ||
    typeof weather.windDirectionDeg !== "number" ||
    !Number.isFinite(weather.windDirectionDeg)
  ) {
    return null;
  }
  const hourlyValue = weather.hourly;
  const hourly = hourlyValue === undefined
    ? undefined
    : normalizeWeatherHourlySamples(hourlyValue);
  if (hourlyValue !== undefined && hourly === null) return null;
  const averageWindKts = weather.averageWindKts === undefined
    ? undefined
    : (() => {
        const value = optionalNumber(weather.averageWindKts);
        return value !== null && value >= 0 ? value : null;
      })();
  const conditionCode = weather.conditionCode === undefined || weather.conditionCode === null
    ? weather.conditionCode as undefined | null
    : typeof weather.conditionCode === "number" &&
        Number.isInteger(weather.conditionCode) &&
        weather.conditionCode >= 0 &&
        weather.conditionCode <= 99
      ? weather.conditionCode
      : null;
  const locationValue = weather.location;
  const location = locationValue && typeof locationValue === "object" && !Array.isArray(locationValue)
    ? {
        name: String((locationValue as Record<string, unknown>).name ?? "").trim().slice(0, 180),
        country: String((locationValue as Record<string, unknown>).country ?? "").trim().slice(0, 120) || null,
        admin1: String((locationValue as Record<string, unknown>).admin1 ?? "").trim().slice(0, 120) || null,
        latitude: optionalNumber((locationValue as Record<string, unknown>).latitude),
        longitude: optionalNumber((locationValue as Record<string, unknown>).longitude),
        timezone: normalizeIanaTimezone((locationValue as Record<string, unknown>).timezone),
      }
    : undefined;
  const normalizedEvidence: Record<string, unknown> = {
    provider: "open-meteo",
    sourceUrl: sourceUrl.toString(),
    marineSourceUrl: marineSourceUrl?.toString() ?? null,
    windMinKts: weather.windMinKts,
    windMaxKts: weather.windMaxKts,
    windDirectionDeg: weather.windDirectionDeg,
  };
  if (
    weather.dataset === "forecast" ||
    weather.dataset === "historical-forecast" ||
    weather.dataset === "historical-weather"
  ) normalizedEvidence.dataset = weather.dataset;
  if (location) normalizedEvidence.location = location;
  for (const key of ["windowStart", "windowEnd", "fetchedAt"] as const) {
    if (typeof weather[key] === "string" && Number.isFinite(Date.parse(weather[key]))) {
      normalizedEvidence[key] = new Date(weather[key]).toISOString();
    }
  }
  const sampleCount = optionalNumber(weather.sampleCount);
  if (sampleCount !== null) {
    normalizedEvidence.sampleCount = Math.min(26, Math.max(0, Math.round(sampleCount)));
  }
  for (const key of [
    "gustMaxKts",
    "temperatureMinC",
    "temperatureMaxC",
    "precipitationMm",
    "cloudCoverPct",
    "pressureMslHpa",
    "waveHeightMinM",
    "waveHeightMaxM",
    "wavePeriodS",
    "waveDirectionDeg",
  ] as const) {
    normalizedEvidence[key] = optionalNumber(weather[key]);
  }
  if (Array.isArray(weather.weatherCodes)) {
    normalizedEvidence.weatherCodes = [...new Set(weather.weatherCodes.flatMap((code): number[] =>
      typeof code === "number" && Number.isInteger(code) && code >= 0 && code <= 99
        ? [code]
        : []))].slice(0, 26);
  }
  if (hourly !== undefined) normalizedEvidence.hourly = hourly;
  if (averageWindKts !== undefined) normalizedEvidence.averageWindKts = averageWindKts;
  if (conditionCode !== undefined) normalizedEvidence.conditionCode = conditionCode;
  const aiValue = record.ai;
  const ai =
    aiValue &&
    typeof aiValue === "object" &&
    !Array.isArray(aiValue) &&
    (aiValue as Record<string, unknown>).provider === "anthropic" &&
    typeof (aiValue as Record<string, unknown>).model === "string" &&
    (aiValue as Record<string, unknown>).model !== "" &&
    String((aiValue as Record<string, unknown>).model).length <= 120 &&
    typeof (aiValue as Record<string, unknown>).generatedAt === "string" &&
    Number.isFinite(Date.parse(String((aiValue as Record<string, unknown>).generatedAt)))
      ? (aiValue as RaceConditionsSource["ai"])
      : null;
  const seaStateBasis = String(record.seaStateBasis ?? "").trim().slice(0, 300);
  return {
    evidence: normalizedEvidence as unknown as WeatherEvidence,
    ai,
    seaStateBasis,
  };
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
    source: normalizeConditionsSource(record.source),
  };
  if (conditions.source) {
    const evidence = conditions.source.evidence;
    const provenanceMatches =
      conditions.windMinKts !== null &&
      conditions.windMaxKts !== null &&
      conditions.windDirDeg !== null &&
      Math.abs(conditions.windMinKts - evidence.windMinKts) < 1e-9 &&
      Math.abs(conditions.windMaxKts - evidence.windMaxKts) < 1e-9 &&
      Math.abs((((conditions.windDirDeg - evidence.windDirectionDeg) % 360) + 540) % 360 - 180) <
        1e-9;
    if (!provenanceMatches) conditions.source = null;
  }
  const empty =
    conditions.windMinKts === null &&
    conditions.windMaxKts === null &&
    conditions.windDirDeg === null &&
    !conditions.seaState &&
    !conditions.notes &&
    !conditions.source;
  return empty ? null : conditions;
}

export function parseEntryMeta(crew: Json | null, tags: string[] | null): EntryMeta {
  return {
    crew: normalizeCrew(crew),
    tags: normalizeTags(tags),
  };
}

export function parseRaceMeta(
  conditions: Json | null,
  tags: string[] | null,
  timezone: string | null = null,
): RaceMeta {
  const normalizedConditions = normalizeConditions(conditions);
  return {
    conditions: normalizedConditions,
    tags: normalizeTags(tags),
    timezone: resolvePerformanceTimezone(timezone, normalizedConditions),
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
    source: conditions.source ? (conditions.source as unknown as Json) : null,
  };
}

export function buildRaceAnalyzeContext(
  race: RaceMeta,
  entries: RaceAnalyzeContext["entries"],
): RaceAnalyzeContext {
  return { race, entries };
}
