/// <reference lib="webworker" />

import {
  buildPerformanceDrilldownData,
  parseProcessedTrackPayload,
  PERFORMANCE_DRILLDOWN_MAX_COMPRESSED_BYTES,
  PERFORMANCE_DRILLDOWN_MAX_FLEET_SOURCE_POINTS,
  PERFORMANCE_DRILLDOWN_MAX_JSON_CHARS,
  PERFORMANCE_DRILLDOWN_MAX_TRACKS,
} from "@/components/performance/drilldown-data";
import type {
  PerformanceTrackMeta,
  PerformanceDrilldownWorkerRequest,
  PerformanceDrilldownWorkerResponse,
} from "@/components/performance/drilldown-worker-contract";
import type { ProcessedTrack } from "@/lib/analytics/types";

async function boundedText(
  stream: ReadableStream<Uint8Array>,
  maxChars: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    length += text.length;
    if (length > maxChars) {
      await reader.cancel();
      throw new Error("Decompressed track exceeds the drilldown display limit.");
    }
    chunks.push(text);
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

async function loadTrack(meta: PerformanceTrackMeta): Promise<ProcessedTrack> {
  const response = await fetch(meta.url);
  if (!response.ok) throw new Error(`Signed track request failed for ${meta.boatName}.`);
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > PERFORMANCE_DRILLDOWN_MAX_COMPRESSED_BYTES) {
    throw new Error(`Signed track is too large for ${meta.boatName}.`);
  }
  const compressed = await response.arrayBuffer();
  if (compressed.byteLength > PERFORMANCE_DRILLDOWN_MAX_COMPRESSED_BYTES) {
    throw new Error(`Signed track is too large for ${meta.boatName}.`);
  }
  const body = new Response(compressed).body;
  if (!body) throw new Error(`Signed track body is unavailable for ${meta.boatName}.`);
  const decompressed = body.pipeThrough(new DecompressionStream("gzip"));
  const text = await boundedText(decompressed, PERFORMANCE_DRILLDOWN_MAX_JSON_CHARS);
  return parseProcessedTrackPayload(JSON.parse(text) as unknown, meta.entryId);
}

self.onmessage = async (event: MessageEvent<PerformanceDrilldownWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.tracks.length > PERFORMANCE_DRILLDOWN_MAX_TRACKS) {
      throw new Error("The fleet exceeds the drilldown display track limit.");
    }
    // Sequential loading bounds peak compressed/decompressed memory in the worker.
    const tracks: ProcessedTrack[] = [];
    let sourcePointCount = 0;
    for (const meta of request.tracks) {
      const track = await loadTrack(meta);
      sourcePointCount += track.t.length;
      if (sourcePointCount > PERFORMANCE_DRILLDOWN_MAX_FLEET_SOURCE_POINTS) {
        throw new Error("The fleet exceeds the drilldown display point limit.");
      }
      tracks.push(track);
    }
    const data = buildPerformanceDrilldownData(tracks, request.analysis, request.performance);
    const response: PerformanceDrilldownWorkerResponse = { id: request.id, ok: true, data };
    self.postMessage(response);
  } catch (error) {
    const response: PerformanceDrilldownWorkerResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 240) : "Drilldown tracks could not be prepared.",
    };
    self.postMessage(response);
  }
};

export {};
