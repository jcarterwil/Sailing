export const SESSION_TYPES = ["race", "practice"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const STARTS_AT_SOURCES = ["manual", "track", "legacy"] as const;
export type StartsAtSource = (typeof STARTS_AT_SOURCES)[number];

export function isSessionType(value: unknown): value is SessionType {
  return value === "race" || value === "practice";
}

export function isStartsAtSource(value: unknown): value is StartsAtSource {
  return value === "manual" || value === "track" || value === "legacy";
}

export function sessionTypeLabel(type: SessionType): string {
  return type === "practice" ? "Practice" : "Race";
}
