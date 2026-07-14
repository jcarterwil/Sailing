import { describe, expect, it } from "vitest";

import {
  BroadcastRendererError,
  broadcastBoatTransform,
  broadcastWakeMetrics,
  normalizeBroadcastRendererFailure,
} from "@/components/replay/broadcast-3d-renderer";
import {
  PRESENTATION_ONLY_SYNTHETIC,
  type ReplayRenderBoat,
} from "@/components/replay/replay-render-frame";

function boat(): ReplayRenderBoat {
  return {
    entryId: "entry-1",
    boatName: "Test Boat",
    color: "#0ea5e9",
    selected: true,
    inTrack: true,
    position: {
      lat: 40,
      lon: -70,
      eastM: 12,
      northM: 30,
    },
    recorded: {
      sogKts: 9,
      cogDeg: 45,
      headingDeg: 45,
      heelDeg: 8,
      trimDeg: -2,
    },
    pose: {
      headingDeg: 45,
      heelDeg: 8,
      trimDeg: -2,
      boomSide: "port",
    },
    sailing: {
      signedTwaDeg: 55,
      tack: "starboard",
    },
    provenance: {
      sample: "recorded",
      pose: {
        headingDeg: "recorded-heading",
        heelDeg: "recorded",
        trimDeg: "recorded",
        boomSide: "resolved-wind",
      },
    },
    presentation: {
      heaveM: {
        value: 0.2,
        provenance: PRESENTATION_ONLY_SYNTHETIC,
      },
      wakeStrength: {
        value: 0.75,
        provenance: PRESENTATION_ONLY_SYNTHETIC,
      },
    },
  };
}

describe("Broadcast 3D renderer helpers", () => {
  it("maps recorded pose into scene coordinates without changing data", () => {
    const source = boat();
    const transform = broadcastBoatTransform(source);

    expect(transform.x).toBe(12);
    expect(transform.y).toBe(0.2);
    expect(transform.z).toBe(-30);
    expect(transform.headingRad).toBeCloseTo(-Math.PI / 4);
    expect(transform.heelRad).toBeCloseTo((-8 * Math.PI) / 180);
    expect(transform.trimRad).toBeCloseTo((-2 * Math.PI) / 180);
    expect(source.position.northM).toBe(30);
    expect(source.recorded.headingDeg).toBe(45);
  });

  it("clamps presentation-only wake strength into bounded visuals", () => {
    expect(broadcastWakeMetrics(0)).toMatchObject({
      visible: false,
      lengthM: 4,
      halfWidthM: 0.75,
    });

    const full = broadcastWakeMetrics(10);
    expect(full.visible).toBe(true);
    expect(full.opacity).toBeCloseTo(0.3);
    expect(full.lengthM).toBe(22);
    expect(full.halfWidthM).toBeCloseTo(3.2);
    expect(broadcastWakeMetrics(Number.NaN).visible).toBe(false);
  });

  it("preserves typed fallback causes and normalizes unknown failures", () => {
    const unavailable = new BroadcastRendererError(
      "webgl2-unavailable",
      "WebGL2 is unavailable.",
    );
    expect(normalizeBroadcastRendererFailure(unavailable)).toMatchObject({
      code: "webgl2-unavailable",
      message: "WebGL2 is unavailable.",
    });

    expect(
      normalizeBroadcastRendererFailure(new Error("GPU startup failed")),
    ).toMatchObject({
      code: "initialization-failed",
      message: "GPU startup failed",
    });
  });
});
