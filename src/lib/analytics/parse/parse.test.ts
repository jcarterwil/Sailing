import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseTrackCsv } from "@/lib/analytics/parse/csv";
import { parseVkx } from "@/lib/analytics/parse/vkx";
import { buildProcessedTrack } from "@/lib/analytics/track/process";

// Golden tests against the real July 7 2026 fleet logs in Examples/.
const EXAMPLES = path.resolve(import.meta.dirname, "../../../../Examples");
const RACE_START_UTC = Date.UTC(2026, 6, 7, 22, 10, 0);
const hasExamples = existsSync(EXAMPLES);

const vkxFiles = hasExamples
  ? readdirSync(EXAMPLES).filter((f) => f.endsWith(".vkx"))
  : [];

describe.skipIf(!hasExamples)("parseVkx", () => {
  it("finds all five example logs", () => {
    expect(vkxFiles).toHaveLength(5);
  });

  for (const file of vkxFiles) {
    it(`parses ${file}`, () => {
      const raw = parseVkx(readFileSync(path.join(EXAMPLES, file)));
      expect(raw.points.length).toBeGreaterThan(10_000);
      expect(raw.extras?.formatVersion).toBe(5);
      expect(raw.extras?.loggingRateHz).toBe(2);

      // Every point in Little Traverse Bay with sane values.
      for (const p of [raw.points[0], raw.points[Math.floor(raw.points.length / 2)]]) {
        expect(p.lat).toBeGreaterThan(45.3);
        expect(p.lat).toBeLessThan(45.6);
        expect(p.lon).toBeGreaterThan(-85.2);
        expect(p.lon).toBeLessThan(-84.8);
        expect(p.sogKts).toBeGreaterThanOrEqual(0);
        expect(p.sogKts).toBeLessThan(30);
        expect(p.hdgDeg).toBeGreaterThanOrEqual(0);
        expect(p.hdgDeg).toBeLessThan(360);
      }
    });
  }

  it("reads the synchronized RACE_START timer event", () => {
    const starts: number[] = [];
    for (const file of vkxFiles) {
      const raw = parseVkx(readFileSync(path.join(EXAMPLES, file)));
      const raceStart = raw.extras?.timerEvents.find((e) => e.event === "race_start");
      if (raceStart) starts.push(raceStart.t);
    }
    expect(starts.length).toBeGreaterThanOrEqual(2);
    for (const t of starts) {
      expect(Math.abs(t - RACE_START_UTC)).toBeLessThan(2_000);
    }
  });

  it("surfaces Calypso wind data where present", () => {
    const withWind = vkxFiles.filter((file) => {
      const raw = parseVkx(readFileSync(path.join(EXAMPLES, file)));
      return (raw.extras?.windSamples.length ?? 0) > 1_000;
    });
    expect(withWind.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects garbage input", () => {
    expect(() => parseVkx(new Uint8Array(64).fill(0xab))).toThrow();
  });
});

describe.skipIf(!hasExamples)("parseTrackCsv", () => {
  it("parses the Blessed export", () => {
    const csvText = readFileSync(path.join(EXAMPLES, "Blessed 7-7-2026.csv"), "utf8");
    const raw = parseTrackCsv(csvText);
    expect(raw.points.length).toBeGreaterThan(15_000);
    expect(raw.tzOffsetMinutes).toBe(-300);
    // Timestamps strictly ascending after dedupe.
    for (let i = 1; i < raw.points.length; i++) {
      expect(raw.points[i].t).toBeGreaterThan(raw.points[i - 1].t);
    }
  });

  it("rejects non-track input", () => {
    expect(() => parseTrackCsv("<html></html>")).toThrow();
    expect(() => parseTrackCsv("a,b,c\n1,2,3")).toThrow();
  });
});

describe.skipIf(!hasExamples)("buildProcessedTrack", () => {
  it("cleans the CSV attitude outliers", () => {
    const csvText = readFileSync(path.join(EXAMPLES, "Blessed 7-7-2026.csv"), "utf8");
    const processed = buildProcessedTrack(parseTrackCsv(csvText), "entry-1");
    let extremeHeel = 0;
    for (const h of processed.heel) {
      if (!Number.isNaN(h) && Math.abs(h) > 45) extremeHeel++;
    }
    expect(extremeHeel).toBe(0);
    expect(processed.t[0]).toBe(0);
  });
});
