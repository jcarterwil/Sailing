import type { ReplayWindReading } from "@/components/replay/wind-resolution";

function compactSpeed(speed: number): string {
  return Number.isInteger(speed) ? String(speed) : speed.toFixed(1);
}

export function speedText(reading: ReplayWindReading): string {
  if (reading.twsKts != null) return `${reading.twsKts.toFixed(1)} kt`;
  if (reading.twsRangeKts) {
    const [minimum, maximum] = reading.twsRangeKts;
    if (minimum == null && maximum != null) return `≤${compactSpeed(maximum)} kt`;
    if (minimum != null && maximum == null) return `≥${compactSpeed(minimum)} kt`;
    if (minimum == null || maximum == null) return "—";
    if (minimum === maximum) return `${minimum.toFixed(1)} kt`;
    return `${minimum.toFixed(1)}–${maximum.toFixed(1)} kt`;
  }
  return "—";
}
