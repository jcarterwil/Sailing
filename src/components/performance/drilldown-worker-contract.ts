import type {
  DrilldownAnalysisInput,
  PerformanceDrilldownData,
} from "@/components/performance/drilldown-data";
import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";

export interface PerformanceTrackMeta {
  entryId: string;
  boatName: string;
  color: string;
  url: string;
}

export interface PerformanceDrilldownWorkerRequest {
  id: number;
  tracks: PerformanceTrackMeta[];
  analysis: DrilldownAnalysisInput;
  performance: PerformanceAnalysisV1;
}

export type PerformanceDrilldownWorkerResponse =
  | { id: number; ok: true; data: PerformanceDrilldownData }
  | { id: number; ok: false; error: string };
