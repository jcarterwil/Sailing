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
export const CORRECTION_TWS_MAX_KTS = 80; // organizer manual / normalized TWS clamp
/** Wind-quality heuristic thresholds (#55). */
export const WIND_QUALITY_DOMINANCE_WARN = 0.5;
export const WIND_QUALITY_DOMINANCE_CRITICAL = 0.7;
export const WIND_QUALITY_DIRECTION_OUTLIER_WARN_DEG = 30;
export const WIND_QUALITY_DIRECTION_OUTLIER_CRITICAL_DEG = 60;
export const WIND_QUALITY_ESTIMATE_DISAGREE_DEG = 45;
export const WIND_QUALITY_LOW_STRENGTH = 0.6;
export const WIND_QUALITY_TWS_MIN_KTS = 0.5;
export const WIND_QUALITY_TWS_MAX_KTS = 45;
export const WIND_QUALITY_SPARSE_SAMPLES = 10;
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

/** Performance Overview V1 contract bounds (#76). */
export const PERFORMANCE_RESAMPLE_HZ = 1;
export const PERFORMANCE_MAX_SOURCE_GAP_MS = 10_000;
export const PERFORMANCE_START_WINDOW_MS = 60_000;
export const PERFORMANCE_TIE_MS = 500;
export const PERFORMANCE_KNOT_TO_MPS = 0.514444;
export const PERFORMANCE_MAX_ENTRY_COUNT = 100;
export const PERFORMANCE_MAX_LEG_COUNT = 16;
export const PERFORMANCE_MAX_COURSE_POINT_COUNT = PERFORMANCE_MAX_LEG_COUNT + 1;
export const PERFORMANCE_MAX_PASSAGES_PER_ENTRY = PERFORMANCE_MAX_COURSE_POINT_COUNT;
export const PERFORMANCE_MAX_WARNINGS = 256;
export const PERFORMANCE_MAX_WARNING_MESSAGE_CHARS = 300;
export const PERFORMANCE_MAX_ENTRY_ID_CHARS = 200;
export const PERFORMANCE_MAX_RESULT_NOTE_CHARS = 500;
export const PERFORMANCE_MAX_DISTRIBUTIONS = 512;
export const PERFORMANCE_MAX_BINS_PER_DISTRIBUTION = 200;
export const PERFORMANCE_MAX_TOTAL_DISTRIBUTION_BINS = 12_000;
export const PERFORMANCE_DISTRIBUTION_BIN_KTS = 0.25;
export const PERFORMANCE_DISTRIBUTION_MAX_KTS = 50;
export const PERFORMANCE_MIN_DISTRIBUTION_SECONDS = 20;
export const PERFORMANCE_MAX_PROVENANCE_INPUTS = 32;
export const PERFORMANCE_MAX_PROVENANCE_LABEL_CHARS = 120;
export const PERFORMANCE_MAX_PAYLOAD_BYTES = 1024 * 1024;
export const PERFORMANCE_MAX_DISPLAY_POINTS_PER_BOAT = 2_000;
export const PERFORMANCE_MAX_DISPLAY_POINTS_PER_CHART = 12_000;
/** Course geometry and passage thresholds (#77). */
export const PERFORMANCE_COURSE_MIN_SUPPORTING_ENTRIES = 2;
export const PERFORMANCE_COURSE_MIN_OUTLIER_RADIUS_M = 150;
export const PERFORMANCE_COURSE_MAD_MULTIPLIER = 3;
export const PERFORMANCE_COURSE_MAX_CLUSTER_SPREAD_M = 250;
export const PERFORMANCE_COURSE_MARK_SEARCH_RADIUS_M = 300;
export const PERFORMANCE_PASSAGE_MAX_RADIUS_M = 75;
export const PERFORMANCE_LINE_ENDPOINT_TOLERANCE_M = 5;
export const PERFORMANCE_START_OCS_DISTANCE_M = 2;

// Live ladder / leaderboard (#21).
export const RANK_HYSTERESIS_M = 8; // suppress rank flicker between overlapped boats
export const LADDER_TREND_WINDOW_MS = 45_000; // lookback for gaining/losing glyph
export const LADDER_LEG_WINDOW_MS = 60_000; // lookback for upwind/downwind axis flip
export const LADDER_LEG_FLIP_M = 25; // median raw-DMG delta that flips axisSign
