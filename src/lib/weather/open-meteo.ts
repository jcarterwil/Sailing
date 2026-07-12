export type WeatherDataset = "forecast" | "historical-forecast" | "historical-weather";

export interface WeatherLocation {
  name: string;
  country: string | null;
  admin1: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
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

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericArray(value: unknown): Array<number | null> {
  return Array.isArray(value) ? value.map(finiteNumber) : [];
}

function timeArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseApiTime(value: string): number {
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
    const weight = Math.max(weights[index] ?? 1, 0.1);
    x += Math.cos(radians) * weight;
    y += Math.sin(radians) * weight;
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null;
  const normalized = (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
  return normalized > 359.999999 ? 0 : normalized;
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

function selectedIndices(times: string[], start: Date, end: Date): number[] {
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

function selectedNumbers(values: Array<number | null>, indices: number[]): number[] {
  return indices.map((index) => values[index]).filter((value): value is number => value !== null);
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
  const hourly = payload.hourly;
  if (!hourly) throw new Error("Weather service returned no hourly data.");
  const indices = selectedIndices(timeArray(hourly.time), start, end);
  if (indices.length === 0) throw new Error("Weather service returned no data during the race window.");

  const speedValues = numericArray(hourly.wind_speed_10m);
  const directionValues = numericArray(hourly.wind_direction_10m);
  const speeds = selectedNumbers(speedValues, indices);
  const windPairs = indices
    .map((index) => ({ speed: speedValues[index], direction: directionValues[index] }))
    .filter(
      (pair): pair is { speed: number; direction: number } =>
        pair.speed !== null && pair.direction !== null,
    );
  if (speeds.length === 0 || windPairs.length === 0) {
    throw new Error("Weather service returned no usable wind data during the race window.");
  }
  const gusts = selectedNumbers(numericArray(hourly.wind_gusts_10m), indices);
  const temperatures = selectedNumbers(numericArray(hourly.temperature_2m), indices);
  const precipitation = selectedNumbers(numericArray(hourly.precipitation), indices);
  const clouds = selectedNumbers(numericArray(hourly.cloud_cover), indices);
  const pressures = selectedNumbers(numericArray(hourly.pressure_msl), indices);
  const codes = selectedNumbers(numericArray(hourly.weather_code), indices).map(Math.round);
  const direction = circularMeanDeg(
    windPairs.map((pair) => pair.direction),
    windPairs.map((pair) => pair.speed),
  );
  if (direction === null) throw new Error("Weather service wind direction was indeterminate.");

  return {
    provider: "open-meteo",
    dataset,
    sourceUrl,
    marineSourceUrl,
    location,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    fetchedAt: fetchedAt.toISOString(),
    sampleCount: indices.length,
    windMinKts: round(Math.min(...speeds)),
    windMaxKts: round(Math.max(...speeds)),
    windDirectionDeg: Math.round(direction) % 360,
    gustMaxKts: gusts.length ? round(Math.max(...gusts)) : null,
    temperatureMinC: temperatures.length ? round(Math.min(...temperatures)) : null,
    temperatureMaxC: temperatures.length ? round(Math.max(...temperatures)) : null,
    precipitationMm: precipitation.length
      ? round(precipitation.reduce((sum, value) => sum + value, 0), 2)
      : null,
    cloudCoverPct: clouds.length ? Math.round(mean(clouds)!) : null,
    pressureMslHpa: pressures.length ? round(mean(pressures)!) : null,
    weatherCodes: [...new Set(codes)],
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
