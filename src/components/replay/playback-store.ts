import { create } from "zustand";

export type TrackLength = "tail" | "full";
export type CameraMode = "fleet" | "north" | "follow" | "chase";

interface PlaybackState {
  // Fleet time bounds, epoch ms.
  t0: number;
  t1: number;
  timeMs: number;
  playing: boolean;
  speed: number;
  trackLength: TrackLength;
  rangeSel: [number, number] | null;
  // The entry the user tapped/owns — drives halo, dimming, instruments highlight.
  selectedEntryId: string | null;
  cameraMode: CameraMode;
  setBounds: (t0: number, t1: number) => void;
  seek: (timeMs: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setTrackLength: (length: TrackLength) => void;
  setRange: (range: [number, number] | null) => void;
  setSelectedEntryId: (id: string | null) => void;
  setCameraMode: (mode: CameraMode) => void;
  tick: (dtMs: number) => void;
}

// The timeline cursor and the shared ReplayRenderFrameSource bridge subscribe
// imperatively; renderer views consume that source instead of creating their
// own store subscription. React-rendered widgets select narrowly and throttle.
export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  t0: 0,
  t1: 1,
  timeMs: 0,
  playing: false,
  speed: 10,
  trackLength: "tail",
  rangeSel: null,
  selectedEntryId: null,
  cameraMode: "fleet",
  setBounds: (t0, t1) => set({ t0, t1, timeMs: t0, cameraMode: "fleet" }),
  seek: (timeMs) => {
    const { t0, t1 } = get();
    set({ timeMs: Math.min(t1, Math.max(t0, timeMs)) });
  },
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setTrackLength: (trackLength) => set({ trackLength }),
  setRange: (rangeSel) => set({ rangeSel }),
  setSelectedEntryId: (selectedEntryId) =>
    set((state) => {
      if (selectedEntryId !== null) return { selectedEntryId };
      const cameraMode =
        state.cameraMode === "follow" || state.cameraMode === "chase"
          ? "fleet"
          : state.cameraMode;
      return { selectedEntryId: null, cameraMode };
    }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
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
