import { describe, expect, it } from "vitest";

import { speedText } from "@/components/replay/wind-indicator";
import type { ReplayWindReading } from "@/components/replay/wind-resolution";

function manualReading(
  twsRangeKts: ReplayWindReading["twsRangeKts"],
): ReplayWindReading {
  return {
    twdDeg: 270,
    twsKts: null,
    twsRangeKts,
    source: "manual",
    confidence: null,
  };
}

describe("speedText", () => {
  it("labels one-sided manual wind ranges as bounds rather than exact speeds", () => {
    expect(speedText(manualReading([14, null]))).toBe("≥14 kt");
    expect(speedText(manualReading([null, 14]))).toBe("≤14 kt");
  });
});
