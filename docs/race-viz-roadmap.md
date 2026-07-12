# Race visualization roadmap

Two user asks drive this: **"tag my boat and see a live leaderboard / info on boats around me"** and **"a 3D POV view with real heel and tack"**. Much of the supporting machinery is already specced or shipped; this roadmap adds only the genuinely new work and sequences it against the existing backlog.

The data is unusually ready for both asks: heel/trim/heading come from onboard quaternions at 2 Hz, are cleaned and persisted, and are already interpolated per frame by `sampleAt` (`src/components/replay/track-index.ts`) — real measured attitude, never yet rendered. And every VKX log carries a fleet-synchronized `race_start` timer event plus the start line the crew actually pinged (pin + committee boat) inside `ProcessedTrack.extras` — persisted today, dropped by the client loader.

## Already covered — do not re-spec

| Capability | Where |
| --- | --- |
| Instruments (SOG/COG/HDG/heel/trim per boat) + Performance aggregates | shipped in #2 (merged, `src/components/replay/panels/`) |
| Wind estimation + maneuver detection + race structure engine (`wind.ts`, `maneuvers.ts`, `race.ts`, `aggregates.ts`, `analyzeRace`) | separate senior task; plumbing + persistence + replay surfacing is #3 |
| Maneuvers table + Polars chart panels | #4 (depends #3) |
| Wind indicator overlay, speed-colored trails, mobile layout | #7 (supersedes #1) |
| Import-time extras/warnings digests (`hasWind`, `linePingCount`, …) | #8 |
| Crew/tags/conditions metadata incl. `conditions.windDirDeg` | #10 (merged) |

## New issues (this roadmap)

- **#19 Tag your boat: ownership, selection, visual emphasis** (S/M, `sonnet-ready`). The foundation: `selectedEntryId` in the playback store, ownership threading, tap-to-select, halo/dim emphasis, clickable Instruments rows. Everything below keys off it.
- **#20 Camera modes: north-up / follow / chase** (S, `sonnet-ready`, depends #19). Center-lock and a pitched, bearing-smoothed chase cam. This is "Tier A 3D": ~80% of the POV feel for ~0 risk.
- **#21 Live leaderboard: wind-axis ladder ranks + rival gaps** (M, `sonnet-ready`, depends #19, soft-depends #3). Pure `ladder.ts` analytics + a glanceable map overlay. Works **today** off manual `conditions.windDirDeg`; upgrades automatically to time-varying `analysis.wind` when #3 lands.
- **#22 Start line, race clock, pre-start view** (M, `sonnet-ready`, depends #19 softly). Re-threads `ProcessedTrack.extras` into the replay client (step zero for anything extras-based), draws the actual pinged line, countdown clock from fleet-synced `race_start`. Unique-data feature no competitor renders.
- **#23 3D fleet: heeling hull models on the map** (L, future, not sonnet-ready, depends #19 + #20). three.js via MapLibre `CustomLayerInterface`; roll/pitch from **real measured attitude** (VKX quaternions), not simulation. The headline "3D" milestone.
- **#24 Immersive simulator POV** (XL, exploratory, depends #23). Deliberately deferred; documents why and the smallest spike worth doing.

## Recommended sequence and why

1. **#19 then #20 immediately** — small diffs; together they already demo as "tag your boat and ride with it" (chase cam + the shipped Instruments tab + real heel numbers). #20 is the cheapest wow in the whole program.
2. **#22 next** — independent of the analysis engine (reads `extras` client-side), and the start-line + countdown moment is the strongest demo beat for this fleet (their own pings, their own gun). Its extras re-threading also future-proofs the loader.
3. **#21 in parallel or right after** — needs only manual wind direction (#10's UI ships it; #21's empty-state CTA drives people to set it). When #3 lands, #21 and #7's wind indicator switch to `analysis.wind` through one shared resolver.
4. **#3 → #4 → #7** proceed on their own track (engine is a senior task). Interleaving note: `map-view.tsx` and `playback-controls.tsx` are merge hotspots — #19, #20, #22, and #7 all touch them; land #19/#20/#22 before #7's trail work or expect small rebases.
5. **#23 after #20 ships and #7 settles** (same `map-view.tsx` hotspot) — behind a toggle, `three` lazily imported.
6. **#24 stays parked** behind an explicit decision gate after #23; Tier A (#20) + Tier B (#23) deliver most of the immersion at a fraction of the cost.

Nothing here requires a schema migration, new RLS, or any `ProcessedTrack` wire-shape change: ownership uses existing `boats.owner_id`/`race_entries.added_by`; wind falls back to `races.conditions`; extras already ride inside the stored `ProcessedTrack`. Leaderboard/ladder math is computed client-side during replay (data is already in memory; `race_analyses` stays reserved for the async analyzer/dossier path).
