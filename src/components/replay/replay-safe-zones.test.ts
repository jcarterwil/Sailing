import { describe, expect, it } from "vitest";

import {
  isCompactReplayChrome,
  overlayAttr,
  REPLAY_OVERLAY,
  REPLAY_SAFE_ZONE_VARS,
} from "@/components/replay/replay-safe-zones";

describe("isCompactReplayChrome", () => {
  it("uses compact chrome below the sm breakpoint", () => {
    expect(
      isCompactReplayChrome({
        widthPx: 390,
        heightPx: 844,
        landscape: false,
      }),
    ).toBe(true);
  });

  it("keeps desktop chrome at tablet/desktop widths", () => {
    expect(
      isCompactReplayChrome({
        widthPx: 768,
        heightPx: 1024,
        landscape: false,
      }),
    ).toBe(false);
    expect(
      isCompactReplayChrome({
        widthPx: 1280,
        heightPx: 800,
        landscape: true,
      }),
    ).toBe(false);
  });

  it("forces compact chrome in short landscape even above sm", () => {
    expect(
      isCompactReplayChrome({
        widthPx: 844,
        heightPx: 390,
        landscape: true,
      }),
    ).toBe(true);
  });
});

describe("replay overlay slots", () => {
  it("exposes the locked overlay slots and CSS tokens", () => {
    expect(Object.values(REPLAY_OVERLAY)).toEqual([
      "leaderboard",
      "video",
      "wind",
      "legend",
      "chart-notice",
    ]);
    expect(overlayAttr(REPLAY_OVERLAY.leaderboard)).toBe(
      'data-replay-overlay="leaderboard"',
    );
    expect(REPLAY_SAFE_ZONE_VARS).toContain("--replay-bottom-reserved");
    expect(REPLAY_SAFE_ZONE_VARS).toContain("--replay-map-ctrl-stack");
  });
});
