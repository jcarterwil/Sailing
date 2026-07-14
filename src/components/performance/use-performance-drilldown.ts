"use client";

import { useEffect, useRef, useState } from "react";

import type { DrilldownAnalysisInput, PerformanceDrilldownData } from "@/components/performance/drilldown-data";
import type {
  PerformanceTrackMeta,
  PerformanceDrilldownWorkerRequest,
  PerformanceDrilldownWorkerResponse,
} from "@/components/performance/drilldown-worker-contract";
import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";

export function usePerformanceDrilldown(
  tracks: readonly PerformanceTrackMeta[],
  analysis: DrilldownAnalysisInput,
  performance: PerformanceAnalysisV1,
): { data: PerformanceDrilldownData | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<PerformanceDrilldownData | null>(null);
  const [loading, setLoading] = useState(tracks.length > 0);
  const [error, setError] = useState<string | null>(
    tracks.length > 0 ? null : "Signed drilldown tracks are unavailable.",
  );
  const requestId = useRef(0);

  useEffect(() => {
    if (tracks.length === 0) return;
    const id = ++requestId.current;
    let worker: Worker;
    try {
      worker = new Worker(new URL("./performance-drilldown.worker.ts", import.meta.url), { type: "module" });
    } catch {
      queueMicrotask(() => {
        if (requestId.current !== id) return;
        setLoading(false);
        setError("This browser could not start the bounded drilldown worker.");
      });
      return;
    }
    const onMessage = (event: MessageEvent<PerformanceDrilldownWorkerResponse>) => {
      if (event.data.id !== id || requestId.current !== id) return;
      if (event.data.ok) setData(event.data.data);
      else setError(event.data.error);
      setLoading(false);
      worker.terminate();
    };
    const onWorkerError = () => {
      if (requestId.current !== id) return;
      setError("The bounded drilldown worker stopped before display data was ready.");
      setLoading(false);
      worker.terminate();
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onWorkerError);
    const request: PerformanceDrilldownWorkerRequest = {
      id,
      tracks: [...tracks],
      analysis,
      performance,
    };
    worker.postMessage(request);
    return () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerError);
      worker.terminate();
    };
  }, [tracks, analysis, performance]);

  return { data, loading, error };
}
