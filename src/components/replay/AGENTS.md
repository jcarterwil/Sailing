# Replay UI — agent guide

The client-only race replay: a MapLibre map, a zustand playback clock, and a canvas timeline, rendering 6 boats × ~25k points at 60fps. The performance model is the whole design — respect it.

## The 60fps rule (most important)

- **Per-frame consumers update imperatively, never through React renders.** The map (`map-view.tsx`) and timeline cursor (`timeline.tsx`) subscribe with `usePlaybackStore.subscribe(...)` and mutate the DOM/canvas/`source.setData()` directly. Putting `timeMs` into React state and re-rendering at 60fps would tank performance.
- **React-rendered widgets subscribe narrowly and throttle** to ~10Hz (see the clock in `playback-controls.tsx`, Instruments, and the live `leaderboard.tsx`). Use `usePlaybackStore((s) => s.field)` selectors, not the whole store.
- The single rAF clock lives in `race-replay.tsx` and calls `store.tick(dt)`. Don't add competing animation loops.
- **Wind for ladder / future wind indicator:** resolve via `resolveTwdAt(raceMeta)` in `race-replay.tsx` (manual `conditions.windDirDeg` today; TODO #3 for `analysis.wind`). Do not invent a second wind path for #7.

## Rules

- **No chart library.** Speed strips and the polar plot are hand-drawn on `<canvas>` — SVG-based libs (recharts) die at this point count. Static plot layer + a separate overlay canvas for the moving cursor.
- **Raw `maplibre-gl`, not react-map-gl.** One component owns the map lifecycle in a `useEffect`. On `setStyle` the sources/layers are wiped — re-add them in the `styledata` handler (see `map-view.tsx`). Tiles are keyless (OpenFreeMap + Esri); no Mapbox token.
- **The replay is loaded with `ssr: false`** through `replay-shell.tsx` because maplibre is browser-only. Keep the dynamic-import boundary there; the RSC page (`src/app/races/[raceId]/replay/page.tsx`) only mints signed track URLs and passes them in.
- **Tracks load from Storage, not the server.** `track-loader.ts` fetches the gzipped `ProcessedTrack` JSON via a signed URL and decompresses with the native `DecompressionStream("gzip")` into typed arrays. `track-index.ts` does binary-search + interpolation — reuse it, don't re-scan arrays.

## Store

`playback-store.ts` (zustand) holds `timeMs`, `playing`, `speed`, `trailMode`, `rangeSel` (the brush selection), `selectedEntryId` (the tapped/owned boat), and `cameraMode` (`"north"` | `"follow"` | `"chase"`). Deselecting a boat or calling `setBounds` (new race load) resets `cameraMode` to `"north"`. Keep it minimal; derived values are computed by consumers from the track arrays + `track-index.ts`, not stored.
