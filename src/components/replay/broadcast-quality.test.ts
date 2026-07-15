import { describe, expect, it } from "vitest";

import {
  BROADCAST_QUALITY_PROFILES,
  createAdaptiveBroadcastQuality,
  initialBroadcastQuality,
  shouldRenderBroadcastFrame,
  type BroadcastGraphicsCapability,
} from "@/components/replay/broadcast-quality";

const strongCapability: BroadcastGraphicsCapability = {
  webgl2: true,
  maxTextureSize: 16_384,
  maxRenderbufferSize: 16_384,
  hardwareConcurrency: 8,
};

describe("broadcast adaptive quality", () => {
  it("uses capabilities for the initial auto tier without user-agent sniffing", () => {
    expect(initialBroadcastQuality("auto", strongCapability).tier).toBe(
      "high",
    );
    expect(
      initialBroadcastQuality("auto", {
        ...strongCapability,
        hardwareConcurrency: 4,
      }).tier,
    ).toBe("low");
    expect(
      initialBroadcastQuality("auto", {
        ...strongCapability,
        webgl2: false,
      }).tier,
    ).toBe("low");
    expect(initialBroadcastQuality("high", {
      ...strongCapability,
      webgl2: false,
    }).tier).toBe("high");
  });

  it("downgrades and later upgrades only after sustained measured timing", () => {
    const controller = createAdaptiveBroadcastQuality(
      "auto",
      strongCapability,
    );
    let changedTo: string | null = null;

    for (let index = 0; index < 80; index += 1) {
      const changed = controller.observe({
        renderMs: 24,
        sourceIntervalMs: 28,
      });
      if (changed) changedTo = changed.tier;
    }

    expect(changedTo).toBe("low");
    expect(controller.profile.tier).toBe("low");

    changedTo = null;
    for (let index = 0; index < 280; index += 1) {
      const changed = controller.observe({
        renderMs: 5,
        sourceIntervalMs: 16.7,
      });
      if (changed) changedTo = changed.tier;
    }

    expect(changedTo).toBe("high");
    expect(controller.profile.tier).toBe("high");
  });

  it("keeps an explicit tier locked while still measuring", () => {
    const controller = createAdaptiveBroadcastQuality(
      "low",
      strongCapability,
    );

    for (let index = 0; index < 300; index += 1) {
      expect(
        controller.observe({
          renderMs: 3,
          sourceIntervalMs: 16,
        }),
      ).toBeNull();
    }

    expect(controller.profile).toBe(BROADCAST_QUALITY_PROFILES.low);
    expect(controller.averageRenderMs).toBeCloseTo(3);
  });

  it("ignores hidden and invalid samples", () => {
    const controller = createAdaptiveBroadcastQuality(
      "auto",
      strongCapability,
    );

    controller.observe({
      renderMs: 50,
      sourceIntervalMs: 50,
      hidden: true,
    });
    controller.observe({
      renderMs: Number.NaN,
      sourceIntervalMs: 50,
    });

    expect(controller.averageRenderMs).toBeNull();
    expect(controller.averageSourceIntervalMs).toBeNull();
  });

  it("gates continuous low-tier draws while always rendering snaps", () => {
    const low = BROADCAST_QUALITY_PROFILES.low;

    expect(
      shouldRenderBroadcastFrame(low, 1_010, 1_000, "continuous"),
    ).toBe(false);
    expect(
      shouldRenderBroadcastFrame(low, 1_034, 1_000, "continuous"),
    ).toBe(true);
    expect(
      shouldRenderBroadcastFrame(low, 1_001, 1_000, "snap"),
    ).toBe(true);
    expect(
      shouldRenderBroadcastFrame(
        low,
        1_001,
        1_000,
        "continuous",
        true,
      ),
    ).toBe(true);
  });
});
