// Tunable analytics parameters. Values marked "tune" should be revisited
// against the Examples fleet data once the full pipeline is in place.

export const MAX_GAP_MS = 5_000; // dt beyond this starts a new segment
export const MIN_SEGMENT_MS = 10_000; // shorter segments are discarded as noise
export const MAX_IMPLIED_SPEED_KTS = 25; // GPS teleport threshold
export const HAMPEL_WINDOW = 7; // sliding window for position outlier test
export const HAMPEL_RADIUS_M = 30; // max deviation from window median position
export const SOG_SPIKE_KTS = 5; // deviation from rolling median treated as spike
export const MIN_SOG_FOR_COG_KTS = 0.5; // below this COG is meaningless
export const HEEL_MAX_DEG = 45; // tune
export const TRIM_MAX_DEG = 30; // tune
export const SMOOTH_TAU_S = 2; // tune: affects maneuver timing
