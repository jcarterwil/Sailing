import { norm180 } from "@/lib/analytics/angles";
import { MIN_MAKING_WAY_SOG_KTS } from "@/lib/analytics/constants";
import { finite } from "@/lib/analytics/internal";
import type { Maneuver } from "@/lib/analytics/types";

export type SailingTack = "port" | "starboard";
export type SailingDirection = "upwind" | "downwind";

/** Signed TWA convention used everywhere: positive is starboard, negative is port. */
export function signedTwaDeg(twdDeg: number, courseDeg: number): number {
  return norm180(twdDeg - courseDeg);
}

export function tackFromSignedTwa(twaDeg: number): SailingTack {
  return twaDeg >= 0 ? "starboard" : "port";
}

export function isMakingWay(sogKts: unknown, courseDeg: unknown): boolean {
  return finite(sogKts) && sogKts >= MIN_MAKING_WAY_SOG_KTS && finite(courseDeg);
}

export function progressVmgKts(
  sogKts: number,
  twaDeg: number,
  direction: SailingDirection,
): number {
  const towardWindKts = sogKts * Math.cos(twaDeg * Math.PI / 180);
  return direction === "upwind" ? towardWindKts : -towardWindKts;
}

export function inManeuverWindow(
  timeMs: number,
  maneuvers: readonly Maneuver[],
): boolean {
  for (const maneuver of maneuvers) {
    if (timeMs >= maneuver.window.startMs && timeMs <= maneuver.window.endMs) return true;
  }
  return false;
}
