export {
  BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT,
  BOAT_SESSION_OBSERVATION_CONTRACT,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
  OBSERVATION_UNITS_V1,
  PERFORMANCE_HISTORY_AGGREGATE_MIN_N,
  SOURCE_METRIC_CONTRACT,
} from "@/lib/boats/performance-history/types";
export type {
  BoatSessionObservationPayloadV1,
  CompactObservationRowV1,
  PerformanceHistoryAggregatesV1,
  PerformanceHistoryQueryFilters,
  PerformanceHistoryQueryResultV1,
} from "@/lib/boats/performance-history/types";

export { compactBoatSessionObservation } from "@/lib/boats/performance-history/compact";
export {
  buildAggregateSummaries,
  medianIqr,
  percentileSorted,
  PERFORMANCE_HISTORY_NORMALIZATION_NOTE,
} from "@/lib/boats/performance-history/aggregate";
export {
  parseHistoryQueryParams,
  queryBoatPerformanceHistory,
} from "@/lib/boats/performance-history/query";
export {
  loadBoatSessionObservations,
  parseObservationPayload,
} from "@/lib/boats/performance-history/load";
export {
  persistBoatSessionObservations,
  persistObservationsFromStoredAnalysis,
} from "@/lib/boats/performance-history/persist";
export { requireBoatViewer } from "@/lib/boats/performance-history/auth";
