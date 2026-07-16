export {
  BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT,
  PERFORMANCE_HISTORY_AGGREGATE_MIN_N,
  PERFORMANCE_HISTORY_UNITS_V1,
} from "@/lib/boats/performance-history/types";
export type {
  CitedPerformanceClaimV1,
  CitedPerformanceHistoryHandoffV1,
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
  parseHistoryDateBound,
  parseHistoryQueryParams,
  queryBoatPerformanceHistory,
} from "@/lib/boats/performance-history/query";
export type { QueryBoatPerformanceHistoryOptions } from "@/lib/boats/performance-history/query";
export {
  loadBoatSessionObservations,
  OBSERVATION_ENTRY_ID_IN_CHUNK,
} from "@/lib/boats/performance-history/load";
export { requireBoatViewer } from "@/lib/boats/performance-history/auth";
export {
  filterObservationsByMetadata,
  filterSnapshotEntryIds,
  hasActiveMetadataFilters,
  parsePerformanceMetadataFilters,
} from "@/lib/boats/performance-history/metadata-filters";
export {
  buildCompactObservationCsv,
  compactExportFilename,
} from "@/lib/boats/performance-history/export-csv";
export { resolveMetadataFilterContext } from "@/lib/boats/performance-history/resolve-metadata-context";
export {
  assertHandoffCitationsIntact,
  buildCitedPerformanceHistoryHandoff,
} from "@/lib/boats/performance-history/handoff";
export {
  PERFORMANCE_HISTORY_COACH_SYSTEM_PROMPT,
  buildPerformanceHistoryCoachCreateParams,
  validatePerformanceHistoryCoachMarkdown,
} from "@/lib/boats/performance-history/coach-request";

// Re-export observation contract for consumers that import the history barrel.
export type { BoatSessionObservationPayloadV1 } from "@/lib/boats/observations";
export {
  BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
  BOAT_SESSION_OBSERVATION_METRIC_VERSION,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
} from "@/lib/boats/observations";
