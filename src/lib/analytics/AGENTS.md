# Analytics engine — agent guide

Pure, dependency-free TypeScript. Every module here must run **identically in a Node route handler and in the browser** — no `Buffer`-only APIs, no Node built-ins beyond what the browser also has, no npm deps. This is load-bearing: the same code computes analysis server-side at upload and re-computes it client-side when a user overrides wind/start or brushes a time range.

## Rules

- **Pure functions only.** No I/O, no fetching, no global state. Inputs in, values out. This keeps everything unit-testable and isomorphic.
- **No dependencies.** Haversine is five lines (`geo.ts`); don't add turf/d3/papaparse. If you think you need a dep, you almost certainly don't.
- **All tunable parameters live in `constants.ts`** as named exports with a comment. Don't inline magic numbers in algorithms.
- **Warnings, not throws, for recoverable data problems.** Parsers accumulate `ParseWarning[]` and only throw (`ParseError`) when the file is unusable. Corrupt VKX regions resync at page headers.

## Angle & sailing conventions (used everywhere — do not deviate)

- Bearings are degrees true. Use `angles.ts`: `norm360` → [0,360), `norm180` → (-180,180], `angleDiff(a,b)` = shortest arc. **Never average raw angles across the 0/360 seam** — use `circularMean` / `circularEwma` (they average unit vectors).
- **TWA = `norm180(twdDeg - cogDeg)`**, positive = starboard tack. |TWA| < 90 upwind, > 90 downwind.
- **VMG = `sogKts * cos(TWA)`**, positive = progress toward the wind.
- Interpolating a heading between two samples uses `lerpAngle` (shortest arc), never linear.

## Data flow

`parseVkx` / `parseTrackCsv` → `RawTrack` (normalized `TrackPoint[]` + extras/warnings) → `cleanTrack` (outliers, gaps, attitude filtering) → `buildProcessedTrack` → `ProcessedTrack` (columnar, JSON-serializable; **NaN survives as `null` and readers must coerce it back**). `ProcessedTrack` is the wire contract shared with the process route and the replay client — changing its shape is a breaking change across three consumers.

## VKX format

Little-endian row records: 1-byte key + fixed payload. Key/size table and quaternion→heel/trim/heading math are in `parse/vkx.ts`; the authoritative spec is github.com/vakaros/vkx. Timestamps are epoch-ms UTC. Files also carry race-timer events (`0x04`), start-line pings (`0x05`), and Calypso apparent-wind rows (`0x0A`) — surface these in `extras`; the wind rows are a real differentiator (ChartedSails drops them).

## Testing

Golden tests (`*.test.ts`) run against the real `Examples/` files via Vitest. Anchors that must stay true: VKX race-start event at `2026-07-07T22:10:00Z`, per-boat point counts, CSV tz offset `-300`, estimated TWD ≈ 283°. Add a test with any new algorithm and keep the existing anchors green.
