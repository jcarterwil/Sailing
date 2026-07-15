import type { ReplayRenderUpdateKind } from "@/components/replay/replay-render-frame";

export type BroadcastQualityTier = "low" | "high";
export type BroadcastQualityPreference = "auto" | BroadcastQualityTier;

export interface BroadcastGraphicsCapability {
  webgl2: boolean;
  maxTextureSize: number;
  maxRenderbufferSize: number;
  hardwareConcurrency: number | null;
}

export interface BroadcastQualityProfile {
  tier: BroadcastQualityTier;
  targetFps: 30 | 60;
  maxDevicePixelRatio: number;
  waterSegments: number;
  dynamicWater: boolean;
  dynamicShadows: boolean;
  shadowMapSize: number;
}

export const BROADCAST_QUALITY_PROFILES: Readonly<
  Record<BroadcastQualityTier, Readonly<BroadcastQualityProfile>>
> = Object.freeze({
  low: Object.freeze({
    tier: "low",
    targetFps: 30,
    maxDevicePixelRatio: 1,
    waterSegments: 14,
    dynamicWater: false,
    dynamicShadows: false,
    shadowMapSize: 0,
  }),
  high: Object.freeze({
    tier: "high",
    targetFps: 60,
    maxDevicePixelRatio: 1.75,
    waterSegments: 48,
    dynamicWater: true,
    dynamicShadows: true,
    shadowMapSize: 1_024,
  }),
});

export interface BroadcastFrameTimingSample {
  renderMs: number;
  sourceIntervalMs: number | null;
  hidden?: boolean;
}

export interface AdaptiveBroadcastQuality {
  readonly preference: BroadcastQualityPreference;
  readonly profile: Readonly<BroadcastQualityProfile>;
  readonly averageRenderMs: number | null;
  readonly averageSourceIntervalMs: number | null;
  observe: (
    sample: BroadcastFrameTimingSample,
  ) => Readonly<BroadcastQualityProfile> | null;
  setPreference: (
    preference: BroadcastQualityPreference,
  ) => Readonly<BroadcastQualityProfile> | null;
}

const TIMING_EWMA_ALPHA = 0.08;
const HIGH_STRESSED_RENDER_MS = 15;
const HIGH_STRESSED_INTERVAL_MS = 23;
const LOW_COMFORTABLE_RENDER_MS = 8.5;
const LOW_COMFORTABLE_INTERVAL_MS = 24;
const DOWNGRADE_SUSTAINED_FRAMES = 45;
const UPGRADE_SUSTAINED_FRAMES = 180;

function finitePositive(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

export function initialBroadcastQuality(
  preference: BroadcastQualityPreference,
  capability: BroadcastGraphicsCapability,
): Readonly<BroadcastQualityProfile> {
  if (preference !== "auto") {
    return BROADCAST_QUALITY_PROFILES[preference];
  }

  const enoughCores =
    capability.hardwareConcurrency == null ||
    capability.hardwareConcurrency >= 6;
  const enoughTexture =
    Number.isFinite(capability.maxTextureSize) &&
    capability.maxTextureSize >= 4_096;
  const enoughRenderbuffer =
    Number.isFinite(capability.maxRenderbufferSize) &&
    capability.maxRenderbufferSize >= 4_096;

  return capability.webgl2 &&
    enoughCores &&
    enoughTexture &&
    enoughRenderbuffer
    ? BROADCAST_QUALITY_PROFILES.high
    : BROADCAST_QUALITY_PROFILES.low;
}

function ewma(
  previous: number | null,
  next: number,
): number {
  return previous == null
    ? next
    : previous * (1 - TIMING_EWMA_ALPHA) + next * TIMING_EWMA_ALPHA;
}

/**
 * Capability chooses only the initial tier. Auto mode subsequently responds to
 * sustained measured render/input timing with asymmetric hysteresis, avoiding
 * quality flapping during a single expensive frame.
 */
export function createAdaptiveBroadcastQuality(
  initialPreference: BroadcastQualityPreference,
  capability: BroadcastGraphicsCapability,
): AdaptiveBroadcastQuality {
  let preference = initialPreference;
  let profile = initialBroadcastQuality(preference, capability);
  let averageRenderMs: number | null = null;
  let averageSourceIntervalMs: number | null = null;
  let stressedFrames = 0;
  let comfortableFrames = 0;

  const resetHysteresis = () => {
    stressedFrames = 0;
    comfortableFrames = 0;
  };

  return {
    get preference() {
      return preference;
    },
    get profile() {
      return profile;
    },
    get averageRenderMs() {
      return averageRenderMs;
    },
    get averageSourceIntervalMs() {
      return averageSourceIntervalMs;
    },
    observe(sample) {
      if (sample.hidden || !finitePositive(sample.renderMs)) return null;

      averageRenderMs = ewma(averageRenderMs, sample.renderMs);
      if (finitePositive(sample.sourceIntervalMs)) {
        averageSourceIntervalMs = ewma(
          averageSourceIntervalMs,
          sample.sourceIntervalMs,
        );
      }

      if (preference !== "auto") return null;

      if (profile.tier === "high") {
        const stressed =
          averageRenderMs > HIGH_STRESSED_RENDER_MS ||
          (averageSourceIntervalMs != null &&
            averageSourceIntervalMs > HIGH_STRESSED_INTERVAL_MS);
        stressedFrames = stressed
          ? stressedFrames + 1
          : Math.max(0, stressedFrames - 2);
        comfortableFrames = 0;
        if (stressedFrames < DOWNGRADE_SUSTAINED_FRAMES) return null;

        profile = BROADCAST_QUALITY_PROFILES.low;
        resetHysteresis();
        return profile;
      }

      const comfortable =
        averageRenderMs < LOW_COMFORTABLE_RENDER_MS &&
        (averageSourceIntervalMs == null ||
          averageSourceIntervalMs < LOW_COMFORTABLE_INTERVAL_MS);
      comfortableFrames = comfortable ? comfortableFrames + 1 : 0;
      stressedFrames = 0;
      if (comfortableFrames < UPGRADE_SUSTAINED_FRAMES) return null;

      profile = BROADCAST_QUALITY_PROFILES.high;
      resetHysteresis();
      return profile;
    },
    setPreference(nextPreference) {
      const previousTier = profile.tier;
      preference = nextPreference;
      profile = initialBroadcastQuality(preference, capability);
      resetHysteresis();
      return profile.tier === previousTier ? null : profile;
    },
  };
}

/**
 * Low quality consumes the same replay publications but draws at most 30 fps.
 * Snaps, paused scrubs, initialization, and forced resize/visibility renders
 * always draw immediately.
 */
export function shouldRenderBroadcastFrame(
  profile: Pick<BroadcastQualityProfile, "targetFps">,
  nowMs: number,
  lastRenderMs: number | null,
  updateKind: ReplayRenderUpdateKind,
  force = false,
): boolean {
  if (
    force ||
    updateKind !== "continuous" ||
    lastRenderMs == null ||
    !Number.isFinite(lastRenderMs)
  ) {
    return true;
  }
  if (!Number.isFinite(nowMs)) return false;
  const minimumIntervalMs = 1_000 / profile.targetFps;
  return nowMs - lastRenderMs >= minimumIntervalMs - 0.5;
}
