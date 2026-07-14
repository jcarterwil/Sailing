export type WeatherDataset = "forecast" | "historical-forecast" | "historical-weather";

export interface WeatherLocation {
  name: string;
  country: string | null;
  admin1: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
}

export interface WeatherHourlySample {
  time: string;
  windSpeedKts: number | null;
  windDirectionDeg: number | null;
  gustKts: number | null;
  temperatureC: number | null;
  weatherCode: number | null;
}

export interface WeatherEvidence {
  provider: "open-meteo";
  dataset: WeatherDataset;
  sourceUrl: string;
  marineSourceUrl: string | null;
  location: WeatherLocation;
  windowStart: string;
  windowEnd: string;
  fetchedAt: string;
  sampleCount: number;
  windMinKts: number;
  windMaxKts: number;
  windDirectionDeg: number;
  gustMaxKts: number | null;
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
  precipitationMm: number | null;
  cloudCoverPct: number | null;
  pressureMslHpa: number | null;
  weatherCodes: number[];
  waveHeightMinM: number | null;
  waveHeightMaxM: number | null;
  wavePeriodS: number | null;
  waveDirectionDeg: number | null;
  /** Added in #84. Optional so persisted pre-#84 snapshots remain readable. */
  hourly?: WeatherHourlySample[];
  averageWindKts?: number | null;
  conditionCode?: number | null;
}

interface OpenMeteoGeocodingResponse {
  results?: Array<{
    name?: unknown;
    country?: unknown;
    admin1?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    timezone?: unknown;
  }>;
}

interface OpenMeteoHourlyResponse {
  hourly?: {
    time?: unknown;
    wind_speed_10m?: unknown;
    wind_direction_10m?: unknown;
    wind_gusts_10m?: unknown;
    temperature_2m?: unknown;
    precipitation?: unknown;
    cloud_cover?: unknown;
    pressure_msl?: unknown;
    weather_code?: unknown;
    wave_height?: unknown;
    wave_period?: unknown;
    wave_direction?: unknown;
  };
}

type Fetcher = typeof fetch;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const MAX_WEATHER_HOURLY_SAMPLES = 26;
export const ANALYZED_WIND_REPORT_LABEL = "Analyzed wind used for VMG";
export const WEATHER_CONTEXT_REPORT_LABEL = "Weather context (Open-Meteo)";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericArray(value: unknown): Array<number | null> {
  return Array.isArray(value) ? value.map(finiteNumber) : [];
}

function timeArray(value: unknown): Array<string | null> {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item : null)
    : [];
}

function parseApiTime(value: string | null): number {
  if (value === null) return Number.NaN;
  const hasZone = /(?:Z|[+-]\d\d:\d\d)$/i.test(value);
  return Date.parse(hasZone ? value : `${value}Z`);
}

function round(value: number, places = 1): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function circularMeanDeg(directions: number[], weights: number[]): number | null {
  if (directions.length === 0) return null;
  let x = 0;
  let y = 0;
  for (let index = 0; index < directions.length; index++) {
    const radians = (directions[index] * Math.PI) / 180;
    const weight = Math.max(weights[index] ?? 1, 0);
    x += Math.cos(radians) * weight;
    y += Math.sin(radians) * weight;
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null;
  const normalized = (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
  return normalized > 359.999999 ? 0 : normalized;
}

function nonNegativeNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function normalizedDirection(value: unknown): number | null {
  const number = finiteNumber(value);
  if (number === null) return null;
  return round(((number % 360) + 360) % 360);
}

function normalizedWeatherCode(value: unknown): number | null {
  const number = finiteNumber(value);
  if (number === null || !Number.isInteger(number) || number < 0 || number > 99) return null;
  return number;
}

function normalizeHourlySample(value: unknown): WeatherHourlySample | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.time !== "string") return null;
  const timeMs = parseApiTime(row.time);
  if (!Number.isFinite(timeMs)) return null;
  return {
    time: new Date(timeMs).toISOString(),
    windSpeedKts: nonNegativeNumber(row.windSpeedKts),
    windDirectionDeg: normalizedDirection(row.windDirectionDeg),
    gustKts: nonNegativeNumber(row.gustKts),
    temperatureC: finiteNumber(row.temperatureC),
    weatherCode: normalizedWeatherCode(row.weatherCode),
  };
}

/** Normalize stored hourly evidence with a strict payload bound and stable ordering. */
export function normalizeWeatherHourlySamples(value: unknown): WeatherHourlySample[] | null {
  if (!Array.isArray(value) || value.length > MAX_WEATHER_HOURLY_SAMPLES) return null;
  const byTime = new Map<string, WeatherHourlySample>();
  for (const row of value) {
    const sample = normalizeHourlySample(row);
    if (sample && !byTime.has(sample.time)) byTime.set(sample.time, sample);
  }
  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

function sampleDurationMs(time: string, start: Date, end: Date): number {
  const timeMs = Date.parse(time);
  const overlap = Math.min(end.getTime(), timeMs + HOUR_MS / 2)
    - Math.max(start.getTime(), timeMs - HOUR_MS / 2);
  // A nearest-hour fallback can sit just outside the window. Keep it usable,
  // while real overlapping samples retain their duration weighting.
  return Math.max(overlap, 1);
}

function durationWeightedMean(
  samples: Array<{ value: number; durationMs: number }>,
): number | null {
  const totalDuration = samples.reduce((sum, sample) => sum + sample.durationMs, 0);
  if (totalDuration <= 0) return null;
  return samples.reduce(
    (sum, sample) => sum + sample.value * sample.durationMs,
    0,
  ) / totalDuration;
}

function modalConditionCode(
  samples: readonly WeatherHourlySample[],
  start: Date,
  end: Date,
): number | null {
  const contribution = new Map<number, { count: number; durationMs: number; first: number }>();
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    if (sample.weatherCode === null) continue;
    const current = contribution.get(sample.weatherCode) ?? {
      count: 0,
      durationMs: 0,
      first: index,
    };
    current.count++;
    current.durationMs += sampleDurationMs(sample.time, start, end);
    contribution.set(sample.weatherCode, current);
  }
  return [...contribution.entries()]
    .sort(([codeA, a], [codeB, b]) =>
      b.count - a.count ||
      b.durationMs - a.durationMs ||
      a.first - b.first ||
      codeA - codeB)
    .at(0)?.[0] ?? null;
}

/** Deterministic WMO/Open-Meteo weather-code wording for report cards. */
export function weatherCodeToText(code: number | null): string {
  const labels: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  if (code === null) return "Unavailable";
  return labels[code] ?? `Weather code ${code}`;
}

async function getJson<T>(url: URL, fetcher: Fetcher): Promise<T> {
  const response = await fetcher(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Weather service returned ${response.status}${detail ? `: ${detail}` : "."}`);
  }
  return (await response.json()) as T;
}

export async function geocodeWeatherLocation(
  query: string,
  fetcher: Fetcher = fetch,
): Promise<WeatherLocation> {
  const normalized = query.trim();
  if (normalized.length < 2 || normalized.length > 180) {
    throw new Error("Enter a more specific race location.");
  }

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", normalized);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const payload = await getJson<OpenMeteoGeocodingResponse>(url, fetcher);
  const match = payload.results?.find(
    (result) => finiteNumber(result.latitude) !== null && finiteNumber(result.longitude) !== null,
  );
  if (!match) throw new Error(`No weather location matched “${normalized}”.`);

  return {
    name: stringOrNull(match.name) ?? normalized,
    country: stringOrNull(match.country),
    admin1: stringOrNull(match.admin1),
    latitude: finiteNumber(match.latitude)!,
    longitude: finiteNumber(match.longitude)!,
    timezone: stringOrNull(match.timezone),
  };
}

export function chooseWeatherDataset(windowEnd: Date, now = new Date()): WeatherDataset {
  if (windowEnd.getTime() >= now.getTime() - 5 * DAY_MS) return "forecast";
  if (windowEnd.getUTCFullYear() >= 2021) return "historical-forecast";
  return "historical-weather";
}

function weatherEndpoint(dataset: WeatherDataset): string {
  if (dataset === "forecast") return "https://api.open-meteo.com/v1/forecast";
  if (dataset === "historical-forecast") {
    return "https://historical-forecast-api.open-meteo.com/v1/forecast";
  }
  return "https://archive-api.open-meteo.com/v1/archive";
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildAtmosphereUrl(
  location: WeatherLocation,
  start: Date,
  end: Date,
  dataset: WeatherDataset,
): URL {
  const url = new URL(weatherEndpoint(dataset));
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("start_date", isoDate(new Date(start.getTime() - HOUR_MS)));
  url.searchParams.set("end_date", isoDate(new Date(end.getTime() + HOUR_MS)));
  url.searchParams.set(
    "hourly",
    [
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "temperature_2m",
      "precipitation",
      "cloud_cover",
      "pressure_msl",
      "weather_code",
    ].join(","),
  );
  url.searchParams.set("wind_speed_unit", "kn");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("precipitation_unit", "mm");
  url.searchParams.set("timezone", "UTC");
  return url;
}

function buildMarineUrl(location: WeatherLocation, start: Date, end: Date): URL {
  const url = new URL("https://marine-api.open-meteo.com/v1/marine");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("start_date", isoDate(new Date(start.getTime() - HOUR_MS)));
  url.searchParams.set("end_date", isoDate(new Date(end.getTime() + HOUR_MS)));
  url.searchParams.set("hourly", "wave_height,wave_period,wave_direction");
  url.searchParams.set("timezone", "UTC");
  return url;
}

function selectedIndices(times: Array<string | null>, start: Date, end: Date): number[] {
  const from = start.getTime() - HOUR_MS / 2;
  const through = end.getTime() + HOUR_MS / 2;
  const indices = times
    .map((time, index) => ({ index, value: parseApiTime(time) }))
    .filter(({ value }) => Number.isFinite(value) && value >= from && value <= through)
    .map(({ index }) => index);
  if (indices.length > 0) return indices;

  let closestIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < times.length; index++) {
    const value = parseApiTime(times[index]);
    const distance = Math.abs(value - start.getTime());
    if (Number.isFinite(value) && distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  }
  return closestIndex >= 0 && closestDistance <= 3 * HOUR_MS ? [closestIndex] : [];
}

function buildHourlySamples(
  hourly: NonNullable<OpenMeteoHourlyResponse["hourly"]>,
  indices: readonly number[],
): WeatherHourlySample[] {
  const times = timeArray(hourly.time);
  const speeds = numericArray(hourly.wind_speed_10m);
  const directions = numericArray(hourly.wind_direction_10m);
  const gusts = numericArray(hourly.wind_gusts_10m);
  const temperatures = numericArray(hourly.temperature_2m);
  const codes = numericArray(hourly.weather_code);
  const samples = indices.flatMap((index): WeatherHourlySample[] => {
    const rawTime = times[index];
    const timeMs = parseApiTime(rawTime);
    if (!Number.isFinite(timeMs)) return [];
    return [{
      time: new Date(timeMs).toISOString(),
      windSpeedKts: nonNegativeNumber(speeds[index]),
      windDirectionDeg: normalizedDirection(directions[index]),
      gustKts: nonNegativeNumber(gusts[index]),
      temperatureC: finiteNumber(temperatures[index]),
      weatherCode: normalizedWeatherCode(codes[index]),
    }];
  });
  const normalized = normalizeWeatherHourlySamples(samples);
  return normalized ?? [];
}

function selectedNumbers(values: Array<number | null>, indices: number[]): number[] {
  return indices
    .map((index) => values[index])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function summarizeMarine(
  payload: OpenMeteoHourlyResponse | null,
  start: Date,
  end: Date,
): Pick<
  WeatherEvidence,
  "waveHeightMinM" | "waveHeightMaxM" | "wavePeriodS" | "waveDirectionDeg"
> {
  const hourly = payload?.hourly;
  if (!hourly) {
    return {
      waveHeightMinM: null,
      waveHeightMaxM: null,
      wavePeriodS: null,
      waveDirectionDeg: null,
    };
  }
  const indices = selectedIndices(timeArray(hourly.time), start, end);
  const heights = selectedNumbers(numericArray(hourly.wave_height), indices);
  const periods = selectedNumbers(numericArray(hourly.wave_period), indices);
  const directions = selectedNumbers(numericArray(hourly.wave_direction), indices);
  return {
    waveHeightMinM: heights.length ? round(Math.min(...heights), 2) : null,
    waveHeightMaxM: heights.length ? round(Math.max(...heights), 2) : null,
    wavePeriodS: periods.length ? round(mean(periods)!, 1) : null,
    waveDirectionDeg: directions.length
      ? Math.round(circularMeanDeg(directions, directions.map(() => 1))!)
      : null,
  };
}

export function summarizeOpenMeteoWeather(
  payload: OpenMeteoHourlyResponse,
  location: WeatherLocation,
  start: Date,
  end: Date,
  dataset: WeatherDataset,
  sourceUrl: string,
  marinePayload: OpenMeteoHourlyResponse | null = null,
  marineSourceUrl: string | null = null,
  fetchedAt = new Date(),
): WeatherEvidence {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error("Race start and end must be valid dates in chronological order.");
  }
  if (end.getTime() - start.getTime() > DAY_MS) {
    throw new Error("The weather window cannot exceed 24 hours.");
  }
  const hourly = payload.hourly;
  if (!hourly) throw new Error("Weather service returned no hourly data.");
  const indices = selectedIndices(timeArray(hourly.time), start, end);
  if (indices.length === 0) throw new Error("Weather service returned no data during the race window.");

  const hourlySamples = buildHourlySamples(hourly, indices);
  const windPairs = hourlySamples.flatMap((sample) =>
    sample.windSpeedKts !== null && sample.windDirectionDeg !== null
      ? [{
          speed: sample.windSpeedKts,
          direction: sample.windDirectionDeg,
          durationMs: sampleDurationMs(sample.time, start, end),
        }]
      : []);
  if (windPairs.length === 0) {
    throw new Error("Weather service returned no usable wind data during the race window.");
  }
  const gusts = hourlySamples.flatMap((sample) => sample.gustKts === null ? [] : [sample.gustKts]);
  const temperatures = hourlySamples.flatMap(
    (sample) => sample.temperatureC === null ? [] : [sample.temperatureC],
  );
  const precipitation = selectedNumbers(numericArray(hourly.precipitation), indices);
  const clouds = selectedNumbers(numericArray(hourly.cloud_cover), indices);
  const pressures = selectedNumbers(numericArray(hourly.pressure_msl), indices);
  const direction = circularMeanDeg(
    windPairs.map((pair) => pair.direction),
    windPairs.map((pair) => pair.durationMs * pair.speed),
  );
  const pairedSpeeds = windPairs.map((pair) => pair.speed);
  const averageWindKts = durationWeightedMean(
    windPairs.map((pair) => ({ value: pair.speed, durationMs: pair.durationMs })),
  );
  if (direction === null) throw new Error("Weather service wind direction was indeterminate.");
  const conditionCode = modalConditionCode(hourlySamples, start, end);

  return {
    provider: "open-meteo",
    dataset,
    sourceUrl,
    marineSourceUrl,
    location,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    fetchedAt: fetchedAt.toISOString(),
    sampleCount: hourlySamples.length,
    windMinKts: round(Math.min(...pairedSpeeds)),
    windMaxKts: round(Math.max(...pairedSpeeds)),
    windDirectionDeg: Math.round(direction) % 360,
    gustMaxKts: gusts.length ? round(Math.max(...gusts)) : null,
    temperatureMinC: temperatures.length ? round(Math.min(...temperatures)) : null,
    temperatureMaxC: temperatures.length ? round(Math.max(...temperatures)) : null,
    precipitationMm: precipitation.length
      ? round(precipitation.reduce((sum, value) => sum + value, 0), 2)
      : null,
    cloudCoverPct: clouds.length ? Math.round(mean(clouds)!) : null,
    pressureMslHpa: pressures.length ? round(mean(pressures)!) : null,
    weatherCodes: [...new Set(hourlySamples.flatMap(
      (sample) => sample.weatherCode === null ? [] : [sample.weatherCode],
    ))],
    hourly: hourlySamples,
    averageWindKts: averageWindKts === null ? null : round(averageWindKts),
    conditionCode,
    ...summarizeMarine(marinePayload, start, end),
  };
}

export async function fetchRaceWeatherEvidence(
  location: WeatherLocation,
  start: Date,
  end: Date,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<WeatherEvidence> {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new Error("Race start and end must be valid dates.");
  }
  if (end <= start) throw new Error("Race end must be after race start.");
  if (end.getTime() - start.getTime() > 24 * HOUR_MS) {
    throw new Error("The weather window cannot exceed 24 hours.");
  }

  const dataset = chooseWeatherDataset(end, now);
  const atmosphereUrl = buildAtmosphereUrl(location, start, end, dataset);
  const marineUrl = buildMarineUrl(location, start, end);
  const marineIsAvailable =
    start.getTime() >= now.getTime() - 92 * DAY_MS && end.getTime() <= now.getTime() + 7 * DAY_MS;

  const [atmosphere, marineResult] = await Promise.all([
    getJson<OpenMeteoHourlyResponse>(atmosphereUrl, fetcher),
    marineIsAvailable
      ? getJson<OpenMeteoHourlyResponse>(marineUrl, fetcher).catch(() => null)
      : Promise.resolve(null),
  ]);

  return summarizeOpenMeteoWeather(
    atmosphere,
    location,
    start,
    end,
    dataset,
    atmosphereUrl.toString(),
    marineResult,
    marineResult ? marineUrl.toString() : null,
  );
}

export function formatWeatherLocation(location: WeatherLocation): string {
  return [location.name, location.admin1, location.country].filter(Boolean).join(", ");
}
