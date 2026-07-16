export {
  BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT,
  PERFORMANCE_HISTORY_AGGREGATE_MIN_N,
  PERFORMANCE_HISTORY_UNITS_V1,
} from "@/lib/boats/performance-history/types";
export type {
  CompactObservationRowV1,
  PerformanceHistoryAggregatesV1,
  PerformanceHistoryQueryFilters,
  PerformanceHistoryQueryResultV1,
  PerformanceHistoryUnitsV1,
} from "@/lib/boats/performance-history/types";

export {
  buildAggregateSummaries,
  medianIqr,
  percentileSorted,
  PERFORMANCE_HISTORY_NORMALIZATION_NOTE,
} from "@/lib/boats/performance-history/aggregate";
export {
  countExclusions,
  parseHistoryQueryParams,
  queryBoatPerformanceHistory,
} from "@/lib/boats/performance-history/query";
export { loadBoatSessionObservations } from "@/lib/boats/performance-history/load";
export { requireBoatViewer } from "@/lib/boats/performance-history/auth";

// Re-export observation contract for consumers that import the history barrel.
export type { BoatSessionObservationPayloadV1 } from "@/lib/boats/observations";
export {
  BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
  BOAT_SESSION_OBSERVATION_METRIC_VERSION,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
} from "@/lib/boats/observations";
