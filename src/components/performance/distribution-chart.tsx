import type { PerformanceDistributionSeries } from "@/components/performance/view-model";
import { formatNumber } from "@/components/performance/view-model";

const WIDTH = 360;
const HEIGHT = 190;
const LEFT = 38;
const RIGHT = 12;
const TOP = 18;
const BOTTOM = 34;

function seriesPath(
  series: PerformanceDistributionSeries,
  minKts: number,
  maxKts: number,
  maxDensity: number,
): string {
  return series.bins.map((bin, index) => {
    const center = (bin.lowerKts + bin.upperKts) / 2;
    const x = LEFT + ((center - minKts) / Math.max(0.01, maxKts - minKts)) * (WIDTH - LEFT - RIGHT);
    const y = TOP + (1 - bin.densityPerKt / Math.max(0.01, maxDensity)) * (HEIGHT - TOP - BOTTOM);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function DistributionChart({
  title,
  series,
}: {
  title: string;
  series: readonly PerformanceDistributionSeries[];
}) {
  const available = series.filter((item) => item.available && item.bins.length > 0);
  if (available.length === 0) {
    const reason = series.find((item) => item.unavailableReason)?.unavailableReason ??
      "Insufficient eligible samples for this comparison.";
    return (
      <section className="rounded-lg border border-dashed p-4">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-2 text-xs text-muted-foreground">{reason}</p>
      </section>
    );
  }
  const bins = available.flatMap((item) => item.bins);
  const minKts = Math.min(...bins.map((bin) => bin.lowerKts));
  const maxKts = Math.max(...bins.map((bin) => bin.upperKts));
  const maxDensity = Math.max(...bins.map((bin) => bin.densityPerKt), 0.01);
  return (
    <section className="min-w-0 rounded-lg border p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-[11px] text-muted-foreground">VMG density · s/kt</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img">
        <title>{title} persisted common-bin VMG distributions</title>
        <line x1={LEFT} y1={HEIGHT - BOTTOM} x2={WIDTH - RIGHT} y2={HEIGHT - BOTTOM} stroke="currentColor" strokeOpacity="0.3" />
        <line x1={LEFT} y1={TOP} x2={LEFT} y2={HEIGHT - BOTTOM} stroke="currentColor" strokeOpacity="0.3" />
        <text x={LEFT} y={HEIGHT - 12} fontSize="10" fill="currentColor">{formatNumber(minKts, 1)} kt</text>
        <text x={WIDTH - RIGHT} y={HEIGHT - 12} textAnchor="end" fontSize="10" fill="currentColor">{formatNumber(maxKts, 1)} kt</text>
        {available.map((item) => (
          <path
            key={`${item.entryId}:${item.direction}:${item.tack}:${item.selection}`}
            d={seriesPath(item, minKts, maxKts, maxDensity)}
            fill="none"
            stroke={item.color}
            strokeWidth="2.5"
          />
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {available.map((item) => (
          <li key={item.entryId} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full border" style={{ backgroundColor: item.color }} aria-hidden="true" />
            <span>{item.boatName}</span>
            <span className="text-muted-foreground">median {formatNumber(item.medianKts, 2)} kt</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
