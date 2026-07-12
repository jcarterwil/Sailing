import { create } from "zustand";

export type TrailMode = "tail" | "full" | "speed";

interface PlaybackState {
  // Fleet time bounds, epoch ms.
  t0: number;
  t1: number;
  timeMs: number;
  playing: boolean;
  speed: number;
  trailMode: TrailMode;
  rangeSel: [number, number] | null;
  // The entry the user tapped/owns — drives halo, dimming, instruments highlight.
  selectedEntryId: string | null;
  setBounds: (t0: number, t1: number) => void;
  seek: (timeMs: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setTrailMode: (mode: TrailMode) => void;
  setRange: (range: [number, number] | null) => void;
  setSelectedEntryId: (id: string | null) => void;
  tick: (dtMs: number) => void;
}

// Per-frame consumers (map, timeline cursor) must use
// usePlaybackStore.subscribe(...) and update imperatively; React-rendered
// widgets should select narrowly and throttle.
export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  t0: 0,
  t1: 1,
  timeMs: 0,
  playing: false,
  speed: 10,
  trailMode: "tail",
  rangeSel: null,
  selectedEntryId: null,
  setBounds: (t0, t1) => set({ t0, t1, timeMs: t0 }),
  seek: (timeMs) => {
    const { t0, t1 } = get();
    set({ timeMs: Math.min(t1, Math.max(t0, timeMs)) });
  },
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setTrailMode: (trailMode) => set({ trailMode }),
  setRange: (rangeSel) => set({ rangeSel }),
  setSelectedEntryId: (selectedEntryId) => set({ selectedEntryId }),
  tick: (dtMs) => {
    const { timeMs, t1, speed, playing } = get();
    if (!playing) return;
    const next = timeMs + dtMs * speed;
    if (next >= t1) {
      set({ timeMs: t1, playing: false });
    } else {
      set({ timeMs: next });
    }
  },
}));
