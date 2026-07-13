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

export const ANALYSIS_SAMPLE_MS = 5_000; // bound fleet analysis work on full-resolution logs
export const TIMER_CONSENSUS_MS = 2_000; // synchronized Atlas timers should agree inside this window
export const WIND_ESTIMATION_WINDOW_MS = 20 * 60_000; // first leg is the strongest wind-heading signal
export const WIND_HEADING_BIN_DEG = 5; // fleet heading-mode resolution
export const WIND_MIN_SOG_KTS = 2; // exclude drifting and pre-start loitering from wind inference
export const WIND_SENSOR_MATCH_MS = 2_000; // maximum telemetry-to-wind sample alignment error
export const WIND_OUTPUT_BIN_MS = 60_000; // compact persisted sensor-wind timeline
export const WIND_BOAT_OUTLIER_DEG = 45; // reject per-boat means farther than this from equal-weight consensus
export const LEG_BIN_MS = 60_000; // fleet course classification cadence
export const LEG_MIN_BINS = 2; // suppress one-bin false leg changes
export const LEG_UPWIND_MAX_ABS_TWA_DEG = 90; // |TWA| below this is upwind
export const LEG_DOWNWIND_MIN_ABS_TWA_DEG = 90; // |TWA| above this is downwind
export const MANEUVER_CONTEXT_MS = 8_000; // stable course windows on either side of a turn
export const MANEUVER_STABLE_GAP_MS = 4_000; // keep turn dynamics out of stable in/out course windows
export const MANEUVER_MAX_WINDOW_MS = 30_000; // bound duration and made-good integration
export const MANEUVER_MIN_SEPARATION_MS = 15_000; // dedupe overlapping turn candidates
export const MANEUVER_MIN_SOG_KTS = 1.5; // exclude dockside heading noise
export const MANEUVER_MIN_TURN_DEG = 25; // smallest credible tack or gybe course change
export const MANEUVER_MAX_TURN_DEG = 150; // rejects GPS/course discontinuities
export const MANEUVER_TACK_MIN_ABS_TWA_DEG = 20; // stable course must be this far off head-to-wind
export const MANEUVER_TACK_MAX_ABS_TWA_DEG = 90; // upwind/downwind classification boundary
export const MANEUVER_GYBE_MIN_ABS_TWA_DEG = 90; // downwind side of the classification boundary
export const MANEUVER_GYBE_MAX_ABS_TWA_DEG = 178; // exclude unstable values directly on the 180 seam
export const BOTCHED_MAX_DURATION_S = 20; // maneuver duration beyond this is operationally costly
export const BOTCHED_MIN_SPEED_RATIO = 0.6; // SOG-out / SOG-in threshold
export const BOTCHED_MIN_VMG_RETENTION = 0.5; // made-good efficiency threshold

// Live ladder / leaderboard (#21).
export const RANK_HYSTERESIS_M = 8; // suppress rank flicker between overlapped boats
export const LADDER_TREND_WINDOW_MS = 45_000; // lookback for gaining/losing glyph
export const LADDER_LEG_WINDOW_MS = 60_000; // lookback for upwind/downwind axis flip
export const LADDER_LEG_FLIP_M = 25; // median raw-DMG delta that flips axisSign
