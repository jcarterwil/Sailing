import type { VkxExtras } from "@/lib/analytics/types";

export interface StartLine {
  pin: { lat: number; lon: number };
  boat: { lat: number; lon: number };
}

const CLUSTER_GAP_MS = 60_000;

function medianSorted(sorted: number[]): number {
  if (sorted.length === 0) return Number.NaN;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Cluster `race_start` events across boats (gap > 60s ⇒ new cluster, e.g.
 * general recall). Returns the median timestamp of each cluster, ascending.
 * Empty when no boat recorded a gun.
 */
export function fleetStarts(extrasList: Array<VkxExtras | null>): number[] {
  const times: number[] = [];
  for (const extras of extrasList) {
    if (!extras) continue;
    for (const ev of extras.timerEvents) {
      if (ev.event === "race_start" && Number.isFinite(ev.t)) times.push(ev.t);
    }
  }
  if (times.length === 0) return [];
  times.sort((a, b) => a - b);

  const clusters: number[][] = [[times[0]]];
  for (let i = 1; i < times.length; i++) {
    const cluster = clusters[clusters.length - 1];
    if (times[i] - cluster[cluster.length - 1] > CLUSTER_GAP_MS) {
      clusters.push([times[i]]);
    } else {
      cluster.push(times[i]);
    }
  }
  return clusters.map((c) => medianSorted(c));
}

/** Latest start at or before `timeMs`, or null. */
export function activeStart(startsMs: number[], timeMs: number): number | null {
  let best: number | null = null;
  for (const t of startsMs) {
    if (t <= timeMs) best = t;
    else break;
  }
  return best;
}

/** Earliest start strictly after `timeMs`, or null. */
export function nextStart(startsMs: number[], timeMs: number): number | null {
  for (const t of startsMs) {
    if (t > timeMs) return t;
  }
  return null;
}

/**
 * Most-recent finite-coordinate ping per end at/before `startMs`, across all
 * boats. Null unless BOTH ends were pinged — never fabricate a line.
 */
export function startLineAt(
  extrasList: Array<VkxExtras | null>,
  startMs: number,
): StartLine | null {
  let pin: { t: number; lat: number; lon: number } | null = null;
  let boat: { t: number; lat: number; lon: number } | null = null;

  for (const extras of extrasList) {
    if (!extras) continue;
    for (const ping of extras.linePings) {
      if (ping.t > startMs) continue;
      if (!Number.isFinite(ping.lat) || !Number.isFinite(ping.lon) || !Number.isFinite(ping.t)) {
        continue;
      }
      if (ping.end === "pin") {
        if (!pin || ping.t >= pin.t) pin = { t: ping.t, lat: ping.lat, lon: ping.lon };
      } else if (ping.end === "boat") {
        if (!boat || ping.t >= boat.t) boat = { t: ping.t, lat: ping.lat, lon: ping.lon };
      }
    }
  }

  if (!pin || !boat) return null;
  return {
    pin: { lat: pin.lat, lon: pin.lon },
    boat: { lat: boat.lat, lon: boat.lon },
  };
}
