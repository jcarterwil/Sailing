export const SPEED_COLORS = {
  slow: "#ef4444",
  intermediate: "#facc15",
  fast: "#22c55e",
} as const;

const DEFAULT_GRADIENT_STEP = 0.02;
const MIN_MAX_SPEED_KTS = 1;

export interface SpeedDomain {
  minKts: number;
  midKts: number;
  maxKts: number;
}

export interface SpeedGradientStop {
  progress: number;
  speedKts: number;
  color: string;
}

export interface SpeedTrackData {
  coordinates: [number, number][];
  stops: SpeedGradientStop[];
}

interface SpeedValues {
  sog: ArrayLike<number>;
}

interface TrackValues extends SpeedValues {
  lat: ArrayLike<number>;
  lon: ArrayLike<number>;
}

export function createFleetSpeedDomain(tracks: readonly SpeedValues[]): SpeedDomain {
  let maxKts = 0;
  for (const track of tracks) {
    for (let i = 0; i < track.sog.length; i++) {
      const speed = track.sog[i];
      if (Number.isFinite(speed) && speed >= 0 && speed > maxKts) maxKts = speed;
    }
  }

  maxKts = Math.max(MIN_MAX_SPEED_KTS, maxKts);
  return { minKts: 0, midKts: maxKts / 2, maxKts };
}

function interpolateChannel(start: number, end: number, amount: number): number {
  return Math.round(start + (end - start) * amount);
}

function toHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function speedColor(speedKts: number, domain: SpeedDomain): string {
  const normalized = Number.isFinite(speedKts)
    ? Math.min(1, Math.max(0, speedKts / domain.maxKts))
    : 0;

  if (normalized <= 0.5) {
    const amount = normalized * 2;
    return toHex(
      interpolateChannel(239, 250, amount),
      interpolateChannel(68, 204, amount),
      interpolateChannel(68, 21, amount),
    );
  }

  const amount = (normalized - 0.5) * 2;
  return toHex(
    interpolateChannel(250, 34, amount),
    interpolateChannel(204, 197, amount),
    interpolateChannel(21, 94, amount),
  );
}

function segmentLength(
  previous: [number, number],
  current: [number, number],
): number {
  const meanLatitude = ((previous[1] + current[1]) / 2) * (Math.PI / 180);
  const longitudeDelta = (current[0] - previous[0]) * Math.cos(meanLatitude);
  const latitudeDelta = current[1] - previous[1];
  return Math.hypot(longitudeDelta, latitudeDelta);
}

function validSpeed(speedKts: number): number | null {
  return Number.isFinite(speedKts) && speedKts >= 0 ? speedKts : null;
}

function interpolateSpeed(
  speeds: number[],
  distances: number[],
  targetDistance: number,
  upperIndex: number,
): number {
  const lowerIndex = Math.max(0, upperIndex - 1);
  const lowerSpeed = validSpeed(speeds[lowerIndex]);
  const upperSpeed = validSpeed(speeds[upperIndex]);

  if (lowerSpeed === null) return upperSpeed ?? 0;
  if (upperSpeed === null) return lowerSpeed;

  const span = distances[upperIndex] - distances[lowerIndex];
  const amount = span > 0 ? (targetDistance - distances[lowerIndex]) / span : 0;
  return lowerSpeed + (upperSpeed - lowerSpeed) * amount;
}

export function buildSpeedTrackData(
  track: TrackValues,
  domain: SpeedDomain,
  gradientStep = DEFAULT_GRADIENT_STEP,
): SpeedTrackData {
  const coordinates: [number, number][] = [];
  const speeds: number[] = [];
  const pointCount = Math.min(track.lat.length, track.lon.length, track.sog.length);

  for (let i = 0; i < pointCount; i++) {
    const latitude = track.lat[i];
    const longitude = track.lon[i];
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    coordinates.push([longitude, latitude]);
    speeds.push(track.sog[i]);
  }

  if (coordinates.length === 0) return { coordinates, stops: [] };

  const distances = new Array<number>(coordinates.length).fill(0);
  for (let i = 1; i < coordinates.length; i++) {
    distances[i] = distances[i - 1] + segmentLength(coordinates[i - 1], coordinates[i]);
  }

  const totalDistance = distances[distances.length - 1];
  const sampleCount = Math.max(1, Math.round(1 / gradientStep));
  const stops: SpeedGradientStop[] = [];
  let upperIndex = 0;

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
    const progress = sampleIndex / sampleCount;
    const targetDistance = totalDistance * progress;
    while (upperIndex < distances.length - 1 && distances[upperIndex] < targetDistance) {
      upperIndex += 1;
    }
    const speedKts = interpolateSpeed(speeds, distances, targetDistance, upperIndex);
    stops.push({ progress, speedKts, color: speedColor(speedKts, domain) });
  }

  return { coordinates, stops };
}

export function lineGradientExpression(stops: SpeedGradientStop[]): unknown[] {
  const expression: unknown[] = ["interpolate", ["linear"], ["line-progress"]];
  for (const stop of stops) expression.push(stop.progress, stop.color);
  return expression;
}
