import { describe, expect, it } from "vitest";

import { suggestSessionType } from "@/lib/imports/suggest-session-type";

describe("suggestSessionType", () => {
  it("suggests race on race_start timer", () => {
    const result = suggestSessionType({
      timerEvents: [{ t: 1, event: "race_start", timerSec: 0 }],
      timerEventCount: 1,
      linePingCount: 0,
    });
    expect(result.sessionType).toBe("race");
    expect(result.confidence).toBe("high");
  });

  it("suggests race when timer and start-line evidence both exist", () => {
    const result = suggestSessionType({
      timerEvents: [{ t: 1, event: "sync", timerSec: 300 }],
      timerEventCount: 1,
      linePingCount: 2,
    });
    expect(result.sessionType).toBe("race");
    expect(result.confidence).toBe("medium");
  });

  it("defaults to practice otherwise", () => {
    const result = suggestSessionType({
      timerEvents: [],
      timerEventCount: 0,
      linePingCount: 0,
    });
    expect(result.sessionType).toBe("practice");
  });
});
