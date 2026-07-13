"use client";

import { useEffect } from "react";

import { usePlaybackStore } from "@/components/replay/playback-store";
import { WindIndicator } from "@/components/replay/wind-indicator";
import {
  createReplayWindResolver,
  type ReplayWindResolver,
} from "@/components/replay/wind-resolution";
import type { RaceAnalysis, WindAnalysis } from "@/lib/analytics/types";
import type { RaceMeta } from "@/lib/races/meta";

const EMPTY_META: RaceMeta = { conditions: null, tags: [] };

function analyzed(wind: WindAnalysis): RaceAnalysis {
  return { wind } as RaceAnalysis;
}

const sensor = createReplayWindResolver(
  EMPTY_META,
  analyzed({
    source: "sensor-derived",
    twdDeg: 0,
    twsKts: 10,
    samples: [
      { timeMs: 0, twdDeg: 350, twsKts: 8, source: "sensor-derived" },
      { timeMs: 1_000, twdDeg: 10, twsKts: 12, source: "sensor-derived" },
    ],
    provenance: {
      source: "sensor-derived",
      method: "apparent-wind-vector",
      confidence: "high",
      sensorEntryIds: ["acceptance"],
      sensorSampleCount: 2,
      estimatedHeadingSampleCount: 0,
    },
  }),
);

const estimated = createReplayWindResolver(
  EMPTY_META,
  analyzed({
    source: "estimated",
    twdDeg: 283,
    twsKts: null,
    samples: [],
    provenance: {
      source: "estimated",
      method: "fleet-heading-modes",
      confidence: "medium",
      sensorEntryIds: [],
      sensorSampleCount: 0,
      estimatedHeadingSampleCount: 100,
    },
  }),
);

function manual(minimum: number | null, maximum: number | null) {
  return createReplayWindResolver(
    {
      tags: [],
      conditions: {
        windDirDeg: 270,
        windMinKts: minimum,
        windMaxKts: maximum,
        seaState: null,
        notes: null,
      },
    },
    null,
  );
}

const cases: Array<[string, ReplayWindResolver | null]> = [
  ["Sensor-derived", sensor],
  ["Fleet-estimated", estimated],
  ["Manual range", manual(12, 16)],
  ["Minimum only", manual(14, null)],
  ["Maximum only", manual(null, 14)],
  ["Unavailable", null],
];

export default function WindAcceptancePage() {
  useEffect(() => {
    usePlaybackStore.getState().setBounds(0, 1_000);
  }, []);

  return (
    <main className="min-h-screen bg-slate-900 p-4 text-white sm:p-8">
      <h1 className="text-xl font-semibold">Wind indicator acceptance</h1>
      <p className="mt-1 text-sm text-white/65">
        Actual replay component and resolver at desktop and mobile widths.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {[0, 500, 1_000].map((timeMs) => (
          <button
            key={timeMs}
            type="button"
            className="rounded border border-white/30 px-3 py-1.5 text-sm"
            onClick={() => usePlaybackStore.getState().seek(timeMs)}
          >
            Scrub {timeMs} ms
          </button>
        ))}
      </div>
      <section className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cases.map(([name, resolver]) => (
          <article
            key={name}
            className="relative min-h-40 overflow-visible rounded-lg border border-white/15 bg-slate-800"
          >
            <h2 className="p-3 text-sm font-medium">{name}</h2>
            <WindIndicator windAt={resolver} />
          </article>
        ))}
      </section>
    </main>
  );
}
