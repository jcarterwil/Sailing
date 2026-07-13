import { describe, expect, it } from "vitest";

import { distanceToSegmentM } from "@/lib/analytics/geo";
import {
  activeStart,
  fleetStarts,
  nextStart,
  startForLine,
  startLineAt,
} from "@/lib/analytics/start-line";
import type { VkxExtras } from "@/lib/analytics/types";

function extras(partial: Partial<VkxExtras>): VkxExtras {
  return {
    formatVersion: 5,
    loggingRateHz: 2,
    timerEvents: [],
    linePings: [],
    windSamples: [],
    declinationDeg: null,
    ...partial,
  };
}

describe("fleetStarts", () => {
  it("returns the median of staggered per-boat starts in one cluster", () => {
    const t0 = 1_000_000;
    const starts = fleetStarts([
      extras({ timerEvents: [{ t: t0 - 800, event: "race_start", timerSec: 0 }] }),
      extras({ timerEvents: [{ t: t0, event: "race_start", timerSec: 0 }] }),
      extras({ timerEvents: [{ t: t0 + 800, event: "race_start", timerSec: 0 }] }),
      null,
    ]);
    expect(starts).toEqual([t0]);
  });

  it("splits clusters more than 60s apart (general recall)", () => {
    const first = 1_000_000;
    const second = first + 5 * 60_000;
    const starts = fleetStarts([
      extras({
        timerEvents: [
          { t: first - 200, event: "race_start", timerSec: 0 },
          { t: second, event: "race_start", timerSec: 0 },
        ],
      }),
      extras({
        timerEvents: [
          { t: first + 200, event: "race_start", timerSec: 0 },
          { t: second + 400, event: "race_start", timerSec: 0 },
        ],
      }),
    ]);
    expect(starts).toHaveLength(2);
    expect(starts[0]).toBe(first);
    expect(starts[1]).toBe(second + 200);
  });

  it("returns [] when no boat recorded a gun", () => {
    expect(fleetStarts([null, extras({ timerEvents: [] })])).toEqual([]);
  });
});

describe("activeStart / nextStart", () => {
  const starts = [1000, 2000, 3000];

  it("picks the latest start at or before t", () => {
    expect(activeStart(starts, 999)).toBeNull();
    expect(activeStart(starts, 1000)).toBe(1000);
    expect(activeStart(starts, 2500)).toBe(2000);
    expect(activeStart(starts, 9000)).toBe(3000);
  });

  it("picks the earliest start after t", () => {
    expect(nextStart(starts, 500)).toBe(1000);
    expect(nextStart(starts, 1000)).toBe(2000);
    expect(nextStart(starts, 3000)).toBeNull();
  });
});

describe("startForLine", () => {
  const starts = [1000, 2000];

  it("prefers the upcoming gun during pre-start", () => {
    expect(startForLine(starts, 500)).toBe(1000);
    expect(startForLine(starts, 1500)).toBe(2000);
  });

  it("falls back to the active gun after the last start", () => {
    expect(startForLine(starts, 2500)).toBe(2000);
  });
});

describe("startLineAt", () => {
  it("uses the latest ping per end at or before the gun", () => {
    const gun = 10_000;
    const line = startLineAt(
      [
        extras({
          linePings: [
            { t: 1000, end: "pin", lat: 45, lon: -84 },
            { t: 2000, end: "boat", lat: 45.01, lon: -84.01 },
          ],
        }),
        extras({
          linePings: [
            { t: 5000, end: "pin", lat: 45.1, lon: -84.1 },
            { t: 15_000, end: "boat", lat: 99, lon: 99 }, // after gun — ignored
          ],
        }),
      ],
      gun,
    );
    expect(line).toEqual({
      pin: { lat: 45.1, lon: -84.1 },
      boat: { lat: 45.01, lon: -84.01 },
    });
  });

  it("returns null when only one end was pinged", () => {
    expect(
      startLineAt(
        [
          extras({
            linePings: [{ t: 1000, end: "pin", lat: 45, lon: -84 }],
          }),
        ],
        5000,
      ),
    ).toBeNull();
  });

  it("returns null for all-null extras", () => {
    expect(startLineAt([null, null], 5000)).toBeNull();
  });

  it("skips non-finite coordinates", () => {
    expect(
      startLineAt(
        [
          extras({
            linePings: [
              { t: 1000, end: "pin", lat: Number.NaN, lon: -84 },
              { t: 1000, end: "boat", lat: 45, lon: -84 },
            ],
          }),
        ],
        5000,
      ),
    ).toBeNull();
  });
});

describe("distanceToSegmentM", () => {
  it("is ~0 on the segment and positive off it", () => {
    const a = { lat: 42, lon: -71 };
    const b = { lat: 42.001, lon: -71 };
    expect(distanceToSegmentM(42.0005, -71, a, b)).toBeLessThan(1);
    expect(distanceToSegmentM(42.0005, -70.998, a, b)).toBeGreaterThan(50);
  });
});
