import { formatDateTime, formatNumber } from "@/components/performance/view-model";
import type { WeatherEvidence, WeatherHourlySample } from "@/lib/weather/open-meteo";

const WIDTH = 700;
const HEIGHT = 280;
const LEFT = 44;
const RIGHT = 18;
const TOP = 20;
const SPEED_BOTTOM = 160;
const DIRECTION_TOP = 198;
const DIRECTION_BOTTOM = 250;

function pathFor(
  samples: readonly WeatherHourlySample[],
  value: (sample: WeatherHourlySample) => number | null,
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let drawing = false;
  return samples.map((sample, index) => {
    const point = value(sample);
    if (point === null || !Number.isFinite(point)) {
      drawing = false;
      return "";
    }
    const command = drawing ? "L" : "M";
    drawing = true;
    return `${command}${x(index).toFixed(1)},${y(point).toFixed(1)}`;
  }).filter(Boolean).join(" ");
}

export function WeatherTimeline({ evidence }: { evidence: WeatherEvidence }) {
  const samples = evidence.hourly ?? [];
  if (samples.length < 2) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Hourly weather evidence is unavailable for this saved race snapshot.
      </div>
    );
  }
  const maxSpeed = Math.max(
    ...samples.flatMap((sample) => [sample.windSpeedKts, sample.gustKts]
      .filter((value): value is number => value !== null && Number.isFinite(value))),
    1,
  );
  const x = (index: number) => LEFT + index / Math.max(1, samples.length - 1) * (WIDTH - LEFT - RIGHT);
  const speedY = (value: number) => SPEED_BOTTOM - value / maxSpeed * (SPEED_BOTTOM - TOP);
  const directionY = (value: number) => DIRECTION_BOTTOM - value / 360 * (DIRECTION_BOTTOM - DIRECTION_TOP);
  return (
    <div className="overflow-x-auto rounded-lg border p-3">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto min-w-[620px] w-full" role="img">
        <title>Weather wind speed, gust, and direction time series from persisted Open-Meteo evidence</title>
        <line x1={LEFT} y1={SPEED_BOTTOM} x2={WIDTH - RIGHT} y2={SPEED_BOTTOM} stroke="currentColor" strokeOpacity="0.25" />
        <line x1={LEFT} y1={TOP} x2={LEFT} y2={SPEED_BOTTOM} stroke="currentColor" strokeOpacity="0.25" />
        <text x="4" y={TOP + 5} fontSize="10" fill="currentColor">{formatNumber(maxSpeed, 1)} kt</text>
        <text x="14" y={SPEED_BOTTOM} fontSize="10" fill="currentColor">0</text>
        <path d={pathFor(samples, (sample) => sample.windSpeedKts, x, speedY)} fill="none" stroke="#38bdf8" strokeWidth="3" />
        <path d={pathFor(samples, (sample) => sample.gustKts, x, speedY)} fill="none" stroke="#f59e0b" strokeDasharray="5 4" strokeWidth="2" />
        <line x1={LEFT} y1={DIRECTION_BOTTOM} x2={WIDTH - RIGHT} y2={DIRECTION_BOTTOM} stroke="currentColor" strokeOpacity="0.25" />
        <text x="4" y={DIRECTION_TOP + 5} fontSize="10" fill="currentColor">360°</text>
        <text x="14" y={DIRECTION_BOTTOM} fontSize="10" fill="currentColor">0°</text>
        {samples.map((sample, index) => sample.windDirectionDeg === null ? null : (
          <circle key={sample.time} cx={x(index)} cy={directionY(sample.windDirectionDeg)} r="2.5" fill="#a78bfa" />
        ))}
        <text x={LEFT} y={HEIGHT - 8} fontSize="10" fill="currentColor">
          {formatDateTime(Date.parse(samples[0].time), evidence.location.timezone ?? "UTC")}
        </text>
        <text x={WIDTH - RIGHT} y={HEIGHT - 8} textAnchor="end" fontSize="10" fill="currentColor">
          {formatDateTime(Date.parse(samples.at(-1)!.time), evidence.location.timezone ?? "UTC")}
        </text>
      </svg>
      <div className="flex flex-wrap gap-4 px-2 text-xs text-muted-foreground">
        <span><span className="mr-1 inline-block h-0.5 w-5 bg-sky-400 align-middle" />Wind speed</span>
        <span><span className="mr-1 inline-block h-0.5 w-5 border-t-2 border-dashed border-amber-500 align-middle" />Gust</span>
        <span><span className="mr-1 inline-block size-2 rounded-full bg-violet-400 align-middle" />Direction</span>
      </div>
    </div>
  );
}
