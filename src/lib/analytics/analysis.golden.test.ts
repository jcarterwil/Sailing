import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { angleDiff } from "@/lib/analytics/angles";
import { analyzeRace } from "@/lib/analytics/analyze";
import { parseTrackCsv } from "@/lib/analytics/parse/csv";
import { parseVkx } from "@/lib/analytics/parse/vkx";
import { buildProcessedTrack } from "@/lib/analytics/track/process";
import type { ProcessedTrack } from "@/lib/analytics/types";

const EXAMPLES = path.resolve(import.meta.dirname, "../../../Examples");
const RACE_START_UTC = Date.UTC(2026, 6, 7, 22, 10, 0);
const hasExamples = existsSync(EXAMPLES);

describe.skipIf(!hasExamples)("fleet analysis golden examples", () => {
  it("finds the July 7 start and expected fleet wind", () => {
    const tracks: ProcessedTrack[] = [];
    const vkxFiles = readdirSync(EXAMPLES).filter((file) => file.endsWith(".vkx")).sort();
    for (const file of vkxFiles) {
      tracks.push(buildProcessedTrack(parseVkx(readFileSync(path.join(EXAMPLES, file))), `vkx:${file}`));
    }
    const csvFile = "Blessed 7-7-2026.csv";
    if (existsSync(path.join(EXAMPLES, csvFile))) {
      tracks.push(buildProcessedTrack(
        parseTrackCsv(readFileSync(path.join(EXAMPLES, csvFile), "utf8")),
        `csv:${csvFile}`,
      ));
    }

    expect(tracks).toHaveLength(6);
    const analysis = analyzeRace(tracks);
    expect(analysis.race.start.timeMs).toBe(RACE_START_UTC);
    expect(Math.abs(angleDiff(analysis.wind.twdDeg ?? NaN, 283))).toBeLessThan(10);
    expect(analysis.fleet.maneuverCount).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(analysis))).toEqual(analysis);
  });
});
